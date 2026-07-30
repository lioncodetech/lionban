import { NextResponse } from "next/server";
import { createSession, verifyLogin } from "@/lib/auth";
export async function POST(request: Request) {
  const { username, password } = await request.json() as { username?: string; password?: string };
  if (!username || !password || !await verifyLogin(username, password)) return NextResponse.json({ error: "Usuário ou senha inválidos" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("lionban_session", await createSession(username), { httpOnly:true, secure:process.env.NODE_ENV==="production", sameSite:"strict", path:"/", maxAge:604800 });
  return response;
}
