import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

const input = z.object({ deployWebhookUrl:z.union([z.string().url().startsWith("https://"), z.literal("")]) });

export async function PATCH(request:Request, context:{ params:Promise<{ id:string }> }) {
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error:"Configuração inválida" }, { status:400 });
  }
  const result = await query(
    "UPDATE lb_applications SET deploy_webhook_url=NULLIF($1,'') WHERE id=$2 RETURNING id,deploy_webhook_url IS NOT NULL deploy_configured",
    [parsed.data.deployWebhookUrl,id],
  );
  return result.rowCount ? NextResponse.json(result.rows[0]) : NextResponse.json({ error:"Aplicação não encontrada" }, { status:404 });
}
