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
const testEnvironment=z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/),z.string().max(4000)).optional();
const input = z.object({
  deployWebhookUrl:deployWebhookUrl.nullable().optional(),
  installCommand:command,
  testCommand:command,
  lintCommand:command,
  buildCommand:command,
  testEnvironment,
});

export async function PATCH(request:Request, context:{ params:Promise<{ id:string }> }) {
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error:"Configuração inválida" }, { status:400 });
  }
  const result = await query(
    `UPDATE lwf_applications SET
      deploy_webhook_url=CASE WHEN $1::boolean THEN NULLIF($2,'') ELSE deploy_webhook_url END,
      install_command=NULLIF($3,''),test_command=NULLIF($4,''),
      lint_command=NULLIF($5,''),build_command=NULLIF($6,''),
      test_environment=CASE WHEN $7::boolean THEN $8::jsonb ELSE test_environment END
     WHERE id=$9
     RETURNING id,install_command,test_command,lint_command,build_command,
       deploy_webhook_url IS NOT NULL deploy_configured,
       COALESCE(ARRAY(SELECT jsonb_object_keys(test_environment)),ARRAY[]::text[]) test_environment_keys,
       substring(test_environment->>'DATABASE_URL' from '[?&]schema=([^&]+)') test_database_schema`,
    [
      parsed.data.deployWebhookUrl !== undefined,
      parsed.data.deployWebhookUrl ?? "",
      parsed.data.installCommand,parsed.data.testCommand,
      parsed.data.lintCommand,parsed.data.buildCommand,
      parsed.data.testEnvironment !== undefined,JSON.stringify(parsed.data.testEnvironment ?? {}),id,
    ],
  );
  return result.rowCount ? NextResponse.json(result.rows[0]) : NextResponse.json({ error:"Aplicação não encontrada" }, { status:404 });
}
