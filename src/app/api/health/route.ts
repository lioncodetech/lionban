import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [result,control] = await Promise.all([
      query<{
        codex_authenticated:boolean; status_message:string|null; last_seen:string; worker_online:boolean;
      }>(`SELECT codex_authenticated,status_message,last_seen,
        last_seen > now() - interval '35 seconds' worker_online
        FROM lb_worker_heartbeats ORDER BY last_seen DESC LIMIT 1`),
      query<{queue_paused:boolean}>("SELECT queue_paused FROM lb_worker_control WHERE singleton=true"),
    ]);
    const worker=result.rows[0];
    const queuePaused=control.rows[0]?.queue_paused ?? false;
    if (!worker) return NextResponse.json({
      workerOnline:false,codexAuthenticated:false,queuePaused,lastSeen:null,
      message:"Nenhum worker registrou atividade.",
    });
    const message=queuePaused
      ? "Fila pausada. A execução atual pode terminar; novos chamados não serão iniciados."
      : !worker.worker_online
        ? "O worker parou de enviar sinais."
        : worker.codex_authenticated
          ? "Executor pronto para receber chamados."
          : (worker.status_message ?? "Autentique o Codex no worker.");
    return NextResponse.json({
      workerOnline:worker.worker_online,codexAuthenticated:worker.codex_authenticated,
      queuePaused,lastSeen:worker.last_seen,message,
    });
  } catch {
    return NextResponse.json({
      workerOnline:false,codexAuthenticated:false,queuePaused:false,lastSeen:null,
      message:"Monitoramento ainda não foi instalado.",
    });
  }
}

export async function PATCH(request:Request) {
  const body=await request.json().catch(()=>({}));
  if (typeof body.paused!=="boolean") {
    return NextResponse.json({error:"Estado de pausa inválido"},{status:400});
  }
  const result=await query<{queue_paused:boolean}>(
    "UPDATE lb_worker_control SET queue_paused=$1,updated_at=now() WHERE singleton=true RETURNING queue_paused",
    [body.paused],
  );
  if (!result.rowCount) {
    return NextResponse.json({error:"Controle do worker não foi inicializado"},{status:503});
  }
  return NextResponse.json({queuePaused:result.rows[0].queue_paused});
}
