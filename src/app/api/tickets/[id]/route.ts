import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { hasExpectedImageSignature } from "@/lib/attachment-security";

const moveInput = z.object({
  status: z.enum(["open", "analyzing", "fixing", "testing", "approval", "completed", "failed"]),
});
const attachmentInput=z.object({
  name:z.string().min(1).max(180),
  mimeType:z.enum(["image/png","image/jpeg","image/webp","image/gif"]),
  size:z.number().int().positive().max(5*1024*1024),
  data:z.string().max(7_500_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
const editInput=z.object({
  edit:z.literal(true),
  title:z.string().trim().min(3).max(160),
  description:z.string().trim().min(10).max(20000),
  priority:z.enum(["low","medium","high","critical"]),
  queuePriority:z.number().int().min(1).max(10),
  aiModel:z.string().trim().max(100).regex(/^[A-Za-z0-9._:-]+$/).nullable(),
  autoCommit:z.boolean(),
  autoPush:z.boolean(),
  autoPullRequest:z.boolean(),
  autoDeploy:z.boolean(),
  createTag:z.boolean(),
  releaseTag:z.string().trim().regex(/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).nullable(),
  attachments:z.array(attachmentInput).max(5),
}).superRefine((value,context)=>{
  if (value.attachments.reduce((total,item)=>total+item.size,0)>25*1024*1024) {
    context.addIssue({code:"custom",path:["attachments"],message:"O total dos anexos não pode ultrapassar 25 MB"});
  }
});

export async function GET(_request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const ticket=await transaction(async client => {
    const result=await client.query("SELECT t.*,a.name application_name,a.full_name repository,a.default_branch FROM lwf_tickets t JOIN lwf_applications a ON a.id=t.application_id WHERE t.id=$1",[id]);
    if (!result.rowCount) return null;
    const events=await client.query(`SELECT * FROM (
      SELECT id,kind,message,metadata,created_at FROM lwf_events WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 500
    ) recent ORDER BY created_at`,[id]);
    const executions=await client.query("SELECT id,state,attempt,started_at,finished_at,error_message FROM lwf_executions WHERE ticket_id=$1 ORDER BY attempt DESC LIMIT 50",[id]);
    const approvals=await client.query(`SELECT ap.id,ap.reason,ap.decision,ap.decided_at,ap.created_at,
      EXISTS(SELECT 1 FROM lwf_artifacts ar WHERE ar.ticket_id=ap.ticket_id AND ar.kind='patch') patch_available
      FROM lwf_approvals ap WHERE ap.ticket_id=$1 ORDER BY ap.created_at DESC`,[id]);
    return {...result.rows[0],events:events.rows,executions:executions.rows,approvals:approvals.rows};
  });
  return ticket?NextResponse.json(ticket):NextResponse.json({error:"Chamado não encontrado"},{status:404});
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return NextResponse.json({error:"Chamado inválido"},{status:400});
  const body=await request.json();
  if (body.edit===true) {
    const parsed=editInput.safeParse(body);
    if (!parsed.success) return NextResponse.json({error:"Dados de edição inválidos",details:parsed.error.flatten()},{status:400});
    if (parsed.data.autoPullRequest&&(!parsed.data.autoCommit||!parsed.data.autoPush)) return NextResponse.json({error:"Pull Request exige commit e push"},{status:400});
    if (parsed.data.autoDeploy&&(!parsed.data.autoCommit||!parsed.data.autoPush||parsed.data.autoPullRequest)) return NextResponse.json({error:"Deploy exige integração direta"},{status:400});
    if (parsed.data.createTag&&(!parsed.data.releaseTag||parsed.data.autoPullRequest||!parsed.data.autoCommit||!parsed.data.autoPush)) return NextResponse.json({error:"Configuração de tag inválida"},{status:400});
    const edited=await transaction(async client=>{
      const execution=await client.query("SELECT id FROM lwf_executions WHERE ticket_id=$1 AND state='queued' ORDER BY attempt DESC LIMIT 1 FOR UPDATE",[ticketId]);
      if (!execution.rowCount) return "NOT_OPEN";
      const current=await client.query("SELECT id FROM lwf_tickets WHERE id=$1 AND status='open' FOR UPDATE",[ticketId]);
      if (!current.rowCount) return "NOT_OPEN";
      const updated=await client.query(`UPDATE lwf_tickets SET title=$1,description=$2,priority=$3,queue_priority=$4,ai_model=$5,
        auto_commit=$6,auto_push=$7,auto_pull_request=$8,auto_deploy=$9,create_tag=$10,release_tag=$11,updated_at=now()
        WHERE id=$12 RETURNING *`,[
        parsed.data.title,parsed.data.description,parsed.data.priority,parsed.data.queuePriority,
        parsed.data.aiModel,
        parsed.data.autoCommit,parsed.data.autoPush,parsed.data.autoPullRequest,parsed.data.autoDeploy,
        parsed.data.createTag,parsed.data.releaseTag,ticketId,
      ]);
      await client.query("DELETE FROM lwf_artifacts WHERE ticket_id=$1 AND kind='screenshot'",[ticketId]);
      for (const attachment of parsed.data.attachments) {
        const content=Buffer.from(attachment.data,"base64");
        if (content.byteLength!==attachment.size) throw new Error("ATTACHMENT_SIZE_MISMATCH");
        if (!hasExpectedImageSignature(content,attachment.mimeType)) throw new Error("ATTACHMENT_CONTENT_INVALID");
        await client.query(`INSERT INTO lwf_artifacts(ticket_id,kind,name,storage_key,mime_type,size_bytes,content)
          VALUES($1,'screenshot',$2,$3,$4,$5,$6)`,[
          ticketId,attachment.name,`db://${ticketId}/${attachment.name}`,attachment.mimeType,attachment.size,content,
        ]);
      }
      await client.query("INSERT INTO lwf_events(ticket_id,kind,message) VALUES($1,'ticket.edited','Chamado editado enquanto aguardava na fila')",[ticketId]);
      return updated.rows[0];
    });
    return edited==="NOT_OPEN"
      ? NextResponse.json({error:"O chamado já saiu da fila e não pode mais ser editado."},{status:409})
      : NextResponse.json(edited);
  }
  if (body.deployCompleted === true) {
    const result=await transaction(async client=>{
      const updated=await client.query(`UPDATE lwf_tickets SET deploy_status='completed',deploy_updated_at=now(),updated_at=now()
        WHERE id=$1 AND deploy_status='in_progress' RETURNING id`,[ticketId]);
      if (updated.rowCount) {
        await client.query("INSERT INTO lwf_events(ticket_id,kind,message) VALUES($1,'deploy.completed','Deploy confirmado como concluído pelo usuário')",[ticketId]);
        await client.query(`UPDATE lwf_worker_control
          SET queue_paused=false,pause_reason=NULL,deploy_ticket_id=NULL,updated_at=now()
          WHERE singleton=true AND pause_reason='deploy' AND deploy_ticket_id=$1`,[ticketId]);
      }
      return updated.rowCount;
    });
    return result?NextResponse.json({ok:true}):NextResponse.json({error:"Este chamado não possui deploy em curso"},{status:409});
  }
  if (body.decision === "approved" || body.decision === "rejected") {
    try {
      const decision=await transaction(async client => {
        const ticket=await client.query<{application_id:string,status:string}>(
          "SELECT application_id,status FROM lwf_tickets WHERE id=$1 FOR UPDATE",[ticketId],
        );
        if (!ticket.rowCount) return "MISSING";
        if (ticket.rows[0].status!=="approval") return "NOT_WAITING";
        const approval=await client.query<{id:string,execution_id:string}>(
          "SELECT id,execution_id FROM lwf_approvals WHERE ticket_id=$1 AND decision IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[ticketId],
        );
        if (!approval.rowCount) return "NO_APPROVAL";
        if (body.decision==="rejected") {
          await client.query("UPDATE lwf_approvals SET decision='rejected',decided_at=now() WHERE id=$1",[approval.rows[0].id]);
          await client.query("UPDATE lwf_executions SET state='rejected',finished_at=now() WHERE id=$1",[approval.rows[0].execution_id]);
          await client.query("UPDATE lwf_tickets SET status='failed',result_summary='Correção rejeitada pelo usuário',updated_at=now() WHERE id=$1",[ticketId]);
          await client.query("INSERT INTO lwf_events(ticket_id,kind,message) VALUES($1,'approval.rejected','Correção rejeitada pelo usuário')",[ticketId]);
          return "REJECTED";
        }
        const artifact=await client.query<{id:string}>(
          "SELECT id FROM lwf_artifacts WHERE ticket_id=$1 AND kind='patch' ORDER BY created_at DESC LIMIT 1",[ticketId],
        );
        if (!artifact.rowCount) return "NO_PATCH";
        const attempt=await client.query<{next:number}>("SELECT COALESCE(MAX(attempt),0)+1 next FROM lwf_executions WHERE ticket_id=$1",[ticketId]);
        await client.query("UPDATE lwf_approvals SET decision='approved',decided_at=now() WHERE id=$1",[approval.rows[0].id]);
        await client.query("UPDATE lwf_executions SET state='completed',finished_at=now() WHERE id=$1",[approval.rows[0].execution_id]);
        await client.query(
          "INSERT INTO lwf_executions(ticket_id,application_id,attempt,resume_artifact_id) VALUES($1,$2,$3,$4)",
          [ticketId,ticket.rows[0].application_id,attempt.rows[0].next,artifact.rows[0].id],
        );
        await client.query("UPDATE lwf_tickets SET status='open',cancellation_requested=false,updated_at=now() WHERE id=$1",[ticketId]);
        await client.query("INSERT INTO lwf_events(ticket_id,kind,message) VALUES($1,'approval.approved','Correção aprovada; continuação enfileirada a partir do patch preservado')",[ticketId]);
        return "APPROVED";
      });
      if (decision==="MISSING") return NextResponse.json({error:"Chamado não encontrado"},{status:404});
      if (decision==="NOT_WAITING" || decision==="NO_APPROVAL") return NextResponse.json({error:"O chamado não possui uma aprovação pendente."},{status:409});
      if (decision==="NO_PATCH") return NextResponse.json({error:"Esta execução antiga não preservou um patch. Duplique o chamado para executar novamente."},{status:409});
      return NextResponse.json({decision});
    } catch(error) {
      if (error instanceof Error && error.message.includes("lwf_one_active_execution_per_app")) {
        return NextResponse.json({error:"Esta aplicação já possui uma execução ativa."},{status:409});
      }
      throw error;
    }
  }
  if (body.cancel === true) {
    const cancelled=await transaction(async client => {
      const result=await client.query("UPDATE lwf_tickets SET cancellation_requested=true,status='cancelled',updated_at=now() WHERE id=$1 RETURNING id",[ticketId]);
      if (!result.rowCount) return false;
      await client.query("UPDATE lwf_executions SET state='cancelled',finished_at=now() WHERE ticket_id=$1 AND state='queued'",[ticketId]);
      await client.query("INSERT INTO lwf_events(ticket_id,kind,message) VALUES($1,'execution.cancel_requested','Cancelamento solicitado pelo usuário')",[ticketId]);
      return true;
    });
    return cancelled?NextResponse.json({cancelled:true}):NextResponse.json({error:"Chamado não encontrado"},{status:404});
  }
  const parsed = moveInput.safeParse(body);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1 || !parsed.success) {
    return NextResponse.json({ error: "Chamado ou estado inválido" }, { status: 400 });
  }
  const ticket = await transaction(async client => {
    const current = await client.query<{ status: string }>("SELECT status FROM lwf_tickets WHERE id=$1 FOR UPDATE", [ticketId]);
    if (!current.rowCount) return null;
    const active=await client.query<{state:string}>(
      "SELECT state FROM lwf_executions WHERE ticket_id=$1 AND state IN ('queued','running','waiting_approval') ORDER BY attempt DESC LIMIT 1 FOR UPDATE",
      [ticketId],
    );
    if (active.rows[0]?.state==="running" || active.rows[0]?.state==="waiting_approval") return "ACTIVE";
    if (!["open","completed","failed"].includes(parsed.data.status)) return "EXECUTOR_OWNED";
    if (active.rows[0]?.state==="queued" && parsed.data.status!=="open") {
      await client.query("UPDATE lwf_executions SET state='cancelled',finished_at=now() WHERE ticket_id=$1 AND state='queued'",[ticketId]);
    }
    const updated = await client.query(
      "UPDATE lwf_tickets SET status=$1,updated_at=now() WHERE id=$2 RETURNING *",
      [parsed.data.status, ticketId],
    );
    await client.query(
      "INSERT INTO lwf_events(ticket_id,kind,message,metadata) VALUES($1,'ticket.moved','Chamado movido manualmente',$2)",
      [ticketId, { from:current.rows[0].status, to:parsed.data.status }],
    );
    return updated.rows[0];
  });
  if (ticket==="ACTIVE") return NextResponse.json({error:"A execução está ativa; cancele-a antes de mover o chamado."},{status:409});
  if (ticket==="EXECUTOR_OWNED") return NextResponse.json({error:"As etapas internas são controladas pelo executor."},{status:409});
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
      const source=await client.query(`SELECT * FROM lwf_tickets WHERE id=$1 FOR SHARE`,[ticketId]);
      if (!source.rowCount) return null;
      const ticket=source.rows[0];
      const created=await client.query(`INSERT INTO lwf_tickets(
        application_id,title,description,priority,queue_priority,ai_model,auto_commit,auto_push,auto_pull_request,auto_deploy,create_tag,release_tag
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[
        ticket.application_id,`${ticket.title} (cópia)`,ticket.description,ticket.priority,ticket.queue_priority,ticket.ai_model,ticket.auto_commit,ticket.auto_push,
        ticket.auto_pull_request,ticket.auto_deploy,ticket.create_tag,ticket.release_tag,
      ]);
      await client.query("INSERT INTO lwf_executions(ticket_id,application_id) VALUES($1,$2)",[created.rows[0].id,ticket.application_id]);
      await client.query("INSERT INTO lwf_events(ticket_id,kind,message) VALUES($1,'ticket.created','Chamado duplicado e enfileirado sem logs anteriores')",[created.rows[0].id]);
      await client.query(`INSERT INTO lwf_artifacts(ticket_id,kind,name,storage_key,mime_type,size_bytes,content)
        SELECT $1,kind,name,'db://' || $1::text || '/' || name,mime_type,size_bytes,content
        FROM lwf_artifacts WHERE ticket_id=$2 AND kind='screenshot'`,[created.rows[0].id,ticketId]);
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
    const active=await client.query("SELECT 1 FROM lwf_executions WHERE ticket_id=$1 AND state IN ('queued','running') LIMIT 1",[ticketId]);
    if (active.rowCount) return "ACTIVE";
    const exists=await client.query("SELECT 1 FROM lwf_tickets WHERE id=$1 FOR UPDATE",[ticketId]);
    if (!exists.rowCount) return "MISSING";
    await client.query("DELETE FROM lwf_approvals WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lwf_events WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lwf_executions WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lwf_artifacts WHERE ticket_id=$1",[ticketId]);
    await client.query("DELETE FROM lwf_tickets WHERE id=$1",[ticketId]);
    return "DELETED";
  });
  if (deleted==="ACTIVE") return NextResponse.json({error:"Cancele a execução e aguarde o worker parar antes de excluir."},{status:409});
  if (deleted==="MISSING") return NextResponse.json({error:"Chamado não encontrado"},{status:404});
  return NextResponse.json({deleted:true});
}
