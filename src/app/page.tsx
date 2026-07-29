"use client";

import { FormEvent, useMemo, useState } from "react";

type Status = "Aberto" | "Analisando" | "Corrigindo" | "Testando" | "Aguardando aprovação" | "Concluído" | "Falhou";
type App = { id: string; name: string; repo: string; language: string; branch: string; color: string };
type Ticket = { id: number; appId: string; title: string; description: string; priority: "Baixa" | "Média" | "Alta" | "Crítica"; status: Status; age: string };

const apps: App[] = [
  { id: "atlas", name: "Atlas CRM", repo: "elder/atlas-crm", language: "TypeScript", branch: "main", color: "#765be5" },
  { id: "nexo", name: "Nexo Finance", repo: "elder/nexo-finance", language: "Python", branch: "main", color: "#18a87f" },
  { id: "orbit", name: "Orbit API", repo: "elder/orbit-api", language: "Go", branch: "master", color: "#e99542" },
];
const seed: Ticket[] = [
  { id: 42, appId: "atlas", title: "Filtro de clientes perde seleção", description: "Ao voltar da tela de detalhes, o filtro de status é limpo.", priority: "Alta", status: "Analisando", age: "há 4 min" },
  { id: 41, appId: "nexo", title: "Total do relatório diverge", description: "O fechamento mensal ignora estornos no último dia.", priority: "Crítica", status: "Corrigindo", age: "há 18 min" },
  { id: 40, appId: "orbit", title: "Timeout ao importar CSV", description: "Arquivos acima de 8 MB encerram a requisição.", priority: "Média", status: "Testando", age: "há 31 min" },
  { id: 39, appId: "atlas", title: "Corrigir contraste do menu", description: "Texto ilegível no tema escuro.", priority: "Baixa", status: "Concluído", age: "ontem" },
];
const statuses: Status[] = ["Aberto", "Analisando", "Corrigindo", "Testando", "Aguardando aprovação", "Concluído", "Falhou"];

