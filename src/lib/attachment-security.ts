const signatures:Record<string,(content:Buffer)=>boolean>={
  "image/png":content=>content.length>=8&&content.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
  "image/jpeg":content=>content.length>=3&&content[0]===0xff&&content[1]===0xd8&&content[2]===0xff,
  "image/gif":content=>content.length>=6&&["GIF87a","GIF89a"].includes(content.subarray(0,6).toString("ascii")),
  "image/webp":content=>content.length>=12&&content.subarray(0,4).toString("ascii")==="RIFF"&&content.subarray(8,12).toString("ascii")==="WEBP",
};

export function hasExpectedImageSignature(content:Buffer,mimeType:string) {
  return signatures[mimeType]?.(content) ?? false;
}
