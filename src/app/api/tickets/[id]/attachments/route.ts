import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const ticketId=Number(id);
  if (!Number.isSafeInteger(ticketId) || ticketId<1) {
    return NextResponse.json({error:"Chamado inválido"},{status:400});
  }
  const result=await query<{name:string;mime_type:string;size_bytes:string;content:Buffer}>(
    `SELECT name,mime_type,size_bytes,content
     FROM lwf_artifacts
     WHERE ticket_id=$1 AND kind='screenshot' AND content IS NOT NULL
     ORDER BY created_at`,
    [ticketId],
  );
  return NextResponse.json(result.rows.map(item=>({
    name:item.name,
    mimeType:item.mime_type,
    size:Number(item.size_bytes),
    data:item.content.toString("base64"),
  })));
}
