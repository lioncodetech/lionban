import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

export function requestOrigins(request:NextRequest) {
  const origins=new Set([request.nextUrl.origin]);
  const forwardedHost=request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto=request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost && (forwardedProto==="https" || forwardedProto==="http")) origins.add(`${forwardedProto}://${forwardedHost}`);
  const host=request.headers.get("host")?.trim();
  if (host) origins.add(`${forwardedProto==="https"?"https":request.nextUrl.protocol}//${host}`);
  return origins;
}
export async function proxy(request:NextRequest) {
  if ((process.env.AUTH_SECRET?.trim().length ?? 0)<32 || !process.env.ADMIN_PASSWORD_HASH?.trim() || !process.env.ADMIN_USERNAME?.trim()) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({error:"Autenticação do servidor não configurada"},{status:503});
    return new NextResponse("LionWorkForce indisponível: autenticação não configurada.",{status:503,headers:{"content-type":"text/plain; charset=utf-8"}});
  }
  const path=request.nextUrl.pathname;
  const contentLength=Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength)&&contentLength>40*1024*1024) {
    return NextResponse.json({error:"Requisição acima do limite de 40 MB"},{status:413});
  }
  // Login já é protegido por senha, cookie SameSite=Strict e rate limit.
  // Ele precisa atravessar proxies reversos que podem reescrever Host/Proto.
  if (path==="/login" || path.startsWith("/api/auth/")) return NextResponse.next();
  if (path.startsWith("/api/") && !["GET","HEAD","OPTIONS"].includes(request.method)) {
    const origin=request.headers.get("origin");
    if (origin && !requestOrigins(request).has(origin)) {
      console.warn("Origem rejeitada",{
        received:origin,expected:[...requestOrigins(request)],
        forwardedHost:request.headers.get("x-forwarded-host"),
        forwardedProto:request.headers.get("x-forwarded-proto"),
      });
      return NextResponse.json({error:"Origem não autorizada"},{status:403});
    }
  }
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
