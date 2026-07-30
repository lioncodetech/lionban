import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "../src/lib/db";
import { validateRepo } from "../src/lib/github";

type Job = { execution_id:string; ticket_id:number; application_id:string; title:string; description:string; priority:"low"|"medium"|"high"|"critical"; full_name:string; github_repo_id:number; default_branch:string; clone_url:string; install_command?:string; test_command?:string; lint_command?:string; build_command?:string; test_environment:Record<string,string>; auto_commit:boolean; auto_push:boolean; auto_pull_request:boolean; auto_deploy:boolean; deploy_webhook_url?:string; create_tag:boolean; release_tag?:string; resume_artifact_id?:string };
const workerId = `worker-${process.pid}`;
const safe = (value:string) => value.replace(/[^\w./:@-]/g, "");
const configuredCodexSandbox = process.env.CODEX_SANDBOX_MODE ?? "danger-full-access";
const codexSandboxMode = ["read-only","workspace-write","danger-full-access"].includes(configuredCodexSandbox)
  ? configuredCodexSandbox
  : "danger-full-access";
function codexEnvironment():NodeJS.ProcessEnv {
  const allowed = [
    "PATH","HOME","USERPROFILE","CODEX_HOME","APPDATA","LOCALAPPDATA",
    "SYSTEMROOT","COMSPEC","PATHEXT","TEMP","TMP","TMPDIR",
    "LANG","LC_ALL","SSL_CERT_FILE","SSL_CERT_DIR","NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY","HTTPS_PROXY","NO_PROXY",
  ];
  const environment:NodeJS.ProcessEnv = {
    NODE_ENV:process.env.NODE_ENV ?? "production",
    CI:"true",
    TERM:"dumb",
    NO_COLOR:"1",
  };
  for (const key of allowed) {
    if (process.env[key] !== undefined) environment[key]=process.env[key];
  }
  return environment;
}
function git(args:string[], cwd:string) {
  const token=process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN_NOT_CONFIGURED");
  const credentials=Buffer.from(`x-access-token:${token}`).toString("base64");
  return run("git",["-c",`http.extraHeader=Authorization: Basic ${credentials}`,...args],cwd,
    {GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"Never"},Math.max(30_000,Number(process.env.GIT_TIMEOUT_MS ?? 120_000)));
}
function run(command:string, args:string[], cwd:string, env:Partial<NodeJS.ProcessEnv> = {}, timeoutMs=Math.max(60_000,Number(process.env.COMMAND_TIMEOUT_MS ?? 10*60*1000))) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env:{...codexEnvironment(),...env},
      shell:false, windowsHide:true, stdio:["ignore","pipe","pipe"],
    });
    let output=""; child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
    let timedOut=false;
    const timeout=setTimeout(()=>{ timedOut=true; child.kill("SIGTERM"); setTimeout(()=>child.kill("SIGKILL"),5000).unref(); },timeoutMs);
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error(timedOut?`${command} excedeu o limite de ${Math.round(timeoutMs/1000)}s`:`${command} falhou (${code}): ${output.slice(-4000)}`));
    });
  });
}
function commandParts(command:string) {
  const [bin,...args]=command.trim().split(/\s+/);
  return {bin,args};
}
function validationSignature(error:unknown, repo:string) {
  const message=error instanceof Error?error.message:String(error);
  return message
    .replaceAll(repo,"<repo>")
    .replaceAll(repo.replaceAll("\\","/"),"<repo>")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g,"")
    .replace(/\r/g,"")
    .replace(/[ \t]+$/gm,"")
    .trim();
}
function runControlled(command:string,args:string[],cwd:string,job:Job,progressEventId:number) {
  const timeoutMs=Math.max(60_000,Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 30*60*1000));
  const activityTimeoutMs=Math.max(60_000,Number(process.env.CODEX_ACTIVITY_TIMEOUT_MS ?? 8*60*1000));
  const startupTimeoutMs=Math.max(30_000,Number(process.env.CODEX_START_TIMEOUT_MS ?? 90_000));
  return new Promise<string>((resolve,reject) => {
    const child=spawn(command,args,{
      // EasyPanel's container is the isolation boundary. Its nested Linux
      // sandbox cannot create namespaces. Never expose worker secrets here.
      cwd,env:{...codexEnvironment(),...job.test_environment},
      shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"],
    });
    let output=""; let stopping=false; let stdoutBuffer=""; let stderrBuffer=""; let latestActivity="Iniciando o Codex"; let lastActivityAt=Date.now(); let receivedStructuredEvent=false;
    const transcript:Array<{at:string;type:string;text:string}>=[];
    const recordActivity=(type:string,text:string) => {
      const clean=text.replace(/\s+/g," ").trim().slice(0,500);
      if (!clean || transcript.at(-1)?.text===clean) return;
      transcript.push({at:new Date().toISOString(),type,text:clean});
      if (transcript.length>60) transcript.shift();
      lastActivityAt=Date.now();
    };
    const activityFromEvent=(value:unknown) => {
      if (!value || typeof value !== "object") return;
      receivedStructuredEvent=true;
      lastActivityAt=Date.now();
      const record=value as Record<string,unknown>;
      const item=(record.item && typeof record.item === "object" ? record.item : {}) as Record<string,unknown>;
      if (item.type === "agent_message" && typeof item.text === "string") {
        latestActivity=item.text.replace(/\s+/g," ").slice(0,240); recordActivity("message",item.text);
      } else if (item.type === "command_execution") {
        latestActivity="Executando uma verificação no projeto"; recordActivity("action",latestActivity);
      } else if (item.type === "file_change") {
        latestActivity="Aplicando alterações nos arquivos"; recordActivity("action",latestActivity);
      } else if (item.type === "mcp_tool_call") {
        latestActivity="Consultando uma ferramenta"; recordActivity("action",latestActivity);
      }
      else if (item.type === "todo_list" && Array.isArray(item.items)) {
        const active=(item.items as Array<Record<string,unknown>>).find(entry=>entry.status==="in_progress");
        if (active && typeof active.text==="string") { latestActivity=active.text.slice(0,240); recordActivity("step",active.text); }
      } else if (record.type === "turn.started") { latestActivity="Analisando o chamado"; recordActivity("action",latestActivity); }
    };
    child.stdout.on("data",d => {
      const text=String(d); output+=text; stdoutBuffer+=text;
      const lines=stdoutBuffer.split(/\r?\n/); stdoutBuffer=lines.pop() ?? "";
      for (const line of lines) {
        try { activityFromEvent(JSON.parse(line)); } catch { /* ignora linhas não estruturadas */ }
      }
    });
    child.stderr.on("data",d => {
      const text=String(d); output+=text; stderrBuffer+=text;
      const lines=stderrBuffer.split(/\r?\n/); stderrBuffer=lines.pop() ?? "";
      for (const line of lines) {
        if (!/(error|warning|retry|rate.?limit|auth|login|connect|timeout|trusted directory|git.repo.check)/i.test(line)) continue;
        const safeLine=line.replace(/(bearer|token|authorization|github_pat)[=: ]+\S+/ig,"$1=[oculto]").slice(0,400);
        latestActivity=`Aviso do Codex: ${safeLine}`; recordActivity("warning",latestActivity);
      }
    });
    const stop=(reason:string) => {
      if (stopping) return; stopping=true; child.kill("SIGTERM");
      setTimeout(()=>child.kill("SIGKILL"),5000).unref();
      failureReason=reason;
    };
    let failureReason="";
    const timeout=setTimeout(()=>stop("CODEX_TIMEOUT"),timeoutMs);
    const cancellation=setInterval(async () => {
      try {
        const result=await db.query<{cancellation_requested:boolean}>("SELECT cancellation_requested FROM lb_tickets WHERE id=$1",[job.ticket_id]);
        if (result.rows[0]?.cancellation_requested) stop("EXECUTION_CANCELLED");
      } catch(error) { console.error("cancel-check:",error); }
    },2000);
    const startedAt=Date.now();
    const progress=setInterval(async () => {
      const elapsedSeconds=Math.floor((Date.now()-startedAt)/1000);
      const inactiveSeconds=Math.floor((Date.now()-lastActivityAt)/1000);
      if (!receivedStructuredEvent && Date.now()-startedAt>startupTimeoutMs) {
        stop("CODEX_STARTUP_NO_RESPONSE");
        return;
      }
      if (Date.now()-lastActivityAt>activityTimeoutMs) {
        stop("CODEX_NO_ACTIVITY");
        return;
      }
      try {
        await db.query("UPDATE lb_events SET message=$1,metadata=metadata || $2::jsonb WHERE id=$3",
          [`${latestActivity} · ${Math.floor(elapsedSeconds/60)}m ${elapsedSeconds%60}s`,JSON.stringify({elapsedSeconds,inactiveSeconds,lastSignal:new Date().toISOString(),latestActivity,receivedStructuredEvent,startupTimeoutSeconds:Math.round(startupTimeoutMs/1000),activityTimeoutMinutes:Math.round(activityTimeoutMs/60000),transcript}),progressEventId]);
      } catch(error) { console.error("progress-update:",error); }
    },5000);
    child.on("error",error => { clearTimeout(timeout); clearInterval(cancellation); clearInterval(progress); reject(error); });
    child.on("close",code => {
      clearTimeout(timeout); clearInterval(cancellation); clearInterval(progress);
      if (failureReason) reject(new Error(failureReason));
      else if (code===0) resolve(output);
      else reject(new Error(`${command} falhou (${code}): ${output.slice(-4000)}`));
    });
  });
}
async function event(job:Job, kind:string, message:string, metadata={}) {
  const result=await db.query<{id:number}>("INSERT INTO lb_events(ticket_id,execution_id,kind,message,metadata) VALUES($1,$2,$3,$4,$5) RETURNING id", [job.ticket_id,job.execution_id,kind,message,metadata]);
  return result.rows[0].id;
}
async function savePatch(job:Job, repo:string, committed=false) {
  if (!committed) await git(["add","-N","."],repo);
  const patch=committed ? await git(["format-patch","-1","--stdout"],repo) : await git(["diff","--binary","HEAD"],repo);
  if (!patch.trim()) return;
  await db.query(`INSERT INTO lb_artifacts(ticket_id,kind,name,storage_key,mime_type,size_bytes,content)
    VALUES($1,'patch',$2,$3,'text/x-diff',$4,$5)`,
    [job.ticket_id,`chamado-${job.ticket_id}.patch`,`db://${job.ticket_id}/chamado-${job.ticket_id}.patch`,Buffer.byteLength(patch),Buffer.from(patch)]);
}
async function createPullRequest(job:Job, branch:string) {
  const response=await fetch(`https://api.github.com/repos/${job.full_name}/pulls`,{
    method:"POST",
    headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,"X-GitHub-Api-Version":"2022-11-28","content-type":"application/json"},
    body:JSON.stringify({title:`fix: ${job.title}`,head:branch,base:job.default_branch,body:`Correção automática preparada pelo LionBan para o chamado #${job.ticket_id}.`}),
  });
  if (!response.ok) throw new Error(`GITHUB_PR_FAILED_${response.status}: ${(await response.text()).slice(0,1000)}`);
  return response.json() as Promise<{number:number; html_url:string}>;
}
async function triggerDeploy(job:Job) {
  if (!job.deploy_webhook_url) throw new Error("DEPLOY_WEBHOOK_NOT_CONFIGURED");
  await db.query("UPDATE lb_tickets SET deploy_status='in_progress',deploy_updated_at=now() WHERE id=$1",[job.ticket_id]);
  await event(job,"deploy.started","Deploy solicitado ao EasyPanel; aguardando confirmação de conclusão");
  try {
    const response=await fetch(job.deploy_webhook_url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticketId:job.ticket_id,repository:job.full_name})});
    if (!response.ok) throw new Error(`DEPLOY_WEBHOOK_FAILED_${response.status}`);
    await event(job,"deploy.triggered","EasyPanel aceitou a solicitação de deploy");
  } catch(error) {
    await db.query("UPDATE lb_tickets SET deploy_status='failed',deploy_updated_at=now() WHERE id=$1",[job.ticket_id]);
    throw error;
  }
}
async function requestApproval(job:Job, reason:string) {
  await db.query("UPDATE lb_tickets SET status='approval',updated_at=now() WHERE id=$1",[job.ticket_id]);
  await db.query("INSERT INTO lb_approvals(ticket_id,execution_id,reason) VALUES($1,$2,$3)",[job.ticket_id,job.execution_id,reason]);
  await db.query("UPDATE lb_executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]);
  await event(job,"approval.requested","Aprovação do usuário solicitada",{reason});
}
async function finishApprovedPatchOnly(job:Job, summary:string) {
  await db.query("UPDATE lb_tickets SET status='completed',result_summary=$1,updated_at=now() WHERE id=$2",[summary,job.ticket_id]);
  await db.query("UPDATE lb_executions SET state='completed',finished_at=now() WHERE id=$1",[job.execution_id]);
  await event(job,"approval.completed",summary);
}
async function synchronizePackageVersion(job:Job, repo:string) {
  if (!job.create_tag || !job.release_tag) return;
  const packagePath=path.join(repo,"package.json");
  let packageJson:{version?:string};
  try {
    packageJson=JSON.parse(await readFile(packagePath,"utf8")) as {version?:string};
  } catch(error) {
    if (error instanceof Error && "code" in error && error.code==="ENOENT") {
      await event(job,"version.skipped","Tag solicitada, mas o repositório não possui package.json",{tag:job.release_tag});
      return;
    }
    throw error;
  }
  const version=job.release_tag.replace(/^v/,"");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("RELEASE_TAG_NOT_VALID_SEMVER");
  }
  if (packageJson.version!==version) {
    await run("npm",["version",version,"--no-git-tag-version","--allow-same-version","--ignore-scripts"],repo,{
      NODE_ENV:"development",NPM_CONFIG_PRODUCTION:"false",
    });
  }
  const updated=JSON.parse(await readFile(packagePath,"utf8")) as {version?:string};
  if (updated.version!==version) throw new Error("PACKAGE_VERSION_NOT_SYNCHRONIZED");
  await event(job,"version.updated",`Versão do package.json sincronizada com ${job.release_tag}`,{
    previousVersion:packageJson.version ?? null,version,tag:job.release_tag,
  });
}
async function assertNotCancelled(job:Job) {
  const result=await db.query<{cancellation_requested:boolean}>("SELECT cancellation_requested FROM lb_tickets WHERE id=$1",[job.ticket_id]);
  if (result.rows[0]?.cancellation_requested) throw new Error("EXECUTION_CANCELLED");
}
async function heartbeat(codexAuthenticated:boolean, statusMessage:string) {
  await db.query(`INSERT INTO lb_worker_heartbeats(worker_id,last_seen,codex_authenticated,status_message)
    VALUES($1,now(),$2,$3)
    ON CONFLICT(worker_id) DO UPDATE SET last_seen=now(),codex_authenticated=EXCLUDED.codex_authenticated,status_message=EXCLUDED.status_message`,
    [workerId,codexAuthenticated,statusMessage]);
}
async function codexStatus() {
  try {
    await run(process.env.CODEX_BIN ?? "codex",["login","status"],tmpdir());
    return { authenticated:true, message:"Codex autenticado e pronto." };
  } catch {
    return { authenticated:false, message:"Execute codex login --device-auth no worker." };
  }
}
async function claim():Promise<Job|null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const control=await client.query<{queue_paused:boolean}>(
      "SELECT queue_paused FROM lb_worker_control WHERE singleton=true FOR SHARE",
    );
    if (control.rows[0]?.queue_paused) {
      await client.query("ROLLBACK");
      return null;
    }
    const result = await client.query<Job>(`SELECT e.id execution_id,e.ticket_id,e.application_id,t.title,t.description,t.priority,
      a.full_name,a.github_repo_id,a.default_branch,a.clone_url,a.install_command,a.test_command,a.lint_command,a.build_command,a.test_environment,
      t.auto_commit,t.auto_push,t.auto_pull_request,t.auto_deploy,a.deploy_webhook_url,t.create_tag,t.release_tag,e.resume_artifact_id
      FROM lb_executions e JOIN lb_tickets t ON t.id=e.ticket_id JOIN lb_applications a ON a.id=e.application_id
      WHERE e.state='queued' AND a.enabled=true
        AND NOT EXISTS (
          SELECT 1 FROM lb_executions active
          WHERE active.application_id=e.application_id AND active.state='running'
        )
      ORDER BY t.queue_priority ASC,t.created_at ASC,e.attempt ASC
      FOR UPDATE OF e SKIP LOCKED LIMIT 1`);
    if (!result.rowCount) { await client.query("ROLLBACK"); return null; }
    const job=result.rows[0];
    await client.query("UPDATE lb_executions SET state='running',worker_id=$1,started_at=now() WHERE id=$2",[workerId,job.execution_id]);
    await client.query("UPDATE lb_tickets SET status='analyzing',updated_at=now() WHERE id=$1",[job.ticket_id]);
    await client.query("COMMIT"); return job;
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function recoverInterruptedJobs() {
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    const recovered=await client.query<{ticket_id:number}>(`UPDATE lb_executions
      SET state='queued',worker_id=NULL,started_at=NULL,error_message=NULL
      WHERE state='running' RETURNING ticket_id`);
    for (const row of recovered.rows) {
      await client.query("UPDATE lb_tickets SET status='open',cancellation_requested=false,updated_at=now() WHERE id=$1",[row.ticket_id]);
      await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'execution.recovered','Execução interrompida foi recuperada e voltou para a fila')",[row.ticket_id]);
    }
    await client.query("COMMIT");
    if (recovered.rowCount) console.log(`${recovered.rowCount} execução(ões) recuperada(s)`);
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function publishChanges(job:Job, repo:string, branch:string, approvedResume=false) {
  if (!job.auto_commit) {
    if (approvedResume || job.priority==="low" || job.priority==="medium") {
      await finishApprovedPatchOnly(job,`${approvedResume?"Correção aprovada":"Correção concluída"} e preservada como patch; commit automático não foi solicitado`);
      return;
    }
    await savePatch(job,repo);
    await event(job,"patch.prepared","Correção preparada sem commit automático");
    await requestApproval(job,"Revise o patch preservado antes de concluir o chamado");
    return;
  }
  await synchronizePackageVersion(job,repo);
  await git(["add","-A"],repo);
  await git(["commit","-m",job.title.trim().slice(0,200)],repo);
  await event(job,"commit.created","Commit automático criado");
  if (!job.auto_push) {
    await savePatch(job,repo,true);
    if (approvedResume || job.priority==="low" || job.priority==="medium") {
      await finishApprovedPatchOnly(job,`${approvedResume?"Correção aprovada":"Correção concluída"} e preservada como commit em patch; push automático não foi solicitado`);
      return;
    }
    await requestApproval(job,"Revise o commit preservado antes de concluir o chamado");
    return;
  }
  await git(["push","origin",branch],repo);
  await event(job,"branch.pushed","Branch enviada automaticamente ao GitHub",{branch});
  if (job.auto_pull_request) {
    const pullRequest=await createPullRequest(job,branch);
    await event(job,"pull_request.created",`Pull Request #${pullRequest.number} criado`,{url:pullRequest.html_url,number:pullRequest.number});
    await db.query("UPDATE lb_tickets SET status='approval',result_summary=$1 WHERE id=$2",[`Pull Request #${pullRequest.number}: ${pullRequest.html_url}`,job.ticket_id]);
    await db.query("UPDATE lb_executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]);
    await db.query("INSERT INTO lb_approvals(ticket_id,execution_id,reason) VALUES($1,$2,$3)",[job.ticket_id,job.execution_id,`Autorize e faça o merge do Pull Request #${pullRequest.number} no GitHub`]);
    return;
  }
  await git(["checkout",safe(job.default_branch)],repo);
  await git(["pull","--ff-only","origin",safe(job.default_branch)],repo);
  await git(["merge","--no-ff",branch,"-m",job.title.trim().slice(0,200)],repo);
  await git(["push","origin",safe(job.default_branch)],repo);
  if (job.create_tag && job.release_tag) {
    await git(["tag","-a",safe(job.release_tag),"-m",`Release ${job.release_tag} - LionBan chamado #${job.ticket_id}`],repo);
    await git(["push","origin",safe(job.release_tag)],repo);
    await event(job,"tag.created",`Tag ${job.release_tag} criada e enviada; GitHub Actions por tag podem ser iniciadas`,{tag:job.release_tag});
  }
  if (job.auto_deploy) await triggerDeploy(job);
  await db.query("UPDATE lb_tickets SET status='completed',result_summary='Correção testada e integrada automaticamente',updated_at=now() WHERE id=$1",[job.ticket_id]);
  await db.query("UPDATE lb_executions SET state='completed',finished_at=now() WHERE id=$1",[job.execution_id]);
  await event(job,"merge.completed","Correção validada e integrada à branch principal");
}
async function processJob(job:Job) {
  const root=await mkdtemp(path.join(tmpdir(),`lionban-${job.ticket_id}-`)); const repo=path.join(root,"repo");
  try {
    await event(job,"repository.validating",`Validando acesso ao repositório ${job.full_name}`);
    if (!await validateRepo(job.full_name, Number(job.github_repo_id))) throw new Error("REPOSITORY_NOT_AUTHORIZED");
    const branch=`lionban/chamado-${job.ticket_id}`;
    await event(job,"repository.cloning",`Clonando ${job.full_name}`);
    await git(["clone","--branch",safe(job.default_branch),"--single-branch",safe(job.clone_url),repo],root);
    const base=(await git(["rev-parse","HEAD"],repo)).trim();
    await git(["checkout","-b",branch],repo);
    await git(["config","user.name",process.env.GIT_AUTHOR_NAME?.trim() || "LionBan Bot"],repo);
    await git(["config","user.email",process.env.GIT_AUTHOR_EMAIL?.trim() || "lionban@users.noreply.github.com"],repo);
    await db.query("UPDATE lb_tickets SET branch_name=$1,base_commit=$2 WHERE id=$3",[branch,base,job.ticket_id]);
    await event(job,"repository.cloned",`Repositório ${job.full_name} validado e clonado`,{branch,base});
    await assertNotCancelled(job);
    let installCommand=job.install_command;
    if (!installCommand) {
      try { await readFile(path.join(repo,"package-lock.json")); installCommand="npm ci"; } catch { /* projeto sem package-lock */ }
    }
    if (installCommand) {
      await event(job,"dependencies.installing","Instalando dependências da aplicação",{command:installCommand,automatic:!job.install_command});
      const [bin,...args]=installCommand.split(/\s+/);
      await run(bin,args,repo,{NODE_ENV:"development",NPM_CONFIG_PRODUCTION:"false",NPM_CONFIG_INCLUDE:"dev",...job.test_environment});
      await event(job,"dependencies.installed","Dependências da aplicação instaladas");
      await assertNotCancelled(job);
    }
    if (job.resume_artifact_id) {
      const artifact=await db.query<{content:Buffer}>(
        "SELECT content FROM lb_artifacts WHERE id=$1 AND ticket_id=$2 AND kind='patch'",
        [job.resume_artifact_id,job.ticket_id],
      );
      if (!artifact.rowCount || !artifact.rows[0].content) throw new Error("APPROVED_PATCH_NOT_FOUND");
      const patchPath=path.join(root,"approved.patch");
      await writeFile(patchPath,artifact.rows[0].content);
      await git(["apply","--binary",patchPath],repo);
      await event(job,"approval.restored","Patch aprovado restaurado em um clone limpo");
      await publishChanges(job,repo,branch,true);
      return;
    }
    const validationCommands=[job.test_command,job.lint_command,job.build_command].filter(Boolean) as string[];
    const baselineFailures=new Map<string,string>();
    for (const command of validationCommands) {
      const {bin,args}=commandParts(command);
      try {
        await run(bin,args,repo,job.test_environment);
        await event(job,"validation.baseline_passed",`Validação inicial passou: ${command}`,{command});
      } catch(error) {
        baselineFailures.set(command,validationSignature(error,repo));
        await event(job,"validation.baseline_failed",`Falha preexistente detectada antes da correção: ${command}`,{
          command,error:validationSignature(error,repo).slice(-2000),
        });
      }
      await assertNotCancelled(job);
    }
    const artifactRows = await db.query<{name:string; content:Buffer}>(
      "SELECT name,content FROM lb_artifacts WHERE ticket_id=$1 AND kind='screenshot' AND content IS NOT NULL ORDER BY created_at",
      [job.ticket_id],
    );
    let attachmentNote="";
    if (artifactRows.rowCount) {
      const attachmentDir=path.join(repo,".lionban-attachments"); await mkdir(attachmentDir,{recursive:true});
      for (const [index,artifact] of artifactRows.rows.entries()) {
        const name=`${index+1}-${artifact.name.replace(/[^\w.-]/g,"_")}`; await writeFile(path.join(attachmentDir,name),artifact.content);
      }
      attachmentNote=`\nHá ${artifactRows.rowCount} captura(s) de tela em .lionban-attachments/. Analise essas imagens como evidência do bug. Não inclua essa pasta no commit.`;
    }
    const baselineNote=baselineFailures.size
      ? `\nValidações que já falhavam antes da sua alteração: ${[...baselineFailures.keys()].join(", ")}. Não esconda essas falhas; evite introduzir erros novos e informe o que permaneceu preexistente.\n`
      : "";
    const prompt=`Você está corrigindo o chamado #${job.ticket_id} do LionBan.
Título: ${job.title}
Criticidade: ${{low:"Baixa",medium:"Média",high:"Alta",critical:"Crítica"}[job.priority]}
Descrição: ${job.description}${attachmentNote}${baselineNote}

Fluxo obrigatório:
1. Antes de alterar código, localize e leia a documentação e as instruções do projeto: AGENTS.md, README, CONTRIBUTING, CHANGELOG, a pasta docs/ e arquivos equivalentes que existirem.
2. Siga as convenções, comandos e arquitetura documentados pelo próprio projeto.
3. Primeiro reproduza o bug com um teste que falha. Depois faça a menor correção segura.
4. Ao terminar a correção, atualize a documentação afetada para refletir o comportamento novo. Se não existir documentação específica, atualize README, CHANGELOG ou crie uma nota curta em docs/.
5. Execute os testes relevantes e produza um resumo final, incluindo quais documentos foram consultados e atualizados.

Não faça commit, push, merge, deploy, nem acesse fora deste diretório.`;
    await db.query("UPDATE lb_tickets SET status='fixing' WHERE id=$1",[job.ticket_id]);
    const progressEventId=await event(job,"codex.started","Codex iniciou a análise e correção",{timeoutMinutes:Math.round(Math.max(60_000,Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 30*60*1000))/60000),elapsedSeconds:0,lastSignal:new Date().toISOString(),prompt,transcript:[]});
    await runControlled(process.env.CODEX_BIN ?? "codex",["exec","--sandbox",codexSandboxMode,"--skip-git-repo-check","--json",prompt],repo,job,progressEventId);
    await assertNotCancelled(job);
    const changedFiles=(await git(["status","--porcelain"],repo)).split(/\r?\n/).filter(Boolean).map(line=>line.slice(3).trim());
    const documentationChanged=changedFiles.some(file=>/(^|\/)(readme|changelog|contributing|agents)(\.|$)|(^|\/)docs\/|\.md$/i.test(file));
    if (!documentationChanged) {
      const documentationPrompt=`A correção do chamado #${job.ticket_id} foi implementada, mas nenhum arquivo de documentação foi atualizado.
Leia a documentação existente do projeto e documente objetivamente a mudança "${job.title}".
Prefira atualizar o documento mais relevante. Se não existir, atualize README/CHANGELOG ou crie uma nota curta em docs/.
Não altere a implementação, não faça commit, push, merge ou deploy.`;
      const documentationEventId=await event(job,"documentation.started","Atualização obrigatória da documentação iniciada",{timeoutMinutes:Math.round(Math.max(60_000,Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 30*60*1000))/60000),elapsedSeconds:0,lastSignal:new Date().toISOString(),prompt:documentationPrompt,transcript:[]});
      await runControlled(process.env.CODEX_BIN ?? "codex",["exec","--sandbox",codexSandboxMode,"--skip-git-repo-check","--json",documentationPrompt],repo,job,documentationEventId);
      const documentedFiles=(await git(["status","--porcelain"],repo)).split(/\r?\n/).filter(Boolean).map(line=>line.slice(3).trim()).filter(file=>/(^|\/)(readme|changelog|contributing|agents)(\.|$)|(^|\/)docs\/|\.md$/i.test(file));
      if (!documentedFiles.length) throw new Error("DOCUMENTATION_NOT_UPDATED");
      await event(job,"documentation.updated","Documentação do projeto atualizada",{files:documentedFiles});
    } else {
      await event(job,"documentation.updated","Documentação do projeto atualizada",{files:changedFiles.filter(file=>/(^|\/)(readme|changelog|contributing|agents)(\.|$)|(^|\/)docs\/|\.md$/i.test(file))});
    }
    await rm(path.join(repo,".lionban-attachments"),{recursive:true,force:true});
    const changed=(await git(["status","--porcelain"],repo)).trim();
    if (!changed) throw new Error("NO_CHANGES");
    await db.query("UPDATE lb_tickets SET status='testing' WHERE id=$1",[job.ticket_id]);
    for (const command of validationCommands) {
      const {bin,args}=commandParts(command);
      try {
        await run(bin,args,repo,job.test_environment);
        await event(job,"validation.passed",`Validação passou após a correção: ${command}`,{command});
      } catch(error) {
        const currentSignature=validationSignature(error,repo);
        const baselineSignature=baselineFailures.get(command);
        if (baselineSignature===currentSignature) {
          await event(job,"validation.preexisting",`Falha preexistente permaneceu sem alteração: ${command}`,{
            command,error:currentSignature.slice(-2000),
          });
          await assertNotCancelled(job);
          continue;
        }
        await savePatch(job,repo);
        await event(job,"patch.prepared","Correção preservada após falha de validação",{command});
        await requestApproval(job,`A validação "${command}" apresentou uma falha nova ou diferente. O patch foi preservado para revisão.`);
        return;
      }
      await assertNotCancelled(job);
    }
    const requiresSeverityApproval=job.priority==="high" || job.priority==="critical";
    if (!job.test_command && requiresSeverityApproval) {
      await savePatch(job,repo);
      await event(job,"patch.prepared","Correção preservada para aprovação excepcional");
      await requestApproval(job,`Chamado de criticidade ${job.priority==="critical"?"Crítica":"Alta"} sem comando de teste confiável configurado`);
      return;
    }
    if (requiresSeverityApproval) {
      await savePatch(job,repo);
      await event(job,"patch.prepared","Correção preservada antes da aprovação por criticidade");
      await requestApproval(job,`Chamados de criticidade ${job.priority==="critical"?"Crítica":"Alta"} exigem aprovação antes de publicar`);
      return;
    }
    await publishChanges(job,repo,branch);
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    const cancelled=message === "EXECUTION_CANCELLED";
    await db.query("UPDATE lb_tickets SET status=$1,updated_at=now() WHERE id=$2",[cancelled?"cancelled":"failed",job.ticket_id]);
    await db.query("UPDATE lb_executions SET state=$1,finished_at=now(),error_message=$2 WHERE id=$3",[cancelled?"cancelled":"failed",cancelled?null:message.slice(0,4000),job.execution_id]);
    await event(job,cancelled?"execution.cancelled":"execution.failed",cancelled?"Execução cancelada":"A execução falhou",cancelled?{}:{error:message.slice(0,1000)});
  } finally { await rm(root,{recursive:true,force:true}); }
}
async function applyRetentionPolicy() {
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    const settings=await client.query<{archive_after_days:number;delete_after_days:number}>(
      "SELECT archive_after_days,delete_after_days FROM lb_settings WHERE singleton=true FOR SHARE",
    );
    const archiveDays=settings.rows[0]?.archive_after_days ?? 7;
    const deleteDays=settings.rows[0]?.delete_after_days ?? 15;
    await client.query(`UPDATE lb_tickets SET archived_at=now()
      WHERE archived_at IS NULL AND status IN ('completed','failed','cancelled')
        AND updated_at <= now()-($1::text || ' days')::interval`,[archiveDays]);
    const expired=await client.query<{id:number}>(`SELECT id FROM lb_tickets
      WHERE status IN ('completed','failed','cancelled')
        AND updated_at <= now()-($1::text || ' days')::interval FOR UPDATE`,[deleteDays]);
    for (const row of expired.rows) {
      await client.query("DELETE FROM lb_approvals WHERE ticket_id=$1",[row.id]);
      await client.query("DELETE FROM lb_executions WHERE ticket_id=$1",[row.id]);
      await client.query("DELETE FROM lb_tickets WHERE id=$1",[row.id]);
    }
    await client.query("COMMIT");
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function main() {
  console.log(`${workerId} iniciado`);
  await recoverInterruptedJobs();
  const status=await codexStatus();
  await heartbeat(status.authenticated,status.message);
  const timer=setInterval(() => heartbeat(status.authenticated,status.message).catch(error => console.error("heartbeat:",error)),10000);
  timer.unref();
  await applyRetentionPolicy();
  const retentionTimer=setInterval(()=>applyRetentionPolicy().catch(error=>console.error("retention:",error)),60*60*1000);
  retentionTimer.unref();
  for (;;) { const job=await claim(); if (job) await processJob(job); else await new Promise(r=>setTimeout(r,3000)); }
}
main().catch(error => { console.error(error); process.exit(1); });
