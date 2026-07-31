import { afterEach,describe,expect,it } from "vitest";
import { hash } from "bcryptjs";
import { authConfigurationError,diagnoseLogin,verifyLogin } from "./auth";

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
    await expect(diagnoseLogin("elder","senha-forte")).resolves.toMatchObject({
      usernameMatches:true,passwordMatches:true,hashShapeValid:true,hashLength:60,
    });
    process.env.ADMIN_PASSWORD_HASH=`'${process.env.ADMIN_PASSWORD_HASH!.trim()}'`;
    await expect(verifyLogin("ELDER","senha-forte")).resolves.toBe(true);
  });
});
