import { NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { deleteRepositoryBranch, listLionWorkForceBranches } from "@/lib/github";

export async function POST(_request:Request, context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({error:"Aplicação inválida"},{status:400});
  const cleanup=await transaction(async client=>{
    const application=await client.query<{full_name:string}>("SELECT full_name FROM lwf_applications WHERE id=$1 FOR SHARE",[id]);
    if (!application.rowCount) return null;
    const terminal=await client.query<{id:number}>(`SELECT id FROM lwf_tickets
      WHERE application_id=$1 AND status IN ('completed','failed')`,[id]);
    const allowed=new Set(terminal.rows.map(ticket=>`lionworkforce/chamado-${ticket.id}`));
    const branches=(await listLionWorkForceBranches(application.rows[0].full_name)).filter(branch=>allowed.has(branch));
    for (const branch of branches) await deleteRepositoryBranch(application.rows[0].full_name,branch);
    const request=await client.query("INSERT INTO lwf_cleanup_requests(application_id) VALUES($1) RETURNING id",[id]);
    return {requestId:request.rows[0].id,removedBranches:branches.length,branches};
  });
  return cleanup?NextResponse.json(cleanup):NextResponse.json({error:"Aplicação não encontrada"},{status:404});
}
