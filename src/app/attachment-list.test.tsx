import { describe, expect, it, vi } from "vitest";

import { AttachmentList, type Attachment } from "./attachment-list";

describe("AttachmentList", () => {
  it("abre a imagem anexada ao clicar na miniatura", () => {
    const attachment:Attachment = {
      file:new File(["imagem"], "erro.png", { type:"image/png" }),
      preview:"blob:erro",
    };
    const onPreview=vi.fn();
    const tree=AttachmentList({
      attachments:[attachment],
      onPreview,
      onRemove:vi.fn(),
    });
    const item=tree.props.children[0];
    const previewButton=item.props.children[0];

    expect(previewButton.type).toBe("button");
    expect(previewButton.props["aria-label"]).toBe("Ampliar erro.png");

    previewButton.props.onClick();

    expect(onPreview).toHaveBeenCalledWith(attachment);
  });
});
