import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await query<{
      codex_authenticated: boolean; status_message: string | null; last_seen: string; worker_online: boolean;
    }>(`SELECT codex_authenticated,status_message,last_seen,
      last_seen > now() - interval '35 seconds' worker_online
      FROM lb_worker_heartbeats ORDER BY last_seen DESC LIMIT 1`);
    const worker = result.rows[0];
    if (!worker) return NextResponse.json({ workerOnline:false, codexAuthenticated:false, lastSeen:null, message:"Nenhum worker registrou atividade." });
    const message = !worker.worker_online
      ? "O worker parou de enviar sinais."
      : worker.codex_authenticated ? "Executor pronto para receber chamados." : (worker.status_message ?? "Autentique o Codex no worker.");
    return NextResponse.json({ workerOnline:worker.worker_online, codexAuthenticated:worker.codex_authenticated, lastSeen:worker.last_seen, message });
  } catch {
    return NextResponse.json({ workerOnline:false, codexAuthenticated:false, lastSeen:null, message:"Monitoramento ainda não foi instalado." });
  }
}
