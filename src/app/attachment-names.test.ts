import { describe, expect, it } from "vitest";

import { attachmentName } from "./attachment-names";

describe("attachmentName", () => {
  it("mantém o nome original quando há somente uma imagem", () => {
    expect(attachmentName("erro.png", 0, 1)).toBe("erro.png");
  });

  it("adiciona um sufixo sequencial antes da extensão quando há várias imagens", () => {
    expect(attachmentName("erro.png", 0, 2)).toBe("erro1.png");
    expect(attachmentName("captura.final.webp", 1, 2)).toBe("captura.final2.webp");
  });

  it("não repete o sufixo de imagens recuperadas ao duplicar um chamado", () => {
    expect(attachmentName("erro1.png", 0, 2)).toBe("erro1.png");
    expect(attachmentName("captura.final2.webp", 1, 2)).toBe("captura.final2.webp");
  });
});
