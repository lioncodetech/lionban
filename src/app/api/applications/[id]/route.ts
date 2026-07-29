import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

const deployWebhookUrl=z.string().trim().max(2048).refine(value => {
  if (value === "") return true;
  try {
    const url=new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && url.pathname.startsWith("/api/deploy/"));
  } catch { return false; }
},"Use uma URL HTTPS ou o Deployment Trigger HTTP /api/deploy/ fornecido pelo EasyPanel");
const input = z.object({ deployWebhookUrl });

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
