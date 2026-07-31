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
