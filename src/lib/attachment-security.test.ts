import { describe,expect,it } from "vitest";
import { hasExpectedImageSignature } from "./attachment-security";

describe("hasExpectedImageSignature",()=>{
  it("aceita assinaturas compatíveis",()=>{
    expect(hasExpectedImageSignature(Buffer.from([0xff,0xd8,0xff,0x00]),"image/jpeg")).toBe(true);
    expect(hasExpectedImageSignature(Buffer.from("GIF89a-data"),"image/gif")).toBe(true);
    expect(hasExpectedImageSignature(Buffer.from("RIFF0000WEBPdata"),"image/webp")).toBe(true);
  });
  it("rejeita conteúdo disfarçado de imagem",()=>{
    expect(hasExpectedImageSignature(Buffer.from("<script>alert(1)</script>"),"image/png")).toBe(false);
  });
});
