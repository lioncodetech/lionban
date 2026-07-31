export function applicationContextSection(projectContext:string, technicalHistory:string) {
  const context=projectContext.trim();
  const history=technicalHistory.trim();
  if (!context && !history) return "";

  const sections=[
    context ? `Contexto permanente desta aplicação:\n${context}` : "",
    history ? `Histórico técnico de correções já integradas:\n${history}` : "",
  ].filter(Boolean);

  return `\n\n${sections.join("\n\n")}\n\nUse esse contexto como orientação do projeto, confirme-o contra o código e a documentação atuais e não suponha que chamados ausentes deste histórico foram integrados.`;
}

export type ProjectContextDocument =
  | {status:"missing"|"empty"|"too_large"}
  | {status:"ready";content:string};

export function normalizeProjectContextDocument(content:string|null, maximumLength=30000):ProjectContextDocument {
  if (content===null) return {status:"missing"};
  const normalized=content.trim();
  if (!normalized) return {status:"empty"};
  if (normalized.length>maximumLength) return {status:"too_large"};
  return {status:"ready",content:normalized};
}
