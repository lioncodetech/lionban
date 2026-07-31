import { afterEach,describe,expect,it } from "vitest";
import { hash } from "bcryptjs";
import { authConfigurationError,verifyLogin } from "./auth";

const previous={...process.env};
afterEach(()=>{
  process.env={...previous};
});

describe("autenticação",()=>{
  it("aceita usuário sem diferença de maiúsculas e hash com espaços",async()=>{
    process.env.AUTH_SECRET="a".repeat(32);
    process.env.ADMIN_USERNAME=" Elder ";
    process.env.ADMIN_PASSWORD_HASH=` ${(await hash("senha-forte",4))} `;
    expect(authConfigurationError()).toBeNull();
    await expect(verifyLogin("elder","senha-forte")).resolves.toBe(true);
  });
});
