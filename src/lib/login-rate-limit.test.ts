import { describe,expect,it } from "vitest";
import { clearLoginRateLimit,loginRateLimit } from "./login-rate-limit";

describe("loginRateLimit",()=>{
  it("bloqueia depois de cinco tentativas na janela",()=>{
    const key="test-client"; clearLoginRateLimit(key);
    for (let index=0;index<5;index++) expect(loginRateLimit(key,1000).allowed).toBe(true);
    expect(loginRateLimit(key,1000)).toEqual({allowed:false,retryAfterSeconds:900});
  });

  it("reinicia após a janela",()=>{
    const key="expired-client"; clearLoginRateLimit(key);
    for (let index=0;index<6;index++) loginRateLimit(key,1000);
    expect(loginRateLimit(key,901001).allowed).toBe(true);
  });
});
