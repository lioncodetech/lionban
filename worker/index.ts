import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "../src/lib/db";
import { validateRepo } from "../src/lib/github";

type Job = { execution_id:string; ticket_id:number; application_id:string; title:string; description:string; full_name:string; github_repo_id:number; default_branch:string; clone_url:string; install_command?:string; test_command?:string; lint_command?:string; build_command?:string };
const workerId = `worker-${process.pid}`;
const safe = (value:string) => value.replace(/[^\w./:@-]/g, "");
function run(command:string, args:string[], cwd:string, env:Partial<NodeJS.ProcessEnv> = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env:{...process.env,...env}, shell:false, windowsHide:true });
    let output=""; child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${command} falhou (${code}): ${output.slice(-4000)}`)));
  });
}
async function event(job:Job, kind:string, message:string, metadata={}) {
  await db.query("INSERT INTO events(ticket_id,execution_id,kind,message,metadata) VALUES($1,$2,$3,$4,$5)", [job.ticket_id,job.execution_id,kind,message,metadata]);
}
async function claim():Promise<Job|null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Job>(`SELECT e.id execution_id,e.ticket_id,e.application_id,t.title,t.description,
      a.full_name,a.github_repo_id,a.default_branch,a.clone_url,a.install_command,a.test_command,a.lint_command,a.build_command
      FROM executions e JOIN tickets t ON t.id=e.ticket_id JOIN applications a ON a.id=e.application_id
      WHERE e.state='queued' AND a.enabled=true ORDER BY t.created_at FOR UPDATE OF e SKIP LOCKED LIMIT 1`);
    if (!result.rowCount) { await client.query("ROLLBACK"); return null; }
    const job=result.rows[0];
    await client.query("UPDATE executions SET state='running',worker_id=$1,started_at=now() WHERE id=$2",[workerId,job.execution_id]);
    await client.query("UPDATE tickets SET status='analyzing',updated_at=now() WHERE id=$1",[job.ticket_id]);
    await client.query("COMMIT"); return job;
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function processJob(job:Job) {
  const root=await mkdtemp(path.join(tmpdir(),`lionban-${job.ticket_id}-`)); const repo=path.join(root,"repo");
  try {
    if (!await validateRepo(job.full_name, Number(job.github_repo_id))) throw new Error("REPOSITORY_NOT_AUTHORIZED");
    const branch=`lionban/chamado-${job.ticket_id}`;
    await run("git",["clone","--branch",safe(job.default_branch),"--single-branch",safe(job.clone_url),repo],root);
    const base=(await run("git",["rev-parse","HEAD"],repo)).trim();
    await run("git",["checkout","-b",branch],repo);
    await db.query("UPDATE tickets SET branch_name=$1,base_commit=$2 WHERE id=$3",[branch,base,job.ticket_id]);
    await event(job,"repository.cloned",`Repositório ${job.full_name} validado e clonado`,{branch,base});
    const prompt=`Você está corrigindo o chamado #${job.ticket_id} do LionBan.\nTítulo: ${job.title}\nDescrição: ${job.description}\nPrimeiro reproduza o bug com um teste que falha. Depois faça a menor correção segura. Não faça commit, push, merge, deploy, nem acesse fora deste diretório. Execute os testes relevantes e produza um resumo final.`;
    await db.query("UPDATE tickets SET status='fixing' WHERE id=$1",[job.ticket_id]);
    await run(process.env.CODEX_BIN ?? "codex",["exec","--full-auto",prompt],repo);
    await db.query("UPDATE tickets SET status='testing' WHERE id=$1",[job.ticket_id]);
    for (const command of [job.test_command,job.lint_command,job.build_command].filter(Boolean) as string[]) {
      const [bin,...args]=command.split(/\s+/); await run(bin,args,repo);
    }
    const changed=(await run("git",["status","--porcelain"],repo)).trim();
    if (!changed) throw new Error("NO_CHANGES");
    if (!job.test_command) {
      await db.query("UPDATE tickets SET status='approval' WHERE id=$1",[job.ticket_id]);
      await db.query("INSERT INTO approvals(ticket_id,execution_id,reason) VALUES($1,$2,'Nenhum comando de teste confiável configurado')",[job.ticket_id,job.execution_id]);
      await db.query("UPDATE executions SET state='waiting_approval' WHERE id=$1",[job.execution_id]); return;
    }
    await run("git",["add","-A"],repo); await run("git",["commit","-m",`fix: resolve chamado #${job.ticket_id}`],repo);
    await run("git",["push","origin",branch],repo);
    await run("git",["checkout",safe(job.default_branch)],repo); await run("git",["pull","--ff-only","origin",safe(job.default_branch)],repo);
    await run("git",["merge","--no-ff",branch,"-m",`merge: LionBan chamado #${job.ticket_id}`],repo);
    await run("git",["push","origin",safe(job.default_branch)],repo);
    await db.query("UPDATE tickets SET status='completed',result_summary='Correção testada e integrada automaticamente',updated_at=now() WHERE id=$1",[job.ticket_id]);
    await db.query("UPDATE executions SET state='completed',finished_at=now() WHERE id=$1",[job.execution_id]);
    await event(job,"merge.completed","Correção validada e integrada à branch principal");
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    await db.query("UPDATE tickets SET status='failed',updated_at=now() WHERE id=$1",[job.ticket_id]);
    await db.query("UPDATE executions SET state='failed',finished_at=now(),error_message=$1 WHERE id=$2",[message.slice(0,4000),job.execution_id]);
    await event(job,"execution.failed","A execução falhou",{error:message.slice(0,1000)});
  } finally { await rm(root,{recursive:true,force:true}); }
}
async function main() {
  console.log(`${workerId} iniciado`);
  for (;;) { const job=await claim(); if (job) await processJob(job); else await new Promise(r=>setTimeout(r,3000)); }
}
main().catch(error => { console.error(error); process.exit(1); });
