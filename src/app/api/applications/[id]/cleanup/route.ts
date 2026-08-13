import { NextResponse } from "next/server";
import { query } from "@/lib/db";

const validUuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function POST(_request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  if (!validUuid(id)) return NextResponse.json({error:"Aplicação inválida"},{status:400});
  const queued=await query<{id:string;reused:boolean}>(`WITH target AS (
      SELECT id FROM lwf_applications WHERE id=$1
    ), existing AS (
      SELECT request.id FROM lwf_cleanup_requests request JOIN target ON target.id=request.application_id
      WHERE request.status IN ('pending','running') ORDER BY request.created_at DESC LIMIT 1
    ), inserted AS (
      INSERT INTO lwf_cleanup_requests(application_id)
      SELECT id FROM target WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id
    )
    SELECT id,false reused FROM inserted UNION ALL SELECT id,true reused FROM existing LIMIT 1`,[id]);
  return queued.rowCount
    ? NextResponse.json({requestId:queued.rows[0].id,status:"pending",reused:queued.rows[0].reused},{status:202})
    : NextResponse.json({error:"Aplicação não encontrada"},{status:404});
}

export async function GET(request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const requestId=new URL(request.url).searchParams.get("requestId") ?? "";
  if (!validUuid(id) || !validUuid(requestId)) return NextResponse.json({error:"Solicitação inválida"},{status:400});
  const result=await query(`SELECT id,status,removed_branches,removed_directories,error_message,created_at,finished_at
    FROM lwf_cleanup_requests WHERE id=$1 AND application_id=$2`,[requestId,id]);
  return result.rowCount?NextResponse.json(result.rows[0]):NextResponse.json({error:"Solicitação não encontrada"},{status:404});
}
