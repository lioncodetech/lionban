import { NextResponse } from "next/server";
import { z } from "zod";
import { query, transaction } from "@/lib/db";

const ticketInput = z.object({
  applicationId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(20000),
  priority: z.enum(["low","medium","high","critical"]).default("medium"),
});
export async function GET() {
  const result = await query(`SELECT t.*, a.name application_name, a.full_name repository
    FROM tickets t JOIN applications a ON a.id=t.application_id ORDER BY t.created_at DESC`);
  return NextResponse.json(result.rows);
}
export async function POST(request: Request) {
  const parsed = ticketInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 400 });
  const ticket = await transaction(async client => {
    const app = await client.query("SELECT id FROM applications WHERE id=$1 AND enabled=true FOR SHARE", [parsed.data.applicationId]);
    if (!app.rowCount) throw new Error("APP_NOT_FOUND");
    const created = await client.query(`INSERT INTO tickets(application_id,title,description,priority)
      VALUES($1,$2,$3,$4) RETURNING *`, [parsed.data.applicationId, parsed.data.title, parsed.data.description, parsed.data.priority]);
    await client.query("INSERT INTO executions(ticket_id,application_id) VALUES($1,$2)", [created.rows[0].id, parsed.data.applicationId]);
    await client.query("INSERT INTO events(ticket_id,kind,message) VALUES($1,'ticket.created','Chamado criado e enfileirado')", [created.rows[0].id]);
    return created.rows[0];
  });
  return NextResponse.json(ticket, { status: 201 });
}

