import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { listRepositoryTags } from "@/lib/github";

export async function GET(_request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const application=await query<{full_name:string}>("SELECT full_name FROM lb_applications WHERE id=$1 AND enabled=true",[id]);
  if (!application.rowCount) return NextResponse.json({error:"Aplicação não encontrada"},{status:404});
  try {
    return NextResponse.json(await listRepositoryTags(application.rows[0].full_name));
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Falha ao consultar tags"},{status:502});
  }
}
