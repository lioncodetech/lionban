import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address:string) {
  const normalized=address.toLowerCase().replace(/^::ffff:/,"");
  if (normalized==="::1" || normalized==="0.0.0.0") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const parts=normalized.split(".").map(Number);
  if (parts.length!==4 || parts.some(part=>!Number.isInteger(part))) return false;
  return parts[0]===10 || parts[0]===127 || parts[0]===0 || parts[0]===169&&parts[1]===254 ||
    parts[0]===172&&parts[1]>=16&&parts[1]<=31 || parts[0]===192&&parts[1]===168 ||
    parts[0]===100&&parts[1]>=64&&parts[1]<=127;
}

export function validateOutboundUrl(value:string,kind:"deploy"|"verification") {
  const url=new URL(value);
  const allowedProtocol=url.protocol==="https:" ||
    kind==="deploy" && url.protocol==="http:" && url.pathname.startsWith("/api/deploy/");
  if (!allowedProtocol || url.username || url.password) throw new Error("OUTBOUND_URL_INVALID");
  const hostname=url.hostname.toLowerCase();
  if (hostname==="localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      isIP(hostname)>0 && isPrivateAddress(hostname)) throw new Error("OUTBOUND_URL_PRIVATE");
  const allowed=(process.env.DEPLOY_ALLOWED_HOSTS ?? "").split(",").map(item=>item.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(hostname)) throw new Error("OUTBOUND_URL_NOT_ALLOWED");
  return url;
}

export async function assertSafeOutboundUrl(value:string,kind:"deploy"|"verification") {
  const url=validateOutboundUrl(value,kind);
  if (!isIP(url.hostname)) {
    const addresses=await lookup(url.hostname,{all:true,verbatim:true});
    if (!addresses.length || addresses.some(result=>isPrivateAddress(result.address))) throw new Error("OUTBOUND_URL_PRIVATE");
  }
  return url.toString();
}
