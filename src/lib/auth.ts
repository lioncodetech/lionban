import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET);
export async function verifyLogin(username: string, password: string) {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const configuredUsername = process.env.ADMIN_USERNAME?.trim() || "admin";
  return Boolean(hash && username === configuredUsername && await compare(password, hash));
}
export async function createSession(username: string) {
  return new SignJWT({ role: "admin", username }).setSubject(username).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret());
}
export async function verifySession(token?: string) {
  if (!token) return false;
  try { await jwtVerify(token, secret()); return true; } catch { return false; }
}
