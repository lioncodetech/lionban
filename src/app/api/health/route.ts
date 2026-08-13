import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [result,control,metrics] = await Promise.all([
      query<{
        codex_authenticated:boolean; status_message:string|null; last_seen:string; worker_online:boolean;
      }>(`SELECT codex_authenticated,status_message,last_seen,
        last_seen > now() - interval '35 seconds' worker_online
        FROM lwf_worker_heartbeats ORDER BY last_seen DESC LIMIT 1`),
      query<{queue_paused:boolean;pause_reason:string|null}>("SELECT queue_paused,pause_reason FROM lwf_worker_control WHERE singleton=true"),
      query<{queued:string;running:string;waiting_approval:string;failed_24h:string;deploy_locks:string}>(`SELECT
        (SELECT count(*) FROM lwf_executions WHERE state='queued')::text queued,
        (SELECT count(*) FROM lwf_executions WHERE state='running')::text running,
        (SELECT count(*) FROM lwf_tickets WHERE status='approval' AND archived_at IS NULL)::text waiting_approval,
        (SELECT count(*) FROM lwf_executions WHERE state='failed' AND finished_at>now()-interval '24 hours')::text failed_24h,
        (SELECT count(*) FROM lwf_application_deploy_locks)::text deploy_locks`),
    ]);
    const worker=result.rows[0];
    const queuePaused=control.rows[0]?.queue_paused ?? false;
    if (!worker) return NextResponse.json({
      workerOnline:false,codexAuthenticated:false,queuePaused,lastSeen:null,
      message:"Nenhum worker registrou atividade.",metrics:{queued:0,running:0,waitingApproval:0,failed24h:0,deployLocks:0},
    });
    const message=queuePaused
      ? control.rows[0]?.pause_reason==="deploy"
        ? "Fila pausada automaticamente enquanto o deploy é verificado."
        : "Fila pausada. A execução atual pode terminar; novos chamados não serão iniciados."
      : !worker.worker_online
        ? "O worker parou de enviar sinais."
        : worker.codex_authenticated
          ? "Executor pronto para receber chamados."
          : (worker.status_message ?? "Autentique o Codex no worker.");
    return NextResponse.json({
      workerOnline:worker.worker_online,codexAuthenticated:worker.codex_authenticated,
      queuePaused,lastSeen:worker.last_seen,message,
      metrics:{queued:Number(metrics.rows[0]?.queued??0),running:Number(metrics.rows[0]?.running??0),waitingApproval:Number(metrics.rows[0]?.waiting_approval??0),failed24h:Number(metrics.rows[0]?.failed_24h??0),deployLocks:Number(metrics.rows[0]?.deploy_locks??0)},
    });
  } catch {
    return NextResponse.json({
      workerOnline:false,codexAuthenticated:false,queuePaused:false,lastSeen:null,
      message:"Monitoramento ainda não foi instalado.",metrics:{queued:0,running:0,waitingApproval:0,failed24h:0,deployLocks:0},
    });
  }
}

export async function PATCH(request:Request) {
  const body=await request.json().catch(()=>({}));
  if (typeof body.paused!=="boolean") {
    return NextResponse.json({error:"Estado de pausa inválido"},{status:400});
  }
  const result=await query<{queue_paused:boolean}>(
    "UPDATE lwf_worker_control SET queue_paused=$1::boolean,pause_reason=CASE WHEN $1::boolean THEN 'manual' ELSE NULL END,deploy_ticket_id=NULL,updated_at=now() WHERE singleton=true RETURNING queue_paused",
    [body.paused],
  );
  if (!result.rowCount) {
    return NextResponse.json({error:"Controle do worker não foi inicializado"},{status:503});
  }
  return NextResponse.json({queuePaused:result.rows[0].queue_paused});
}
