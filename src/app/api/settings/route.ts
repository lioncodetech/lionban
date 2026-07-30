import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

const input=z.object({
  archiveAfterDays:z.number().int().min(1).max(3650),
  deleteAfterDays:z.number().int().min(2).max(3650),
}).refine(value=>value.deleteAfterDays>value.archiveAfterDays);

export async function GET() {
  const result=await query("SELECT archive_after_days,delete_after_days,updated_at FROM lb_settings WHERE singleton=true");
  return NextResponse.json(result.rows[0] ?? {archive_after_days:7,delete_after_days:15});
}

export async function PATCH(request:Request) {
  const parsed=input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error:"Configuração de retenção inválida"},{status:400});
  const result=await query(`UPDATE lb_settings SET archive_after_days=$1,delete_after_days=$2,updated_at=now()
    WHERE singleton=true RETURNING archive_after_days,delete_after_days,updated_at`,
    [parsed.data.archiveAfterDays,parsed.data.deleteAfterDays]);
  return NextResponse.json(result.rows[0]);
}
