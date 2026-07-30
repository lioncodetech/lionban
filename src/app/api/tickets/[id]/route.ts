import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db";

const moveInput = z.object({
  status: z.enum(["open", "analyzing", "fixing", "testing", "approval", "completed", "failed"]),
});

export async function GET(_request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const ticket=await transaction(async client => {
    const result=await client.query("SELECT t.*,a.name application_name,a.full_name repository,a.default_branch FROM lb_tickets t JOIN lb_applications a ON a.id=t.application_id WHERE t.id=$1",[id]);
    if (!result.rowCount) return null;
    const events=await client.query("SELECT id,kind,message,metadata,created_at FROM lb_events WHERE ticket_id=$1 ORDER BY created_at",[id]);
    const executions=await client.query("SELECT id,state,attempt,started_at,finished_at,error_message FROM lb_executions WHERE ticket_id=$1 ORDER BY attempt",[id]);
    const approvals=await client.query(`SELECT ap.id,ap.reason,ap.decision,ap.decided_at,ap.created_at,
      EXISTS(SELECT 1 FROM lb_artifacts ar WHERE ar.ticket_id=ap.ticket_id AND ar.kind='patch') patch_available
      FROM lb_approvals ap WHERE ap.ticket_id=$1 ORDER BY ap.created_at DESC`,[id]);
    return {...result.rows[0],events:events.rows,executions:executions.rows,approvals:approvals.rows};
  });
  return ticket?NextResponse.json(ticket):NextResponse.json({error:"Chamado não encontrado"},{status:404});
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return NextResponse.json({error:"Chamado inválido"},{status:400});
  const body=await request.json();
  if (body.deployCompleted === true) {
    const result=await transaction(async client=>{
      const updated=await client.query(`UPDATE lb_tickets SET deploy_status='completed',deploy_updated_at=now(),updated_at=now()
        WHERE id=$1 AND deploy_status='in_progress' RETURNING id`,[ticketId]);
      if (updated.rowCount) await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'deploy.completed','Deploy confirmado como concluído pelo usuário')",[ticketId]);
      return updated.rowCount;
    });
    return result?NextResponse.json({ok:true}):NextResponse.json({error:"Este chamado não possui deploy em curso"},{status:409});
  }
  if (body.decision === "approved" || body.decision === "rejected") {
    try {
      const decision=await transaction(async client => {
        const ticket=await client.query<{application_id:string,status:string}>(
          "SELECT application_id,status FROM lb_tickets WHERE id=$1 FOR UPDATE",[ticketId],
        );
        if (!ticket.rowCount) return "MISSING";
        if (ticket.rows[0].status!=="approval") return "NOT_WAITING";
        const approval=await client.query<{id:string,execution_id:string}>(
          "SELECT id,execution_id FROM lb_approvals WHERE ticket_id=$1 AND decision IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[ticketId],
        );
        if (!approval.rowCount) return "NO_APPROVAL";
        if (body.decision==="rejected") {
          await client.query("UPDATE lb_approvals SET decision='rejected',decided_at=now() WHERE id=$1",[approval.rows[0].id]);
          await client.query("UPDATE lb_executions SET state='rejected',finished_at=now() WHERE id=$1",[approval.rows[0].execution_id]);
          await client.query("UPDATE lb_tickets SET status='failed',result_summary='Correção rejeitada pelo usuário',updated_at=now() WHERE id=$1",[ticketId]);
          await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'approval.rejected','Correção rejeitada pelo usuário')",[ticketId]);
          return "REJECTED";
        }
        const artifact=await client.query<{id:string}>(
          "SELECT id FROM lb_artifacts WHERE ticket_id=$1 AND kind='patch' ORDER BY created_at DESC LIMIT 1",[ticketId],
        );
        if (!artifact.rowCount) return "NO_PATCH";
        const attempt=await client.query<{next:number}>("SELECT COALESCE(MAX(attempt),0)+1 next FROM lb_executions WHERE ticket_id=$1",[ticketId]);
        await client.query("UPDATE lb_approvals SET decision='approved',decided_at=now() WHERE id=$1",[approval.rows[0].id]);
        await client.query("UPDATE lb_executions SET state='completed',finished_at=now() WHERE id=$1",[approval.rows[0].execution_id]);
        await client.query(
          "INSERT INTO lb_executions(ticket_id,application_id,attempt,resume_artifact_id) VALUES($1,$2,$3,$4)",
          [ticketId,ticket.rows[0].application_id,attempt.rows[0].next,artifact.rows[0].id],
        );
        await client.query("UPDATE lb_tickets SET status='open',cancellation_requested=false,updated_at=now() WHERE id=$1",[ticketId]);
        await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'approval.approved','Correção aprovada; continuação enfileirada a partir do patch preservado')",[ticketId]);
        return "APPROVED";
      });
      if (decision==="MISSING") return NextResponse.json({error:"Chamado não encontrado"},{status:404});
      if (decision==="NOT_WAITING" || decision==="NO_APPROVAL") return NextResponse.json({error:"O chamado não possui uma aprovação pendente."},{status:409});
      if (decision==="NO_PATCH") return NextResponse.json({error:"Esta execução antiga não preservou um patch. Duplique o chamado para executar novamente."},{status:409});
      return NextResponse.json({decision});
    } catch(error) {
      if (error instanceof Error && error.message.includes("lb_one_active_execution_per_app")) {
        return NextResponse.json({error:"Esta aplicação já possui uma execução ativa."},{status:409});
      }
      throw error;
    }
  }
  if (body.cancel === true) {
    const cancelled=await transaction(async client => {
      const result=await client.query("UPDATE lb_tickets SET cancellation_requested=true,status='cancelled',updated_at=now() WHERE id=$1 RETURNING id",[ticketId]);
      if (!result.rowCount) return false;
      await client.query("UPDATE lb_executions SET state='cancelled',finished_at=now() WHERE ticket_id=$1 AND state='queued'",[ticketId]);
      await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'execution.cancel_requested','Cancelamento solicitado pelo usuário')",[ticketId]);
      return true;
    });
    return cancelled?NextResponse.json({cancelled:true}):NextResponse.json({error:"Chamado não encontrado"},{status:404});
  }
  const parsed = moveInput.safeParse(body);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1 || !parsed.success) {
    return NextResponse.json({ error: "Chamado ou estado inválido" }, { status: 400 });
  }
  const ticket = await transaction(async client => {
    const current = await client.query<{ status: string }>("SELECT status FROM lb_tickets WHERE id=$1 FOR UPDATE", [ticketId]);
    if (!current.rowCount) return null;
    const updated = await client.query(
      "UPDATE lb_tickets SET status=$1,updated_at=now() WHERE id=$2 RETURNING *",
      [parsed.data.status, ticketId],
    );
    await client.query(
      "INSERT INTO lb_events(ticket_id,kind,message,metadata) VALUES($1,'ticket.moved','Chamado movido manualmente',$2)",
      [ticketId, { from:current.rows[0].status, to:parsed.data.status }],
    );
    return updated.rows[0];
  });
  return ticket ? NextResponse.json(ticket) : NextResponse.json({ error:"Chamado não encontrado" }, { status:404 });
}

