import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";

export function authConfigurationError() {
  const secret=process.env.AUTH_SECRET?.trim() ?? "";
  if (secret.length<32) return "AUTH_SECRET deve possuir pelo menos 32 caracteres";
  if (!process.env.ADMIN_PASSWORD_HASH?.trim()) return "ADMIN_PASSWORD_HASH não configurado";
  if (!process.env.ADMIN_USERNAME?.trim()) return "ADMIN_USERNAME não configurado";
  return null;
}
const secret = () => {
  const error=authConfigurationError();
  if (error) throw new Error(`AUTH_CONFIGURATION_ERROR: ${error}`);
  return new TextEncoder().encode(process.env.AUTH_SECRET);
};
export async function verifyLogin(username: string, password: string) {
  if (authConfigurationError()) return false;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const configuredUsername = process.env.ADMIN_USERNAME!.trim();
  return Boolean(hash && username === configuredUsername && await compare(password, hash));
}
export async function createSession(username: string) {
  return new SignJWT({ role: "admin", username })
    .setSubject(username).setIssuer("lionworkforce").setAudience("lionworkforce-web")
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret());
}
export async function verifySession(token?: string) {
  if (!token) return false;
  try {
    const result=await jwtVerify(token,secret(),{issuer:"lionworkforce",audience:"lionworkforce-web"});
    return result.payload.role==="admin";
  } catch { return false; }
}
