import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";

function configuredPasswordHash() {
  const value=process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";
  const quoted=value.length>=2 &&
    (value[0]==="'"&&value.at(-1)==="'" || value[0]==='"'&&value.at(-1)==='"');
  return quoted ? value.slice(1,-1).trim() : value;
}
export function authConfigurationError() {
  const secret=process.env.AUTH_SECRET?.trim() ?? "";
  if (secret.length<32) return "AUTH_SECRET deve possuir pelo menos 32 caracteres";
  if (!configuredPasswordHash()) return "ADMIN_PASSWORD_HASH não configurado";
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
  const hash=configuredPasswordHash();
  const configuredUsername = process.env.ADMIN_USERNAME!.trim().toLocaleLowerCase();
  return Boolean(hash && username.trim().toLocaleLowerCase() === configuredUsername && await compare(password, hash));
}
export async function diagnoseLogin(username:string,password:string) {
  const configurationError=authConfigurationError();
  const hash=configuredPasswordHash();
  const usernameMatches=Boolean(process.env.ADMIN_USERNAME) &&
    username.trim().toLocaleLowerCase()===process.env.ADMIN_USERNAME!.trim().toLocaleLowerCase();
  const hashShapeValid=/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
  const passwordMatches=!configurationError && hashShapeValid ? await compare(password,hash).catch(()=>false) : false;
  return {
    configurationError,usernameMatches,passwordMatches,hashShapeValid,
    hashLength:hash.length,secretLength:process.env.AUTH_SECRET?.trim().length ?? 0,
  };
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