export async function POST(request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const ticketId=Number(id);
  const body=await request.json().catch(()=>({}));
  if (!Number.isSafeInteger(ticketId) || ticketId<1 || body.clone!==true) {
    return NextResponse.json({error:"Solicitação inválida"},{status:400});
  }
  try {
    const cloned=await transaction(async client => {
      const source=await client.query(`SELECT * FROM lb_tickets WHERE id=$1 FOR SHARE`,[ticketId]);
      if (!source.rowCount) return null;
      const ticket=source.rows[0];
      const created=await client.query(`INSERT INTO lb_tickets(
        application_id,title,description,priority,queue_priority,auto_commit,auto_push,auto_pull_request,auto_deploy,create_tag,release_tag
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[
        ticket.application_id,`${ticket.title} (cópia)`,ticket.description,ticket.priority,ticket.queue_priority,ticket.auto_commit,ticket.auto_push,
        ticket.auto_pull_request,ticket.auto_deploy,ticket.create_tag,ticket.release_tag,
      ]);
      await client.query("INSERT INTO lb_executions(ticket_id,application_id) VALUES($1,$2)",[created.rows[0].id,ticket.application_id]);
      await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'ticket.created','Chamado duplicado e enfileirado sem logs anteriores')",[created.rows[0].id]);
      return created.rows[0];
    });
    return cloned?NextResponse.json(cloned,{status:201}):NextResponse.json({error:"Chamado não encontrado"},{status:404});
  } catch(error) { throw error; }
}

export async function DELETE(_request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const ticketId=Number(id);
  if (!Number.isSafeInteger(ticketId) || ticketId<1) return NextResponse.json({error:"Chamado inválido"},{status:400});
  const deleted=await transaction(async client => {
    const active=await client.query("SELECT 1 FROM lb_executions WHERE ticket_id=$1 AND state IN ('queued','running') LIMIT 1",[ticketId]);
    if (active.rowCount) return "ACTIVE";
    const exists=await client.query("SELECT 1 FROM lb_tickets WHERE id=$1 FOR UPDATE",[ticketId]);
    if (!exists.rowCount) return "MISSING";
    await client.query("DELETE FROM lb_approvals WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lb_events WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lb_executions WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lb_artifacts WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lb_tickets WHERE id=$1",[ticketId]);
    return "DELETED";
  });
  if (deleted==="ACTIVE") return NextResponse.json({error:"Cancele a execução e aguarde o worker parar antes de excluir."},{status:409});
  if (deleted==="MISSING") return NextResponse.json({error:"Chamado não encontrado"},{status:404});
  return NextResponse.json({deleted:true});
}
