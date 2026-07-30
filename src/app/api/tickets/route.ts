import { NextResponse } from "next/server";
import { z } from "zod";
import { query, transaction } from "@/lib/db";

const ticketInput = z.object({
  applicationId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(20000),
  priority: z.enum(["low","medium","high","critical"]).default("medium"),
  queuePriority: z.number().int().min(1).max(10).default(5),
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
    data: z.string().max(7_500_000),
  })).max(5).default([]),
});
export async function GET(request:Request) {
  const archived=new URL(request.url).searchParams.get("archived")==="true";
  const result = await query(`SELECT t.*, a.name application_name, a.full_name repository
    FROM lb_tickets t JOIN lb_applications a ON a.id=t.application_id
    WHERE ${archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL"}
    ORDER BY t.created_at DESC`);
  return NextResponse.json(result.rows);
}
export async function POST(request: Request) {
  const parsed = ticketInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
  const ticket = await transaction(async client => {
    const app = await client.query("SELECT id FROM lb_applications WHERE id=$1 AND enabled=true FOR SHARE", [parsed.data.applicationId]);
    if (!app.rowCount) throw new Error("APP_NOT_FOUND");
    if (parsed.data.autoPullRequest && (!parsed.data.autoCommit || !parsed.data.autoPush)) throw new Error("PR_REQUIRES_PUSH");
    if (parsed.data.autoDeploy && (!parsed.data.autoCommit || !parsed.data.autoPush || parsed.data.autoPullRequest)) throw new Error("DEPLOY_REQUIRES_DIRECT_MERGE");
    if (parsed.data.createTag && (!parsed.data.releaseTag || parsed.data.autoPullRequest || !parsed.data.autoCommit || !parsed.data.autoPush)) throw new Error("INVALID_RELEASE_TAG_FLOW");
    const created = await client.query(`INSERT INTO lb_tickets(application_id,title,description,priority,queue_priority,auto_commit,auto_push,auto_pull_request,auto_deploy,create_tag,release_tag)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [parsed.data.applicationId, parsed.data.title, parsed.data.description, parsed.data.priority,parsed.data.queuePriority, parsed.data.autoCommit, parsed.data.autoPush, parsed.data.autoPullRequest, parsed.data.autoDeploy,parsed.data.createTag,parsed.data.releaseTag ?? null]);
    await client.query("INSERT INTO lb_executions(ticket_id,application_id) VALUES($1,$2)", [created.rows[0].id, parsed.data.applicationId]);
    await client.query("INSERT INTO lb_events(ticket_id,kind,message) VALUES($1,'ticket.created','Chamado criado e enfileirado')", [created.rows[0].id]);
    for (const attachment of parsed.data.attachments) {
      const content = Buffer.from(attachment.data, "base64");
      if (content.byteLength !== attachment.size) throw new Error("ATTACHMENT_SIZE_MISMATCH");
      await client.query(
        `INSERT INTO lb_artifacts(ticket_id,kind,name,storage_key,mime_type,size_bytes,content)
         VALUES($1,'screenshot',$2,$3,$4,$5,$6)`,
        [created.rows[0].id, attachment.name, `db://${created.rows[0].id}/${attachment.name}`, attachment.mimeType, attachment.size, content],
      );
    }
    return created.rows[0];
  });
  return NextResponse.json(ticket, { status: 201 });
}
