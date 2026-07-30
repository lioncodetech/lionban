export function attachmentName(name:string, index:number, total:number) {
  if (total <= 1) return name;

  const extensionStart = name.lastIndexOf(".");
  if (extensionStart <= 0) return `${name}${index + 1}`;

  return `${name.slice(0, extensionStart)}${index + 1}${name.slice(extensionStart)}`;
}
