import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
export async function proxy(request:NextRequest) {
  if (!process.env.AUTH_SECRET || !process.env.ADMIN_PASSWORD_HASH) return NextResponse.next();
  const path=request.nextUrl.pathname;
  if (path==="/login" || path.startsWith("/api/auth/")) return NextResponse.next();
  const token=request.cookies.get("lionworkforce_session")?.value;
  try { if (!token) throw new Error(); await jwtVerify(token,new TextEncoder().encode(process.env.AUTH_SECRET)); return NextResponse.next(); }
  catch { if(path.startsWith("/api/")) return NextResponse.json({error:"Não autorizado"},{status:401}); return NextResponse.redirect(new URL("/login",request.url)); }
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};
