import { describe, expect, it } from "vitest";

import { applicationContextSection } from "./project-context";

describe("applicationContextSection", () => {
  it("não acrescenta seção quando a aplicação ainda não tem contexto", () => {
    expect(applicationContextSection("", "")).toBe("");
  });

  it("inclui contexto permanente e histórico técnico separadamente", () => {
    const result=applicationContextSection("Arquitetura: Next.js", "#12 — login corrigido");
    expect(result).toContain("Contexto permanente desta aplicação:\nArquitetura: Next.js");
    expect(result).toContain("Histórico técnico de correções já integradas:\n#12 — login corrigido");
    expect(result).toContain("confirme-o contra o código e a documentação atuais");
  });
});
