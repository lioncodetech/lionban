export function attachmentName(name:string, index:number) {
  const extensionStart = name.lastIndexOf(".");
  const extension = extensionStart <= 0 ? "" : name.slice(extensionStart);

  return `imagem_${index + 1}${extension}`;
}
