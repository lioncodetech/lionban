import { describe,expect,it } from "vitest";
import { validateOutboundUrl } from "./outbound-url";

describe("validateOutboundUrl",()=>{
  it("aceita HTTPS público",()=>expect(validateOutboundUrl("https://app.example.com/api/version","verification").hostname).toBe("app.example.com"));
  it("aceita trigger HTTP público do EasyPanel",()=>expect(validateOutboundUrl("http://72.61.62.89:3000/api/deploy/token","deploy").pathname).toContain("/api/deploy/"));
  it.each(["http://localhost/api/deploy/x","https://127.0.0.1/x","https://10.0.0.2/x","https://service.internal/x"])(
    "bloqueia destino privado %s",url=>expect(()=>validateOutboundUrl(url,"verification")).toThrow(),
  );
  it("bloqueia credenciais na URL",()=>expect(()=>validateOutboundUrl("https://user:pass@example.com/x","verification")).toThrow());
});