export default function Home() {
  const [tickets, setTickets] = useState(seed);
  const [view, setView] = useState<"board" | "apps">("board");
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [query, setQuery] = useState("");
  const [repoQuery, setRepoQuery] = useState("");
  const [appId, setAppId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Ticket["priority"]>("Média");
  const app = (id: string) => apps.find(a => a.id === id)!;
  const visible = useMemo(() => tickets.filter(t => `${t.title} ${app(t.appId).name}`.toLowerCase().includes(query.toLowerCase())), [tickets, query]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!appId || !title.trim() || !description.trim()) return;
    setTickets(v => [{ id: Math.max(...v.map(t => t.id)) + 1, appId, title, description, priority, status: "Aberto", age: "agora" }, ...v]);
    setModal(false); setAppId(""); setTitle(""); setDescription(""); setPriority("Média");
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><i>L</i><div><strong>LionBan</strong><span>Autonomous fixes</span></div></div>
      <nav>
        <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ <span>Quadro</span></button>
        <button className={view === "apps" ? "active" : ""} onClick={() => setView("apps")}>⌘ <span>Aplicações</span><b>{apps.length}</b></button>
      </nav>
      <div className="agent"><strong><i /> Codex conectado</strong><p>Executor pronto para receber novos chamados.</p><hr /><small>37% do limite usado</small></div>
      <div className="user"><i>ES</i><div><strong>Elder</strong><span>Administrador</span></div><b>•••</b></div>
    </aside>

    <section className="content">
      <header>
        <div><p>{view === "board" ? "CENTRO DE CORREÇÕES" : "REPOSITÓRIOS AUTORIZADOS"}</p><h1>{view === "board" ? "Quadro de chamados" : "Aplicações"}</h1></div>
        <div className="actions"><label>⌕ <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar chamado..." /></label><button className="primary" onClick={() => setModal(true)}>＋ Novo chamado</button></div>
      </header>

      {view === "board" ? <>
        <div className="stats">
          <div><span>Em andamento</span><strong>3</strong><small>execuções ativas</small></div>
          <div><span>Aguardando você</span><strong>0</strong><small>aprovações pendentes</small></div>
          <div><span>Concluídos</span><strong>1</strong><small>nesta semana</small></div>
          <div><span>Executor</span><strong className="ok">Operacional</strong><small>● fila saudável</small></div>
        </div>
        <div className="board">{statuses.map(status => <section className="column" key={status}>
          <header><i className={`status s${statuses.indexOf(status)}`} /><strong>{status}</strong><b>{visible.filter(t => t.status === status).length}</b></header>
          {visible.filter(t => t.status === status).map(t => <button className="ticket" key={t.id} onClick={() => setDetail(t)}>
            <div className="ticket-top"><span className={`p-${t.priority}`}>{t.priority}</span><small>#{t.id}</small></div>
            <h3>{t.title}</h3><p>{t.description}</p>
            <div className="repo"><i style={{ background: app(t.appId).color }}>{app(t.appId).name[0]}</i><div><strong>{app(t.appId).name}</strong><small>{app(t.appId).repo}</small></div></div>
            <footer><span>⑂ {app(t.appId).branch}</span><span>{t.age}</span></footer>
          </button>)}
          {!visible.some(t => t.status === status) && <div className="empty">Nenhum chamado</div>}
        </section>)}</div>
      </> : <div className="apps">{apps.map(a => <article key={a.id}>
        <div className="app-icon" style={{ background: a.color }}>{a.name[0]}</div><span className="authorized">● AUTORIZADO</span>
        <h2>{a.name}</h2><p>◉ {a.repo}</p>
        <dl><div><dt>Linguagem</dt><dd>{a.language}</dd></div><div><dt>Branch principal</dt><dd>{a.branch}</dd></div></dl>
        <footer><span>{tickets.filter(t => t.appId === a.id).length} chamados</span><button>Configurar →</button></footer>
      </article>)}<button className="add"><b>＋</b><strong>Importar repositório</strong><small>Conectar outra aplicação do GitHub</small></button></div>}
    </section>

    {modal && <div className="overlay" onMouseDown={() => setModal(false)}><form className="modal" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
      <header><div><p>NOVO CHAMADO</p><h2>O que precisa ser corrigido?</h2></div><button type="button" onClick={() => setModal(false)}>×</button></header>
      <label>Aplicação <b>*</b><small>O repositório ficará bloqueado após criar.</small></label>
      <div className="picker"><label>⌕ <input value={repoQuery} onChange={e => setRepoQuery(e.target.value)} placeholder="Buscar aplicação ou repositório..." /></label>
        {apps.filter(a => `${a.name} ${a.repo}`.toLowerCase().includes(repoQuery.toLowerCase())).map(a => <button type="button" className={appId === a.id ? "chosen" : ""} onClick={() => setAppId(a.id)} key={a.id}><i style={{ background: a.color }}>{a.name[0]}</i><div><strong>{a.name}</strong><small>{a.repo}</small></div><em>{a.language}</em><b>{appId === a.id ? "✓" : ""}</b></button>)}
      </div>
      <label>Título <b>*</b><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Login falha depois de redefinir a senha" /></label>
      <label>Descrição do bug <b>*</b><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Explique o comportamento atual, o esperado e como reproduzir..." /></label>
      <div className="row"><label>Prioridade<select value={priority} onChange={e => setPriority(e.target.value as Ticket["priority"])}><option>Baixa</option><option>Média</option><option>Alta</option><option>Crítica</option></select></label><div className="drop">⌁ <span>Logs e imagens<small>Adicionar depois</small></span></div></div>
      <footer><button type="button" className="secondary" onClick={() => setModal(false)}>Cancelar</button><button className="primary" disabled={!appId || !title || !description}>Criar e enviar ao Codex →</button></footer>
    </form></div>}

    {detail && <div className="overlay side" onMouseDown={() => setDetail(null)}><aside className="detail" onMouseDown={e => e.stopPropagation()}>
      <header><div><p>CHAMADO #{detail.id}</p><h2>{detail.title}</h2></div><button onClick={() => setDetail(null)}>×</button></header>
      <div className="locked"><i style={{background:app(detail.appId).color}}>{app(detail.appId).name[0]}</i><div><strong>{app(detail.appId).name}</strong><small>{app(detail.appId).repo} · {app(detail.appId).branch}</small></div><b>Repositório bloqueado</b></div>
      <p className="description">{detail.description}</p><h4>ATIVIDADE DO AGENTE</h4>
      <div className="timeline"><div className="done"><i>✓</i><span><strong>Repositório validado e clonado</strong><small>branch lionban/chamado-{detail.id}</small></span></div><div className="done"><i>✓</i><span><strong>Investigação iniciada</strong><small>18 arquivos relacionados analisados</small></span></div><div className="running"><i>◌</i><span><strong>Reproduzindo o erro</strong><small>Criando um teste de regressão...</small></span></div><div><i>4</i><span><strong>Corrigir e validar</strong><small>Aguardando etapa anterior</small></span></div></div>
      <footer><button className="danger">Cancelar execução</button><button className="secondary">Ver logs completos</button></footer>
    </aside></div>}
  </main>;
}
