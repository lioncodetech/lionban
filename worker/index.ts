import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "../src/lib/db";
import { validateRepo } from "../src/lib/github";

type Job = { execution_id:string; ticket_id:number; application_id:string; title:string; description:string; full_name:string; github_repo_id:number; default_branch:string; clone_url:string; install_command?:string; test_command?:string; lint_command?:string; build_command?:string; auto_commit:boolean; auto_push:boolean; auto_pull_request:boolean; auto_deploy:boolean; deploy_webhook_url?:string; create_tag:boolean; release_tag?:string };
const workerId = `worker-${process.pid}`;
const safe = (value:string) => value.replace(/[^\w./:@-]/g, "");
function git(args:string[], cwd:string) {
  const token=process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN_NOT_CONFIGURED");
  const credentials=Buffer.from(`x-access-token:${token}`).toString("base64");
  return run("git",["-c",`http.extraHeader=Authorization: Basic ${credentials}`,...args],cwd);
}
function run(command:string, args:string[], cwd:string, env:Partial<NodeJS.ProcessEnv> = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env:{...process.env,...env}, shell:false, windowsHide:true });
    let output=""; child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${command} falhou (${code}): ${output.slice(-4000)}`)));
  });
}
function runControlled(command:string,args:string[],cwd:string,job:Job) {
  const timeoutMs=Math.max(60_000,Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 30*60*1000));
  return new Promise<string>((resolve,reject) => {
    const child=spawn(command,args,{cwd,env:process.env,shell:false,windowsHide:true});
    let output=""; let stopping=false;
    child.stdout.on("data",d => output+=d); child.stderr.on("data",d => output+=d);
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
    child.on("error",error => { clearTimeout(timeout); clearInterval(cancellation); reject(error); });
    child.on("close",code => {
      clearTimeout(timeout); clearInterval(cancellation);
      if (failureReason) reject(new Error(failureReason));
      else if (code===0) resolve(output);
      else reject(new Error(`${command} falhou (${code}): ${output.slice(-4000)}`));
    });
  });
}
async function event(job:Job, kind:string, message:string, metadata={}) {
  await db.query("INSERT INTO lb_events(ticket_id,execution_id,kind,message,metadata) VALUES($1,$2,$3,$4,$5)", [job.ticket_id,job.execution_id,kind,message,metadata]);
}
async function savePatch(job:Job, repo:string, committed=false) {
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
  const response=await fetch(job.deploy_webhook_url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticketId:job.ticket_id,repository:job.full_name})});
  if (!response.ok) throw new Error(`DEPLOY_WEBHOOK_FAILED_${response.status}`);
  await event(job,"deploy.triggered","Deploy automático solicitado ao EasyPanel");
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
    const result = await client.query<Job>(`SELECT e.id execution_id,e.ticket_id,e.application_id,t.title,t.description,
      a.full_name,a.github_repo_id,a.default_branch,a.clone_url,a.install_command,a.test_command,a.lint_command,a.build_command,
      t.auto_commit,t.auto_push,t.auto_pull_request,t.auto_deploy,a.deploy_webhook_url,t.create_tag,t.release_tag
      FROM lb_executions e JOIN lb_tickets t ON t.id=e.ticket_id JOIN lb_applications a ON a.id=e.application_id
      WHERE e.state='queued' AND a.enabled=true ORDER BY t.created_at FOR UPDATE OF e SKIP LOCKED LIMIT 1`);
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
async function processJob(job:Job) {
  const root=await mkdtemp(path.join(tmpdir(),`lionban-${job.ticket_id}-`)); const repo=path.join(root,"repo");
  try {
    if (!await validateRepo(job.full_name, Number(job.github_repo_id))) throw new Error("REPOSITORY_NOT_AUTHORIZED");
    const branch=`lionban/chamado-${job.ticket_id}`;
    await git(["clone","--branch",safe(job.default_branch),"--single-branch",safe(job.clone_url),repo],root);
    const base=(await git(["rev-parse","HEAD"],repo)).trim();
    await git(["checkout","-b",branch],repo);
    await db.query("UPDATE lb_tickets SET branch_name=$1,base_commit=$2 WHERE id=$3",[branch,base,job.ticket_id]);
    await event(job,"repository.cloned",`Repositório ${job.full_name} validado e clonado`,{branch,base});
    await assertNotCancelled(job);
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
    const prompt=`Você está corrigindo o chamado #${job.ticket_id} do LionBan.\nTítulo: ${job.title}\nDescrição: ${job.description}${attachmentNote}\nPrimeiro reproduza o bug com um teste que falha. Depois faça a menor correção segura. Não faça commit, push, merge, deploy, nem acesse fora deste diretório. Execute os testes relevantes e produza um resumo final.`;
    await db.query("UPDATE lb_tickets SET status='fixing' WHERE id=$1",[job.ticket_id]);
    await event(job,"codex.started","Codex iniciou a análise e correção",{timeoutMinutes:Math.round(Math.max(60_000,Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 30*60*1000))/60000)});
    await runControlled(process.env.CODEX_BIN ?? "codex",["exec","--full-auto",prompt],repo,job);
    await assertNotCancelled(job);
    await db.query("UPDATE lb_tickets SET status='testing' WHERE id=$1",[job.ticket_id]);
    for (const command of [job.test_command,job.lint_command,job.build_command].filter(Boolean) as string[]) {
      const [bin,...args]=command.split(/\s+/); await run(bin,args,repo);
      await assertNotCancelled(job);
    }
    const changed=(await git(["status","--porcelain"],repo)).trim();
    if (!changed) throw new Error("NO_CHANGES");
    if (!job.test_command) {
      await db.query("UPDATE lb_tickets SET status='approval' WHERE id=$1",[job.ticket_id]);
      await db.query("INSERT INTO lb_approvals(ticket_id,execution_id,reason) VALUES($1,$2,'Nenhum comando de teste confiável configurado')",[job.ticket_id,job.execution_id]);
      await db.query("UPDATE lb_executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]); return;
    }
    await rm(path.join(repo,".lionban-attachments"),{recursive:true,force:true});
    if (!job.auto_commit) {
      await savePatch(job,repo);
      await event(job,"patch.prepared","Correção preparada sem commit automático");
      await db.query("UPDATE lb_tickets SET status='approval' WHERE id=$1",[job.ticket_id]);
      await db.query("UPDATE lb_executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]); return;
    }
    await git(["add","-A"],repo); await git(["commit","-m",`fix: resolve chamado #${job.ticket_id}`],repo);
    await event(job,"commit.created","Commit automático criado");
    if (!job.auto_push) {
      await savePatch(job,repo,true);
      await db.query("UPDATE lb_tickets SET status='approval' WHERE id=$1",[job.ticket_id]);
      await db.query("UPDATE lb_executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]); return;
    }
    await git(["push","origin",branch],repo);
    await event(job,"branch.pushed","Branch enviada automaticamente ao GitHub",{branch});
    if (job.auto_pull_request) {
      const pullRequest=await createPullRequest(job,branch);
      await event(job,"pull_request.created",`Pull Request #${pullRequest.number} criado`,{url:pullRequest.html_url,number:pullRequest.number});
      await db.query("UPDATE lb_tickets SET status='approval',result_summary=$1 WHERE id=$2",[`Pull Request #${pullRequest.number}: ${pullRequest.html_url}`,job.ticket_id]);
      await db.query("UPDATE lb_executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]); return;
    }
    await git(["checkout",safe(job.default_branch)],repo); await git(["pull","--ff-only","origin",safe(job.default_branch)],repo);
    await git(["merge","--no-ff",branch,"-m",`merge: LionBan chamado #${job.ticket_id}`],repo);
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
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    const cancelled=message === "EXECUTION_CANCELLED";
    await db.query("UPDATE lb_tickets SET status=$1,updated_at=now() WHERE id=$2",[cancelled?"cancelled":"failed",job.ticket_id]);
    await db.query("UPDATE lb_executions SET state=$1,finished_at=now(),error_message=$2 WHERE id=$3",[cancelled?"cancelled":"failed",cancelled?null:message.slice(0,4000),job.execution_id]);
    await event(job,cancelled?"execution.cancelled":"execution.failed",cancelled?"Execução cancelada":"A execução falhou",cancelled?{}:{error:message.slice(0,1000)});
  } finally { await rm(root,{recursive:true,force:true}); }
}
async function main() {
  console.log(`${workerId} iniciado`);
  await recoverInterruptedJobs();
  const status=await codexStatus();
  await heartbeat(status.authenticated,status.message);
  const timer=setInterval(() => heartbeat(status.authenticated,status.message).catch(error => console.error("heartbeat:",error)),10000);
  timer.unref();
  for (;;) { const job=await claim(); if (job) await processJob(job); else await new Promise(r=>setTimeout(r,3000)); }
}
main().catch(error => { console.error(error); process.exit(1); });
