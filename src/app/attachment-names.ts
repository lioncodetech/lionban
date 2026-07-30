export function attachmentName(name:string, index:number, total:number) {
  if (total <= 1) return name;

  const extensionStart = name.lastIndexOf(".");
  const suffix = String(index + 1);
  const baseName = extensionStart <= 0 ? name : name.slice(0, extensionStart);
  if (baseName.endsWith(suffix)) return name;
  if (extensionStart <= 0) return `${name}${suffix}`;

  return `${baseName}${suffix}${name.slice(extensionStart)}`;
}
