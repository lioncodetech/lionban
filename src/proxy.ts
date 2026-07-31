import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
export async function proxy(request:NextRequest) {
  if ((process.env.AUTH_SECRET?.trim().length ?? 0)<32 || !process.env.ADMIN_PASSWORD_HASH?.trim() || !process.env.ADMIN_USERNAME?.trim()) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({error:"Autenticação do servidor não configurada"},{status:503});
    return new NextResponse("LionWorkForce indisponível: autenticação não configurada.",{status:503,headers:{"content-type":"text/plain; charset=utf-8"}});
  }
  const path=request.nextUrl.pathname;
  if (path.startsWith("/api/") && !["GET","HEAD","OPTIONS"].includes(request.method)) {
    const origin=request.headers.get("origin");
    if (origin && origin!==request.nextUrl.origin) return NextResponse.json({error:"Origem não autorizada"},{status:403});
  }
  if (path==="/login" || path.startsWith("/api/auth/")) return NextResponse.next();
  const token=request.cookies.get("lionworkforce_session")?.value;
  try {
    if (!token) throw new Error();
    const result=await jwtVerify(token,new TextEncoder().encode(process.env.AUTH_SECRET),{issuer:"lionworkforce",audience:"lionworkforce-web"});
    if (result.payload.role!=="admin") throw new Error();
    return NextResponse.next();
  }
  catch { if(path.startsWith("/api/")) return NextResponse.json({error:"Não autorizado"},{status:401}); return NextResponse.redirect(new URL("/login",request.url)); }
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};
