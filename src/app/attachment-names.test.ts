import { describe, expect, it } from "vitest";

import { attachmentName } from "./attachment-names";

describe("attachmentName", () => {
  it("numera também quando há somente uma imagem", () => {
    expect(attachmentName("erro.png", 0)).toBe("imagem_1.png");
  });

  it("usa o nome imagem com sufixo sequencial e preserva a extensão", () => {
    expect(attachmentName("erro.png", 0)).toBe("imagem_1.png");
    expect(attachmentName("captura.final.webp", 1)).toBe("imagem_2.webp");
    expect(attachmentName("foto.jpeg", 2)).toBe("imagem_3.jpeg");
  });

  it("renumera imagens recuperadas ao duplicar ou editar um chamado", () => {
    expect(attachmentName("imagem_4.png", 0)).toBe("imagem_1.png");
    expect(attachmentName("captura.final2.webp", 1)).toBe("imagem_2.webp");
  });

  it("numera arquivos sem extensão", () => {
    expect(attachmentName("captura", 0)).toBe("imagem_1");
  });
});
