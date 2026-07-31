import { NextResponse } from "next/server";
import { createSession, verifyLogin } from "@/lib/auth";
import { clearLoginRateLimit,loginRateLimit } from "@/lib/login-rate-limit";
export async function POST(request: Request) {
  const forwarded=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientKey=forwarded || request.headers.get("x-real-ip") || "unknown";
  const limit=loginRateLimit(clientKey);
  if (!limit.allowed) return NextResponse.json({error:"Muitas tentativas. Aguarde antes de tentar novamente."},{
    status:429,headers:{"retry-after":String(limit.retryAfterSeconds)},
  });
  const { username, password } = await request.json().catch(()=>({})) as { username?: string; password?: string };
  if (!username || !password || !await verifyLogin(username, password)) return NextResponse.json({ error: "Usuário ou senha inválidos" }, { status: 401 });
  clearLoginRateLimit(clientKey);
  const response = NextResponse.json({ ok: true });
  response.cookies.set("lionworkforce_session", await createSession(username), { httpOnly:true, secure:process.env.NODE_ENV==="production", sameSite:"strict", path:"/", maxAge:43200 });
  return response;
}
