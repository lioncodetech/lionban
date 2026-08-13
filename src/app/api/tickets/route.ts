import { NextResponse } from "next/server";
import { z } from "zod";
import { query, transaction } from "@/lib/db";
import { hasExpectedImageSignature } from "@/lib/attachment-security";

const ticketInput = z.object({
  applicationId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(20000),
  priority: z.enum(["low","medium","high","critical"]).default("medium"),
  queuePriority: z.number().int().min(1).max(10).default(5),
  ticketKind:z.enum(["fix","deploy"]).default("fix"),
  scheduledAt:z.string().datetime().nullable().default(null),
  aiModel: z.enum(["gpt-5.6","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna"]).nullable().default(null),
  autoCommit: z.boolean().default(true),
  autoPush: z.boolean().default(true),
  autoPullRequest: z.boolean().default(false),
  autoDeploy: z.boolean().default(false),
  createTag: z.boolean().default(false),
  releaseTag: z.string().trim().regex(/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).optional(),
  attachments: z.array(z.object({
    name: z.string().min(1).max(180),
    mimeType: z.enum(["image/png","image/jpeg","image/webp","image/gif"]),
    size: z.number().int().positive().max(5 * 1024 * 1024),
    data: z.string().max(7_500_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })).max(5).default([]),
}).superRefine((value,context)=>{
  if (value.ticketKind==="deploy" && value.attachments.length) {
    context.addIssue({code:"custom",path:["attachments"],message:"Chamados somente de deploy não recebem imagens"});
  }
  if (value.attachments.reduce((total,item)=>total+item.size,0)>25*1024*1024) {
    context.addIssue({code:"custom",path:["attachments"],message:"O total dos anexos não pode ultrapassar 25 MB"});
  }
});
export async function GET(request:Request) {
  const searchParams=new URL(request.url).searchParams;
  const archived=searchParams.get("archived")==="true";
  const requestedLimit=Number(searchParams.get("limit") ?? 250);
  const limit=Number.isInteger(requestedLimit)?Math.min(Math.max(requestedLimit,1),500):250;
  const updatedAfter=searchParams.get("updatedAfter");
  const validUpdatedAfter=updatedAfter && !Number.isNaN(Date.parse(updatedAfter)) ? updatedAfter : null;
  const result = await query(`SELECT t.*, a.name application_name, a.full_name repository
    FROM lwf_tickets t JOIN lwf_applications a ON a.id=t.application_id
    WHERE ${archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL"}
      AND ($2::timestamptz IS NULL OR t.updated_at > $2::timestamptz)
    ORDER BY t.created_at DESC LIMIT $1`,[limit,validUpdatedAfter]);
  return NextResponse.json(result.rows);
}
export async function POST(request: Request) {
  const parsed = ticketInput.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
  try {
  const ticket = await transaction(async client => {
    const app = await client.query<{id:string;deploy_webhook_url:string|null}>("SELECT id,deploy_webhook_url FROM lwf_applications WHERE id=$1 AND enabled=true FOR SHARE", [parsed.data.applicationId]);
    if (!app.rowCount) throw new Error("APP_NOT_FOUND");
    const deployOnly=parsed.data.ticketKind==="deploy";
    if (deployOnly && !app.rows[0].deploy_webhook_url) throw new Error("DEPLOY_WEBHOOK_NOT_CONFIGURED");
    if (!deployOnly && parsed.data.autoPullRequest && (!parsed.data.autoCommit || !parsed.data.autoPush)) throw new Error("PR_REQUIRES_PUSH");
    if (!deployOnly && parsed.data.autoDeploy && (!parsed.data.autoCommit || !parsed.data.autoPush || parsed.data.autoPullRequest)) throw new Error("DEPLOY_REQUIRES_DIRECT_MERGE");
    if (!deployOnly && parsed.data.createTag && (!parsed.data.releaseTag || parsed.data.autoPullRequest || !parsed.data.autoCommit || !parsed.data.autoPush)) throw new Error("INVALID_RELEASE_TAG_FLOW");
    const created = await client.query(`INSERT INTO lwf_tickets(application_id,title,description,priority,queue_priority,ticket_kind,scheduled_at,ai_model,auto_commit,auto_push,auto_pull_request,auto_deploy,create_tag,release_tag)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [parsed.data.applicationId, parsed.data.title, parsed.data.description, parsed.data.priority,parsed.data.queuePriority,parsed.data.ticketKind,parsed.data.scheduledAt,deployOnly?null:parsed.data.aiModel, deployOnly?false:parsed.data.autoCommit, deployOnly?false:parsed.data.autoPush, deployOnly?false:parsed.data.autoPullRequest,deployOnly?true:parsed.data.autoDeploy,deployOnly?false:parsed.data.createTag,deployOnly?null:(parsed.data.releaseTag ?? null)]);
    await client.query("INSERT INTO lwf_executions(ticket_id,application_id) VALUES($1,$2)", [created.rows[0].id, parsed.data.applicationId]);
    await client.query("INSERT INTO lwf_events(ticket_id,kind,message,metadata) VALUES($1,'ticket.created',$2,$3)", [created.rows[0].id,parsed.data.scheduledAt?"Chamado criado e agendado":"Chamado criado e enfileirado",{ticketKind:parsed.data.ticketKind,scheduledAt:parsed.data.scheduledAt}]);
    for (const attachment of parsed.data.attachments) {
      const content = Buffer.from(attachment.data, "base64");
      if (content.byteLength !== attachment.size) throw new Error("ATTACHMENT_SIZE_MISMATCH");
      if (!hasExpectedImageSignature(content,attachment.mimeType)) throw new Error("ATTACHMENT_CONTENT_INVALID");
      await client.query(
        `INSERT INTO lwf_artifacts(ticket_id,kind,name,storage_key,mime_type,size_bytes,content)
         VALUES($1,'screenshot',$2,$3,$4,$5,$6)`,
        [created.rows[0].id, attachment.name, `db://${created.rows[0].id}/${attachment.name}`, attachment.mimeType, attachment.size, content],
      );
    }
    return created.rows[0];
  });
  return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    const code=error instanceof Error?error.message:"UNKNOWN_ERROR";
    const known:Record<string,{status:number;message:string}>={
      APP_NOT_FOUND:{status:404,message:"A aplicação não existe ou está desativada."},
      DEPLOY_WEBHOOK_NOT_CONFIGURED:{status:409,message:"Configure o webhook de deploy da aplicação antes de criar este chamado."},
      PR_REQUIRES_PUSH:{status:400,message:"Pull Request automático exige commit e push automáticos."},
      DEPLOY_REQUIRES_DIRECT_MERGE:{status:400,message:"Deploy automático exige commit e push diretos, sem Pull Request."},
      INVALID_RELEASE_TAG_FLOW:{status:400,message:"A configuração de tag/release é incompatível com este fluxo."},
      ATTACHMENT_SIZE_MISMATCH:{status:400,message:"O tamanho informado de uma imagem não corresponde ao arquivo."},
      ATTACHMENT_CONTENT_INVALID:{status:400,message:"Uma das imagens possui conteúdo inválido."},
    };
    const mapped=known[code];
    if (mapped) return NextResponse.json({error:mapped.message,code},{status:mapped.status});
    console.error("ticket.create:",error);
    return NextResponse.json({error:"Não foi possível criar o chamado.",code:"TICKET_CREATE_FAILED"},{status:500});
  }
}
