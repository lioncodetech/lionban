import { NextResponse } from "next/server";
import { listAuthorizedRepos } from "@/lib/github";
import { query, transaction } from "@/lib/db";
import { z } from "zod";

const importInput = z.object({
  repository: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    full_name: z.string().regex(/^[^/]+\/[^/]+$/),
    default_branch: z.string().min(1),
    language: z.string().nullable(),
    clone_url: z.string().url(),
  }),
});

export async function GET() {
  const result = await query(`SELECT id,connection_id,github_repo_id,name,full_name,default_branch,language,clone_url,
    install_command,test_command,lint_command,build_command,enabled,created_at,
    deploy_webhook_url IS NOT NULL deploy_configured,
    COALESCE(ARRAY(SELECT jsonb_object_keys(test_environment)),ARRAY[]::text[]) test_environment_keys
    FROM lb_applications WHERE enabled=true ORDER BY name`);
  return NextResponse.json(result.rows);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "list") {
    const repos = await listAuthorizedRepos();
    return NextResponse.json(repos);
  }

  const parsed = importInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Repositório inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const repos = await listAuthorizedRepos();
  const authorized = repos.find(repo => repo.id === parsed.data.repository.id && repo.full_name === parsed.data.repository.full_name);
  if (!authorized) return NextResponse.json({ error: "O token não autoriza este repositório" }, { status: 403 });

  const owner = authorized.full_name.split("/")[0];
  const application = await transaction(async client => {
    let connection = await client.query(
      "SELECT id FROM lb_repository_connections WHERE provider='github' AND account_login=$1 ORDER BY created_at LIMIT 1",
      [owner],
    );
    if (!connection.rowCount) {
      connection = await client.query(
        "INSERT INTO lb_repository_connections(provider,account_login) VALUES('github',$1) RETURNING id",
        [owner],
      );
    }
    const result = await client.query(
      `INSERT INTO lb_applications(connection_id,github_repo_id,name,full_name,default_branch,language,clone_url)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(github_repo_id) DO UPDATE SET
         name=EXCLUDED.name, full_name=EXCLUDED.full_name, default_branch=EXCLUDED.default_branch,
         language=EXCLUDED.language, clone_url=EXCLUDED.clone_url, enabled=true
       RETURNING *`,
      [connection.rows[0].id, authorized.id, authorized.name, authorized.full_name, authorized.default_branch, authorized.language, authorized.clone_url],
    );
    return result.rows[0];
  });
  return NextResponse.json(application, { status: 201 });
}
