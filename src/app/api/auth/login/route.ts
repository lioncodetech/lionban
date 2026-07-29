import { NextResponse } from "next/server";
import { createSession, verifyLogin } from "@/lib/auth";
export async function POST(request: Request) {
  const { password } = await request.json() as { password?: string };
  if (!password || !await verifyLogin(password)) return NextResponse.json({ error: "Senha inválida" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("lionban_session", await createSession(), { httpOnly:true, secure:process.env.NODE_ENV==="production", sameSite:"strict", path:"/", maxAge:604800 });
  return response;
}
