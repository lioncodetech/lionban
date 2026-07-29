import { NextResponse } from "next/server";
import { listAuthorizedRepos } from "@/lib/github";
import { query } from "@/lib/db";
export async function GET() {
  const result = await query("SELECT * FROM lb_applications WHERE enabled=true ORDER BY name");
  return NextResponse.json(result.rows);
}
export async function POST() {
  const repos = await listAuthorizedRepos();
  return NextResponse.json(repos);
}
