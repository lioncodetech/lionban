"use client";

import { FormEvent, useEffect, useState } from "react";

type Status = "Aberto" | "Analisando" | "Corrigindo" | "Testando" | "Aguardando aprovação" | "Concluído" | "Falhou";
type App = { id: string; name: string; repo: string; language: string; branch: string; color: string };
type Ticket = { id: number; appId: string; title: string; description: string; priority: "Baixa" | "Média" | "Alta" | "Crítica"; status: Status; age: string };
type GitHubRepo = { id: number; name: string; full_name: string; default_branch: string; language: string | null; clone_url: string };

const statuses: Status[] = ["Aberto", "Analisando", "Corrigindo", "Testando", "Aguardando aprovação", "Concluído", "Falhou"];
const statusFromApi: Record<string, Status> = { open:"Aberto", analyzing:"Analisando", fixing:"Corrigindo", testing:"Testando", approval:"Aguardando aprovação", completed:"Concluído", failed:"Falhou", cancelled:"Falhou" };
const priorityFromApi: Record<string, Ticket["priority"]> = { low:"Baixa", medium:"Média", high:"Alta", critical:"Crítica" };
const priorityToApi: Record<Ticket["priority"], string> = { Baixa:"low", Média:"medium", Alta:"high", Crítica:"critical" };

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [applicationList, setApplicationList] = useState<App[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState("");
  const [view, setView] = useState<"board" | "apps">("board");
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [query, setQuery] = useState("");
  const [repoQuery, setRepoQuery] = useState("");
  const [appId, setAppId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Ticket["priority"]>("Média");
  const [importModal, setImportModal] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubQuery, setGithubQuery] = useState("");
  const [importing, setImporting] = useState<number | null>(null);
  const [importError, setImportError] = useState("");
  const app = (id: string) => applicationList.find(a => a.id === id) ?? { id, name:"Aplicação indisponível", repo:"Repositório removido", language:"—", branch:"—", color:"#829087" };
  const visible = tickets.filter(t => `${t.title} ${app(t.appId).name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    async function loadData() {
      try {
        const [appsResponse, ticketsResponse] = await Promise.all([fetch("/api/applications"), fetch("/api/tickets")]);
        if (!appsResponse.ok || !ticketsResponse.ok) throw new Error("Falha ao carregar os dados");
        const [appRows, ticketRows] = await Promise.all([appsResponse.json(), ticketsResponse.json()]);
        setApplicationList(appRows.map((row: Record<string, unknown>) => ({
          id:String(row.id), name:String(row.name), repo:String(row.full_name),
          language:String(row.language ?? "Não detectada"), branch:String(row.default_branch), color:"#236b50",
        })));
        setTickets(ticketRows.map((row: Record<string, unknown>) => ({
          id:Number(row.id), appId:String(row.application_id), title:String(row.title), description:String(row.description),
          priority:priorityFromApi[String(row.priority)] ?? "Média", status:statusFromApi[String(row.status)] ?? "Falhou",
          age:new Date(String(row.created_at)).toLocaleDateString("pt-BR"),
        })));
      } catch {
        setDataError("Não foi possível carregar os dados do PostgreSQL.");
      } finally { setLoadingData(false); }
    }
    loadData();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!appId || !title.trim() || !description.trim()) return;
    const response = await fetch("/api/tickets", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ applicationId:appId, title, description, priority:priorityToApi[priority] }),
    });
    if (!response.ok) { setDataError("Não foi possível criar o chamado."); return; }
    const created = await response.json();
    setTickets(v => [{ id:Number(created.id), appId:String(created.application_id), title:String(created.title), description:String(created.description), priority, status:"Aberto", age:"agora" }, ...v]);
    setModal(false); setAppId(""); setTitle(""); setDescription(""); setPriority("Média");
  }

  async function openImport() {
    setImportModal(true); setImportError(""); setGithubRepos([]);
    const response = await fetch("/api/applications", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setImportError(result.error ?? "Não foi possível consultar o GitHub.");
      return;
    }
    setGithubRepos(await response.json());
  }

  async function importRepository(repository: GitHubRepo) {
    setImporting(repository.id); setImportError("");
    const response = await fetch("/api/applications", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setImportError(result.error ?? "Não foi possível importar o repositório."); setImporting(null); return;
    }
    const imported: App = {
      id: result.id, name: result.name, repo: result.full_name,
      language: result.language ?? "Não detectada", branch: result.default_branch, color: "#236b50",
    };
    setApplicationList(current => [...current.filter(item => item.repo !== imported.repo), imported]);
    setImporting(null); setImportModal(false); setView("apps");
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><i>L</i><div><strong>LionBan</strong><span>Autonomous fixes</span></div></div>
      <nav>
        <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ <span>Quadro</span></button>
        <button className={view === "apps" ? "active" : ""} onClick={() => setView("apps")}>⌘ <span>Aplicações</span><b>{applicationList.length}</b></button>
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
          <div><span>Em andamento</span><strong>{tickets.filter(t => ["Analisando","Corrigindo","Testando"].includes(t.status)).length}</strong><small>execuções ativas</small></div>
          <div><span>Aguardando você</span><strong>{tickets.filter(t => t.status === "Aguardando aprovação").length}</strong><small>aprovações pendentes</small></div>
          <div><span>Concluídos</span><strong>{tickets.filter(t => t.status === "Concluído").length}</strong><small>no histórico</small></div>
          <div><span>Executor</span><strong className="ok">Operacional</strong><small>● fila saudável</small></div>
        </div>
        {dataError && <div className="import-error">{dataError}</div>}
        {loadingData ? <div className="loading-board">Carregando seus chamados…</div> : <div className="board">{statuses.map(status => <section className="column" key={status}>
          <header><i className={`status s${statuses.indexOf(status)}`} /><strong>{status}</strong><b>{visible.filter(t => t.status === status).length}</b></header>
          {visible.filter(t => t.status === status).map(t => <button className="ticket" key={t.id} onClick={() => setDetail(t)}>
            <div className="ticket-top"><span className={`p-${t.priority}`}>{t.priority}</span><small>#{t.id}</small></div>
            <h3>{t.title}</h3><p>{t.description}</p>
            <div className="repo"><i style={{ background: app(t.appId).color }}>{app(t.appId).name[0]}</i><div><strong>{app(t.appId).name}</strong><small>{app(t.appId).repo}</small></div></div>
            <footer><span>⑂ {app(t.appId).branch}</span><span>{t.age}</span></footer>
          </button>)}
          {!visible.some(t => t.status === status) && <div className="empty">Nenhum chamado</div>}
        </section>)}</div>}
      </> : <div className="apps">{applicationList.map(a => <article key={a.id}>
        <div className="app-icon" style={{ background: a.color }}>{a.name[0]}</div><span className="authorized">● AUTORIZADO</span>
        <h2>{a.name}</h2><p>◉ {a.repo}</p>
        <dl><div><dt>Linguagem</dt><dd>{a.language}</dd></div><div><dt>Branch principal</dt><dd>{a.branch}</dd></div></dl>
        <footer><span>{tickets.filter(t => t.appId === a.id).length} chamados</span><button>Configurar →</button></footer>
      </article>)}<button className="add" onClick={openImport}><b>＋</b><strong>Importar repositório</strong><small>Conectar outra aplicação do GitHub</small></button></div>}
    </section>

    {modal && <div className="overlay" onMouseDown={() => setModal(false)}><form className="modal" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
      <header><div><p>NOVO CHAMADO</p><h2>O que precisa ser corrigido?</h2></div><button type="button" onClick={() => setModal(false)}>×</button></header>
      <label>Aplicação <b>*</b><small>O repositório ficará bloqueado após criar.</small></label>
      <div className="picker"><label>⌕ <input value={repoQuery} onChange={e => setRepoQuery(e.target.value)} placeholder="Buscar aplicação ou repositório..." /></label>
        {applicationList.filter(a => `${a.name} ${a.repo}`.toLowerCase().includes(repoQuery.toLowerCase())).map(a => <button type="button" className={appId === a.id ? "chosen" : ""} onClick={() => setAppId(a.id)} key={a.id}><i style={{ background: a.color }}>{a.name[0]}</i><div><strong>{a.name}</strong><small>{a.repo}</small></div><em>{a.language}</em><b>{appId === a.id ? "✓" : ""}</b></button>)}
      </div>
      <label>Título <b>*</b><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Login falha depois de redefinir a senha" /></label>
      <label>Descrição do bug <b>*</b><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Explique o comportamento atual, o esperado e como reproduzir..." /></label>
      <div className="row"><label>Prioridade<select value={priority} onChange={e => setPriority(e.target.value as Ticket["priority"])}><option>Baixa</option><option>Média</option><option>Alta</option><option>Crítica</option></select></label><div className="drop">⌁ <span>Logs e imagens<small>Adicionar depois</small></span></div></div>
      <footer><button type="button" className="secondary" onClick={() => setModal(false)}>Cancelar</button><button className="primary" disabled={!appId || !title || !description}>Criar e enviar ao Codex →</button></footer>
    </form></div>}

    {importModal && <div className="overlay" onMouseDown={() => setImportModal(false)}><section className="modal import-modal" onMouseDown={e => e.stopPropagation()}>
      <header><div><p>IMPORTAR DO GITHUB</p><h2>Escolha um repositório</h2></div><button onClick={() => setImportModal(false)}>×</button></header>
      <div className="picker import-picker"><label>⌕ <input value={githubQuery} onChange={e => setGithubQuery(e.target.value)} placeholder="Buscar nos repositórios autorizados..." /></label>
        {githubRepos.length === 0 && !importError && <div className="import-loading">Consultando repositórios autorizados…</div>}
        {githubRepos.filter(repo => repo.full_name.toLowerCase().includes(githubQuery.toLowerCase())).map(repo =>
          <button type="button" key={repo.id} onClick={() => importRepository(repo)} disabled={importing !== null}>
            <i>{repo.name[0].toUpperCase()}</i><div><strong>{repo.name}</strong><small>{repo.full_name}</small></div>
            <em>{repo.language ?? "—"} · {repo.default_branch}</em><b>{importing === repo.id ? "…" : "＋"}</b>
          </button>)}
      </div>
      {importError && <div className="import-error">{importError}</div>}
      <footer><button className="secondary" onClick={() => setImportModal(false)}>Cancelar</button></footer>
    </section></div>}

    {detail && <div className="overlay side" onMouseDown={() => setDetail(null)}><aside className="detail" onMouseDown={e => e.stopPropagation()}>
      <header><div><p>CHAMADO #{detail.id}</p><h2>{detail.title}</h2></div><button onClick={() => setDetail(null)}>×</button></header>
      <div className="locked"><i style={{background:app(detail.appId).color}}>{app(detail.appId).name[0]}</i><div><strong>{app(detail.appId).name}</strong><small>{app(detail.appId).repo} · {app(detail.appId).branch}</small></div><b>Repositório bloqueado</b></div>
      <p className="description">{detail.description}</p><h4>ATIVIDADE DO AGENTE</h4>
      <div className="timeline"><div className="done"><i>✓</i><span><strong>Repositório validado e clonado</strong><small>branch lionban/chamado-{detail.id}</small></span></div><div className="done"><i>✓</i><span><strong>Investigação iniciada</strong><small>18 arquivos relacionados analisados</small></span></div><div className="running"><i>◌</i><span><strong>Reproduzindo o erro</strong><small>Criando um teste de regressão...</small></span></div><div><i>4</i><span><strong>Corrigir e validar</strong><small>Aguardando etapa anterior</small></span></div></div>
      <footer><button className="danger">Cancelar execução</button><button className="secondary">Ver logs completos</button></footer>
    </aside></div>}
  </main>;
}
