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
const command=z.string().trim().max(500);
const input = z.object({
  deployWebhookUrl:deployWebhookUrl.nullable().optional(),
  installCommand:command,
  testCommand:command,
  lintCommand:command,
  buildCommand:command,
});

export async function PATCH(request:Request, context:{ params:Promise<{ id:string }> }) {
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error:"Configuração inválida" }, { status:400 });
  }
  const result = await query(
    `UPDATE lb_applications SET
      deploy_webhook_url=CASE WHEN $1::boolean THEN NULLIF($2,'') ELSE deploy_webhook_url END,
      install_command=NULLIF($3,''),test_command=NULLIF($4,''),
      lint_command=NULLIF($5,''),build_command=NULLIF($6,'')
     WHERE id=$7
     RETURNING id,install_command,test_command,lint_command,build_command,
       deploy_webhook_url IS NOT NULL deploy_configured`,
    [
      parsed.data.deployWebhookUrl !== undefined,
      parsed.data.deployWebhookUrl ?? "",
      parsed.data.installCommand,parsed.data.testCommand,
      parsed.data.lintCommand,parsed.data.buildCommand,id,
    ],
  );
  return result.rowCount ? NextResponse.json(result.rows[0]) : NextResponse.json({ error:"Aplicação não encontrada" }, { status:404 });
}
