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
    return {...result.rows[0],events:events.rows,executions:executions.rows};
  });
  return ticket?NextResponse.json(ticket):NextResponse.json({error:"Chamado não encontrado"},{status:404});
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return NextResponse.json({error:"Chamado inválido"},{status:400});
  const body=await request.json();
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
      const active=await client.query("SELECT 1 FROM lb_executions WHERE application_id=$1 AND state IN ('queued','running') LIMIT 1",[ticket.application_id]);
      if (active.rowCount) throw new Error("APPLICATION_BUSY");
      const created=await client.query(`INSERT INTO lb_tickets(
        application_id,title,description,priority,auto_commit,auto_push,auto_pull_request,auto_deploy,create_tag,release_tag
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[
        ticket.application_id,`${ticket.title} (cópia)`,ticket.description,ticket.priority,ticket.auto_commit,ticket.auto_push,
        ticket.auto_pull_request,ticket.auto_deploy,ticket.create_tag,ticket.release_tag,
      ]);
      await client.query("INSERT INTO lb_executions(ticket_id,application_id) VALUES($1,$2)",[created.rows[0].id,ticket.application_id]);
      await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'ticket.created','Chamado duplicado e enfileirado sem logs anteriores')",[created.rows[0].id]);
      return created.rows[0];
    });
    return cloned?NextResponse.json(cloned,{status:201}):NextResponse.json({error:"Chamado não encontrado"},{status:404});
  } catch(error) {
    if (error instanceof Error && error.message==="APPLICATION_BUSY") {
      return NextResponse.json({error:"Esta aplicação já possui uma execução ativa. Aguarde ou cancele antes de duplicar."},{status:409});
    }
    throw error;
  }
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
    await client.query("DELETE FROM lb_artifacts WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lb_executions WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lb_tickets WHERE id=$1",[ticketId]);
    return "DELETED";
  });
  if (deleted==="ACTIVE") return NextResponse.json({error:"Cancele a execução e aguarde o worker parar antes de excluir."},{status:409});
  if (deleted==="MISSING") return NextResponse.json({error:"Chamado não encontrado"},{status:404});
  return NextResponse.json({deleted:true});
}
