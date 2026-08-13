const forbiddenOutsideQuotes = new Set([";", "&", "|", ">", "<", "`", "\n", "\r"]);

export function commandParts(command:string) {
  const parts:string[]=[];
  let current="";
  let quote:"'"|'\"'|null=null;
  let escaped=false;
  for (const character of command.trim()) {
    if (escaped) { current+=character; escaped=false; continue; }
    if (character==="\\" && quote!=="'") { escaped=true; continue; }
    if (quote) {
      if (character===quote) quote=null;
      else current+=character;
      continue;
    }
    if (character==="'" || character==='\"') { quote=character; continue; }
    if (forbiddenOutsideQuotes.has(character)) throw new Error("COMMAND_SHELL_OPERATOR_NOT_ALLOWED");
    if (/\s/.test(character)) {
      if (current) { parts.push(current); current=""; }
      continue;
    }
    current+=character;
  }
  if (escaped || quote) throw new Error("COMMAND_QUOTE_NOT_CLOSED");
  if (current) parts.push(current);
  if (!parts.length) throw new Error("COMMAND_EMPTY");
  return {bin:parts[0],args:parts.slice(1)};
}
