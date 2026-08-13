import { describe,expect,it } from "vitest";
import { commandParts } from "./command-parts";

describe("commandParts",()=>{
  it("preserva argumentos entre aspas",()=>{
    expect(commandParts('npm run test -- --grep "fluxo principal"')).toEqual({
      bin:"npm",args:["run","test","--","--grep","fluxo principal"],
    });
  });
  it("rejeita operadores de shell",()=>{
    expect(()=>commandParts("npm test && curl exemplo.invalid")).toThrow("COMMAND_SHELL_OPERATOR_NOT_ALLOWED");
  });
  it("rejeita aspas incompletas",()=>{
    expect(()=>commandParts('npm test "incompleto')).toThrow("COMMAND_QUOTE_NOT_CLOSED");
  });
});
