import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db";

const input = z.object({
  status: z.enum(["open", "analyzing", "fixing", "testing", "approval", "completed", "failed"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ticketId = Number(id);
  const parsed = input.safeParse(await request.json());
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
