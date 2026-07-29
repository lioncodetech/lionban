import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET);
export async function verifyLogin(password: string) {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  return Boolean(hash && await compare(password, hash));
}
export async function createSession() {
  return new SignJWT({ role: "admin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret());
}
export async function verifySession(token?: string) {
  if (!token) return false;
  try { await jwtVerify(token, secret()); return true; } catch { return false; }
}

