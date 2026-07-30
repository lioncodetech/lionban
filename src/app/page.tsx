"use client";

import { ClipboardEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";

type Status = "Aberto" | "Analisando" | "Corrigindo" | "Testando" | "Aguardando aprovação" | "Concluído" | "Falhou";
type App = {
  id:string; name:string; repo:string; language:string; branch:string; color:string; deployConfigured:boolean;
  installCommand:string; testCommand:string; lintCommand:string; buildCommand:string;
};
type Ticket = { id:number; appId:string; title:string; description:string; priority:"Baixa"|"Média"|"Alta"|"Crítica"; queuePriority:number; status:Status; age:string };
type GitHubRepo = { id: number; name: string; full_name: string; default_branch: string; language: string | null; clone_url: string };
type Attachment = { file: File; preview: string };
type AgentHealth = { workerOnline: boolean; codexAuthenticated: boolean; lastSeen: string | null; message: string };
type TicketEvent = { id:number; kind:string; message:string; metadata:Record<string,unknown>; created_at:string };
type TicketExecution = { id:string; state:string; attempt:number; started_at:string|null; finished_at:string|null; error_message:string|null };
type TicketApproval = { id:string; reason:string; decision:string|null; decided_at:string|null; created_at:string; patch_available:boolean };
type TicketDetails = {
  events:TicketEvent[]; executions:TicketExecution[]; approvals:TicketApproval[];
  auto_commit:boolean; auto_push:boolean; auto_pull_request:boolean; auto_deploy:boolean;
  create_tag:boolean; release_tag:string|null;
};
type RepoTag = { name:string; commit:{sha:string} };
type CodexTranscriptItem = { at:string; type:string; text:string };

const statuses: Status[] = ["Aberto", "Analisando", "Corrigindo", "Testando", "Aguardando aprovação", "Concluído", "Falhou"];
const statusFromApi: Record<string, Status> = { open:"Aberto", analyzing:"Analisando", fixing:"Corrigindo", testing:"Testando", approval:"Aguardando aprovação", completed:"Concluído", failed:"Falhou", cancelled:"Falhou" };
const priorityFromApi: Record<string, Ticket["priority"]> = { low:"Baixa", medium:"Média", high:"Alta", critical:"Crítica" };
const priorityToApi: Record<Ticket["priority"], string> = { Baixa:"low", Média:"medium", Alta:"high", Crítica:"critical" };
const statusToApi: Record<Status, string> = { Aberto:"open", Analisando:"analyzing", Corrigindo:"fixing", Testando:"testing", "Aguardando aprovação":"approval", Concluído:"completed", Falhou:"failed" };
const eventLabels:Record<string,string> = {
  "ticket.created":"Chamado criado", "ticket.moved":"Chamado movimentado", "repository.cloned":"Repositório preparado",
  "repository.validating":"Validando repositório", "repository.cloning":"Clonando repositório",
  "repository.validated":"Repositório validado", "codex.started":"Codex trabalhando",
  "execution.recovered":"Execução recuperada", "execution.retried":"Nova tentativa iniciada", "execution.failed":"Execução falhou",
  "execution.cancelled":"Execução cancelada", "execution.cancel_requested":"Cancelamento solicitado", "commit.created":"Commit criado",
  "branch.pushed":"Branch enviada", "pull_request.created":"Pull Request criado", "merge.completed":"Correção integrada",
  "tag.created":"Versão criada", "deploy.triggered":"Deploy solicitado", "patch.prepared":"Correção preparada",
  "documentation.started":"Documentando a correção", "documentation.updated":"Documentação atualizada",
  "approval.requested":"Aprovação solicitada", "approval.approved":"Correção aprovada",
  "approval.rejected":"Correção rejeitada", "approval.restored":"Patch aprovado restaurado",
  "approval.completed":"Aprovação concluída",
};
const ticketDetailsFromApi=(result:Record<string,unknown>):TicketDetails => ({
  events:(result.events as TicketEvent[] | undefined) ?? [],
  executions:(result.executions as TicketExecution[] | undefined) ?? [],
  approvals:(result.approvals as TicketApproval[] | undefined) ?? [],
  auto_commit:Boolean(result.auto_commit),auto_push:Boolean(result.auto_push),
  auto_pull_request:Boolean(result.auto_pull_request),auto_deploy:Boolean(result.auto_deploy),
  create_tag:Boolean(result.create_tag),release_tag:result.release_tag ? String(result.release_tag) : null,
});

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
  const [queuePriority, setQueuePriority] = useState(5);
  const [importModal, setImportModal] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubQuery, setGithubQuery] = useState("");
  const [importing, setImporting] = useState<number | null>(null);
  const [importError, setImportError] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draggedTicket, setDraggedTicket] = useState<number | null>(null);
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({ workerOnline:false, codexAuthenticated:false, lastSeen:null, message:"Verificando o executor…" });
  const [autoCommit, setAutoCommit] = useState(true);
  const [autoPush, setAutoPush] = useState(true);
  const [autoPullRequest, setAutoPullRequest] = useState(false);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [configApp, setConfigApp] = useState<App | null>(null);
  const [deployWebhookUrl, setDeployWebhookUrl] = useState("");
  const [removeDeployWebhook, setRemoveDeployWebhook] = useState(false);
  const [installCommand, setInstallCommand] = useState("");
  const [testCommand, setTestCommand] = useState("");
  const [lintCommand, setLintCommand] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [ticketDetails, setTicketDetails] = useState<TicketDetails | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [repoTags, setRepoTags] = useState<RepoTag[]>([]);
  const [createTag, setCreateTag] = useState(false);
  const [releaseTag, setReleaseTag] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const app = (id: string) => applicationList.find(a => a.id === id) ?? {
    id,name:"Aplicação indisponível",repo:"Repositório removido",language:"—",branch:"—",color:"#829087",
    deployConfigured:false,installCommand:"",testCommand:"",lintCommand:"",buildCommand:"",
  };
  const visible = tickets.filter(t => `${t.title} ${app(t.appId).name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    async function loadData() {
      try {
        const [appsResponse, ticketsResponse] = await Promise.all([fetch("/api/applications"), fetch("/api/tickets")]);
        if (!appsResponse.ok || !ticketsResponse.ok) throw new Error("Falha ao carregar os dados");
        const [appRows, ticketRows] = await Promise.all([appsResponse.json(), ticketsResponse.json()]);
        setApplicationList(appRows.map((row: Record<string, unknown>) => ({
          id:String(row.id), name:String(row.name), repo:String(row.full_name),
          language:String(row.language ?? "Não detectada"), branch:String(row.default_branch), color:"#236b50", deployConfigured:Boolean(row.deploy_configured),
          installCommand:String(row.install_command ?? ""),testCommand:String(row.test_command ?? ""),
          lintCommand:String(row.lint_command ?? ""),buildCommand:String(row.build_command ?? ""),
        })));
        setTickets(ticketRows.map((row: Record<string, unknown>) => ({
          id:Number(row.id), appId:String(row.application_id), title:String(row.title), description:String(row.description),
          priority:priorityFromApi[String(row.priority)] ?? "Média",queuePriority:Number(row.queue_priority ?? 5),status:statusFromApi[String(row.status)] ?? "Falhou",
          age:new Date(String(row.created_at)).toLocaleDateString("pt-BR"),
        })));
      } catch {
        setDataError("Não foi possível carregar os dados do PostgreSQL.");
      } finally { setLoadingData(false); }
    }
    loadData();
  }, []);

  useEffect(() => {
    if (!detail) return;
    const ticketId=detail.id;
    const timer=window.setInterval(async ()=>{
      const response=await fetch(`/api/tickets/${ticketId}`,{cache:"no-store"});
      if (response.ok) {
        const result=await response.json();
        setTicketDetails(ticketDetailsFromApi(result));
      }
    },5000);
    return ()=>window.clearInterval(timer);
  }, [detail]);

  useEffect(() => {
    let active = true;
    async function loadHealth() {
      try {
        const response = await fetch("/api/health", { cache:"no-store" });
        if (!response.ok) throw new Error();
        const health = await response.json();
        if (active) setAgentHealth(health);
      } catch {
        if (active) setAgentHealth({ workerOnline:false, codexAuthenticated:false, lastSeen:null, message:"Não foi possível consultar o executor." });
      }
    }
    loadHealth();
    const timer = window.setInterval(loadHealth, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function moveTicket(ticketId: number, status: Status) {
    const previous = tickets.find(ticket => ticket.id === ticketId);
    if (!previous || previous.status === status) return;
    setTickets(current => current.map(ticket => ticket.id === ticketId ? { ...ticket, status } : ticket));
    if (detail?.id === ticketId) setDetail({ ...detail, status });
    const response = await fetch(`/api/tickets/${ticketId}`, {
      method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({ status:statusToApi[status] }),
    });
    if (!response.ok) {
      setTickets(current => current.map(ticket => ticket.id === ticketId ? previous : ticket));
      if (detail?.id === ticketId) setDetail(previous);
      setDataError("Não foi possível mover o chamado. A alteração foi desfeita.");
    }
  }

  async function loadTicketDetails(ticketId:number) {
    const response=await fetch(`/api/tickets/${ticketId}`,{cache:"no-store"});
    if (response.ok) {
      const result=await response.json();
      setTicketDetails(ticketDetailsFromApi(result));
    }
  }
  async function openTicket(ticket:Ticket) {
    setDetail(ticket); setTicketDetails(null); setShowLogs(false);
    await loadTicketDetails(ticket.id);
  }

  async function cancelExecution() {
    if (!detail || !window.confirm(`Cancelar a execução do chamado #${detail.id}?`)) return;
    const response=await fetch(`/api/tickets/${detail.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({cancel:true})});
    if (!response.ok) { setDataError("Não foi possível solicitar o cancelamento."); return; }
    setTickets(current => current.map(ticket => ticket.id===detail.id?{...ticket,status:"Falhou"}:ticket));
    setDetail({...detail,status:"Falhou"});
    await openTicket({...detail,status:"Falhou"});
  }

  async function decideApproval(decision:"approved"|"rejected") {
    if (!detail) return;
    const verb=decision==="approved"?"aprovar":"rejeitar";
    if (!window.confirm(`Deseja ${verb} a correção do chamado #${detail.id}?`)) return;
    const response=await fetch(`/api/tickets/${detail.id}`,{
      method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({decision}),
    });
    const result=await response.json().catch(()=>({}));
    if (!response.ok) { setDataError(result.error??"Não foi possível registrar a decisão."); return; }
    const status:Status=decision==="approved"?"Aberto":"Falhou";
    setTickets(current=>current.map(ticket=>ticket.id===detail.id?{...ticket,status}:ticket));
    setDetail({...detail,status});
    await loadTicketDetails(detail.id);
  }

  async function cloneTicket() {
    if (!detail) return;
    attachments.forEach(item=>URL.revokeObjectURL(item.preview));
    setAttachments([]);
    setAppId(detail.appId); setTitle(`${detail.title} (cópia)`); setDescription(detail.description); setPriority(detail.priority); setQueuePriority(detail.queuePriority);
    setAutoCommit(ticketDetails?.auto_commit ?? true); setAutoPush(ticketDetails?.auto_push ?? true);
    setAutoPullRequest(ticketDetails?.auto_pull_request ?? false); setAutoDeploy(ticketDetails?.auto_deploy ?? false);
    setCreateTag(ticketDetails?.create_tag ?? false); setReleaseTag(ticketDetails?.release_tag ?? "");
    setRepoQuery(""); setRepoTags([]); setDataError(""); setDuplicating(true);
    const response=await fetch(`/api/applications/${detail.appId}/tags`,{cache:"no-store"});
    if (response.ok) setRepoTags(await response.json());
    setDetail(null); setModal(true);
  }

  async function deleteTicket() {
    if (!detail || !window.confirm(`Excluir definitivamente o chamado #${detail.id} e todos os seus logs?`)) return;
    const response=await fetch(`/api/tickets/${detail.id}`,{method:"DELETE"});
    const result=await response.json().catch(()=>({}));
    if (!response.ok) { setDataError(result.error??"Não foi possível excluir o chamado."); return; }
    setTickets(current=>current.filter(ticket=>ticket.id!==detail.id));
    setDetail(null); setDataError("");
  }

  function suggestNextTag(tags:RepoTag[]) {
    const versions=tags.map(tag => ({tag:tag.name,match:tag.name.match(/^v?(\d+)\.(\d+)\.(\d+)$/)})).filter(item => item.match)
      .sort((a,b) => Number(b.match![1])-Number(a.match![1]) || Number(b.match![2])-Number(a.match![2]) || Number(b.match![3])-Number(a.match![3]));
    const latest=versions[0];
    return latest?`${latest.tag.startsWith("v")?"v":""}${latest.match![1]}.${latest.match![2]}.${Number(latest.match![3])+1}`:"v1.0.0";
  }

  async function chooseApplication(id:string) {
    setAppId(id); setRepoTags([]); setCreateTag(false); setReleaseTag("");
    const response=await fetch(`/api/applications/${id}/tags`,{cache:"no-store"});
    if (response.ok) { const tags=await response.json(); setRepoTags(tags); setReleaseTag(suggestNextTag(tags)); }
  }

  function openNewTicket() {
    attachments.forEach(item=>URL.revokeObjectURL(item.preview));
    setAttachments([]); setAppId(""); setTitle(""); setDescription(""); setPriority("Média"); setQueuePriority(5);
    setAutoCommit(true); setAutoPush(true); setAutoPullRequest(false); setAutoDeploy(false);
    setCreateTag(false); setReleaseTag(""); setRepoTags([]); setRepoQuery(""); setDuplicating(false); setDataError("");
    setModal(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!appId || !title.trim() || !description.trim()) return;
    const encodedAttachments = await Promise.all(attachments.map(async ({ file }) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
      });
      return { name:file.name, mimeType:file.type, size:file.size, data:dataUrl.split(",")[1] };
    }));
    const response = await fetch("/api/tickets", {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ applicationId:appId,title,description,priority:priorityToApi[priority],queuePriority,attachments:encodedAttachments,autoCommit,autoPush,autoPullRequest,autoDeploy,createTag,releaseTag:createTag?releaseTag:undefined }),
    });
    if (!response.ok) { setDataError("Não foi possível criar o chamado."); return; }
    const created = await response.json();
    setTickets(v => [{ id:Number(created.id),appId:String(created.application_id),title:String(created.title),description:String(created.description),priority,queuePriority,status:"Aberto",age:"agora" }, ...v]);
    attachments.forEach(item => URL.revokeObjectURL(item.preview));
    setModal(false); setAppId(""); setTitle(""); setDescription(""); setPriority("Média"); setQueuePriority(5); setAttachments([]); setDuplicating(false);
    setAutoCommit(true); setAutoPush(true); setAutoPullRequest(false); setAutoDeploy(false);
    setCreateTag(false); setReleaseTag(""); setRepoTags([]);
  }

  function addImages(files: File[]) {
    const accepted = files.filter(file => ["image/png","image/jpeg","image/webp","image/gif"].includes(file.type) && file.size <= 5 * 1024 * 1024);
    if (accepted.length !== files.length) setDataError("Use imagens PNG, JPEG, WebP ou GIF de até 5 MB.");
    setAttachments(current => {
      const room = Math.max(0, 5 - current.length);
      return [...current, ...accepted.slice(0, room).map(file => ({ file, preview:URL.createObjectURL(file) }))];
    });
  }
  function pasteImages(event: ClipboardEvent<HTMLFormElement>) {
    const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (images.length) { event.preventDefault(); addImages(images); }
  }
  function dropImages(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); addImages(Array.from(event.dataTransfer.files));
  }
  function removeImage(index: number) {
    setAttachments(current => { URL.revokeObjectURL(current[index].preview); return current.filter((_, itemIndex) => itemIndex !== index); });
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
      language: result.language ?? "Não detectada", branch: result.default_branch, color:"#236b50", deployConfigured:Boolean(result.deploy_configured),
      installCommand:String(result.install_command ?? ""),testCommand:String(result.test_command ?? ""),
      lintCommand:String(result.lint_command ?? ""),buildCommand:String(result.build_command ?? ""),
    };
    setApplicationList(current => [...current.filter(item => item.repo !== imported.repo), imported]);
    setImporting(null); setImportModal(false); setView("apps");
  }

  async function saveApplicationConfig(e:FormEvent) {
    e.preventDefault();
    if (!configApp) return;
    const response=await fetch(`/api/applications/${configApp.id}`,{
      method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({
        deployWebhookUrl:removeDeployWebhook ? null : (deployWebhookUrl.trim() || undefined),
        installCommand:installCommand.trim(),testCommand:testCommand.trim(),
        lintCommand:lintCommand.trim(),buildCommand:buildCommand.trim(),
      }),
    });
    if (!response.ok) { setDataError("Não foi possível salvar a configuração da aplicação."); return; }
    const result=await response.json();
    setApplicationList(current => current.map(item => item.id === configApp.id ? {
      ...item,deployConfigured:Boolean(result.deploy_configured),
      installCommand:String(result.install_command ?? ""),testCommand:String(result.test_command ?? ""),
      lintCommand:String(result.lint_command ?? ""),buildCommand:String(result.build_command ?? ""),
    } : item));
    setConfigApp(null); setDeployWebhookUrl(""); setRemoveDeployWebhook(false);
  }

  const codexProgressEvent=ticketDetails?.events.findLast(event=>event.kind==="codex.started");
  const codexTranscript=Array.isArray(codexProgressEvent?.metadata?.transcript)
    ? codexProgressEvent.metadata.transcript as CodexTranscriptItem[] : [];
  const codexPrompt=typeof codexProgressEvent?.metadata?.prompt==="string" ? codexProgressEvent.metadata.prompt : "";
  const pendingApproval=ticketDetails?.approvals.find(approval=>approval.decision===null);

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><i>L</i><div><strong>LionBan</strong><span>Autonomous fixes</span></div></div>
      <nav>
        <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ <span>Quadro</span></button>
        <button className={view === "apps" ? "active" : ""} onClick={() => setView("apps")}>⌘ <span>Aplicações</span><b>{applicationList.length}</b></button>
      </nav>
      <div className={`agent ${agentHealth.workerOnline && agentHealth.codexAuthenticated ? "online" : "offline"}`}><strong><i /> {agentHealth.workerOnline ? (agentHealth.codexAuthenticated ? "Codex conectado" : "Codex sem autenticação") : "Worker desconectado"}</strong><p>{agentHealth.message}</p>{agentHealth.lastSeen && <small>Último sinal: {new Date(agentHealth.lastSeen).toLocaleTimeString("pt-BR")}</small>}</div>
      <div className="user"><i>ES</i><div><strong>Elder</strong><span>Administrador</span></div><b>•••</b></div>
    </aside>

    <section className="content">
      <header>
        <div><p>{view === "board" ? "CENTRO DE CORREÇÕES" : "REPOSITÓRIOS AUTORIZADOS"}</p><h1>{view === "board" ? "Quadro de chamados" : "Aplicações"}</h1></div>
        <div className="actions"><label>⌕ <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar chamado..." /></label><button className="primary" onClick={openNewTicket}>＋ Novo chamado</button></div>
      </header>

      {view === "board" ? <>
        <div className="stats">
          <div><span>Em andamento</span><strong>{tickets.filter(t => ["Analisando","Corrigindo","Testando"].includes(t.status)).length}</strong><small>execuções ativas</small></div>
          <div><span>Aguardando você</span><strong>{tickets.filter(t => t.status === "Aguardando aprovação").length}</strong><small>aprovações pendentes</small></div>
          <div><span>Concluídos</span><strong>{tickets.filter(t => t.status === "Concluído").length}</strong><small>no histórico</small></div>
          <div><span>Executor</span><strong className={agentHealth.workerOnline && agentHealth.codexAuthenticated ? "ok" : "warning"}>{agentHealth.workerOnline ? (agentHealth.codexAuthenticated ? "Operacional" : "Sem login") : "Offline"}</strong><small>{agentHealth.message}</small></div>
        </div>
        {dataError && <div className="import-error">{dataError}</div>}
        {loadingData ? <div className="loading-board">Carregando seus chamados…</div> : <div className="board">{statuses.map(status => <section className={`column ${draggedTicket !== null ? "drop-enabled" : ""}`} key={status} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedTicket !== null) moveTicket(draggedTicket, status); setDraggedTicket(null); }}>
          <header><i className={`status s${statuses.indexOf(status)}`} /><strong>{status}</strong><b>{visible.filter(t => t.status === status).length}</b></header>
          {visible.filter(t => t.status === status).map(t => <button className={`ticket ${draggedTicket === t.id ? "dragging" : ""}`} draggable key={t.id} onDragStart={event => { event.dataTransfer.effectAllowed = "move"; setDraggedTicket(t.id); }} onDragEnd={() => setDraggedTicket(null)} onClick={() => openTicket(t)}>
            <div className="ticket-top"><span className={`p-${t.priority}`}>{t.priority}</span><b className="queue-priority">Fila {t.queuePriority}</b><small>#{t.id}</small></div>
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
        <footer><span>{tickets.filter(t => t.appId === a.id).length} chamados</span><button onClick={() => {
          setConfigApp(a); setDeployWebhookUrl(""); setRemoveDeployWebhook(false);
          setInstallCommand(a.installCommand); setTestCommand(a.testCommand);
          setLintCommand(a.lintCommand); setBuildCommand(a.buildCommand);
        }}>Configurar →</button></footer>
      </article>)}<button className="add" onClick={openImport}><b>＋</b><strong>Importar repositório</strong><small>Conectar outra aplicação do GitHub</small></button></div>}
    </section>

    {modal && <div className="overlay" onMouseDown={() => setModal(false)}><form className="modal" onSubmit={submit} onPaste={pasteImages} onMouseDown={e => e.stopPropagation()}>
      <header><div><p>{duplicating?"DUPLICAR CHAMADO":"NOVO CHAMADO"}</p><h2>{duplicating?"Revise e edite a cópia":"O que precisa ser corrigido?"}</h2></div><button type="button" onClick={() => setModal(false)}>×</button></header>
      <label>Aplicação <b>*</b><small>O repositório ficará bloqueado após criar.</small></label>
      <div className="picker"><label>⌕ <input value={repoQuery} onChange={e => setRepoQuery(e.target.value)} placeholder="Buscar aplicação ou repositório..." /></label>
        {applicationList.filter(a => `${a.name} ${a.repo}`.toLowerCase().includes(repoQuery.toLowerCase())).map(a => <button type="button" className={appId === a.id ? "chosen" : ""} onClick={() => chooseApplication(a.id)} key={a.id}><i style={{ background: a.color }}>{a.name[0]}</i><div><strong>{a.name}</strong><small>{a.repo}</small></div><em>{a.language}</em><b>{appId === a.id ? "✓" : ""}</b></button>)}
      </div>
      <label>Título <b>*</b><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Login falha depois de redefinir a senha" /></label>
      <label>Descrição do bug <b>*</b><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Explique o comportamento atual, o esperado e como reproduzir..." /></label>
      <div className="row ticket-fields"><label>Criticidade<select value={priority} onChange={e => setPriority(e.target.value as Ticket["priority"])}><option>Baixa</option><option>Média</option><option>Alta</option><option>Crítica</option></select></label><label>Ordem da fila<select value={queuePriority} onChange={e=>setQueuePriority(Number(e.target.value))}>{Array.from({length:10},(_,index)=>index+1).map(value=><option key={value} value={value}>{value} — {value===1?"primeiro":value===10?"último":"prioridade da fila"}</option>)}</select></label><div className="drop" role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }} onDragOver={e => e.preventDefault()} onDrop={dropImages}>⌁ <span>Logs e imagens<small>Clique, arraste ou cole com Ctrl+V</small></span><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={e => addImages(Array.from(e.target.files ?? []))} /></div></div>
      <fieldset className="automation-options"><legend>Automação após corrigir e testar</legend>
        <label><input type="checkbox" checked={autoCommit} onChange={e => { setAutoCommit(e.target.checked); if (!e.target.checked) { setAutoPush(false); setAutoPullRequest(false); setAutoDeploy(false); } }} /><span><strong>Commit automático</strong><small>Criar um commit com a correção</small></span></label>
        <label><input type="checkbox" checked={autoPush} onChange={e => { setAutoPush(e.target.checked); if (e.target.checked) setAutoCommit(true); else { setAutoPullRequest(false); setAutoDeploy(false); } }} /><span><strong>Push automático</strong><small>Enviar a branch lionban/chamado-ID</small></span></label>
        <label><input type="checkbox" checked={autoPullRequest} onChange={e => { setAutoPullRequest(e.target.checked); if (e.target.checked) { setAutoCommit(true); setAutoPush(true); setAutoDeploy(false); } }} /><span><strong>Pull Request automático</strong><small>Criar PR em vez de integrar diretamente</small></span></label>
        <label className={!appId || !app(appId).deployConfigured || autoPullRequest ? "disabled" : ""}><input type="checkbox" checked={autoDeploy} disabled={!appId || !app(appId).deployConfigured || autoPullRequest} onChange={e => { setAutoDeploy(e.target.checked); if (e.target.checked) { setAutoCommit(true); setAutoPush(true); } }} /><span><strong>Deploy automático</strong><small>{appId && app(appId).deployConfigured ? (autoPullRequest ? "Disponível somente sem Pull Request" : "Disparar webhook do EasyPanel após integrar") : "Configure o webhook na aplicação"}</small></span></label>
        <label className={!appId || autoPullRequest ? "disabled" : ""}><input type="checkbox" checked={createTag} disabled={!appId || autoPullRequest} onChange={e => { setCreateTag(e.target.checked); if (e.target.checked) { setAutoCommit(true); setAutoPush(true); } }} /><span><strong>Criar tag e ativar Action</strong><small>{autoPullRequest?"Disponível após integração, sem Pull Request":repoTags.length?`${repoTags.length} tag(s) encontrada(s)`:"Nenhuma tag encontrada; iniciar em v1.0.0"}</small></span></label>
      </fieldset>
      {createTag && <div className="tag-options"><label>Nova versão<input value={releaseTag} onChange={e=>setReleaseTag(e.target.value)} placeholder="v1.0.0" />{repoTags.some(tag=>tag.name===releaseTag)&&<small className="tag-error">Essa tag já existe. Altere o número da versão.</small>}</label><div><strong>Tags anteriores</strong><p>{repoTags.length?repoTags.slice(0,8).map(tag=><button type="button" key={tag.name} onClick={()=>setReleaseTag(tag.name)} title="Usar como base e editar">{tag.name}</button>):<small>Nenhuma tag neste repositório.</small>}</p></div></div>}
      {attachments.length > 0 && <div className="attachment-list">{attachments.map((item,index) => <div className="attachment" key={`${item.file.name}-${index}`}><Image src={item.preview} alt={`Prévia de ${item.file.name}`} width={42} height={42} unoptimized /><span><strong>{item.file.name}</strong><small>{Math.ceil(item.file.size/1024)} KB</small></span><button type="button" onClick={() => removeImage(index)} aria-label={`Remover ${item.file.name}`}>×</button></div>)}</div>}
      <footer><button type="button" className="secondary" onClick={() => setModal(false)}>Cancelar</button><button className="primary" disabled={!appId || !title || !description || (createTag && (!releaseTag || repoTags.some(tag=>tag.name===releaseTag)))}>Criar e enviar ao Codex →</button></footer>
    </form></div>}

    {configApp && <div className="overlay" onMouseDown={() => setConfigApp(null)}><form className="modal config-modal" onSubmit={saveApplicationConfig} onMouseDown={e => e.stopPropagation()}>
      <header><div><p>CONFIGURAR APLICAÇÃO</p><h2>{configApp.name}</h2></div><button type="button" onClick={() => setConfigApp(null)}>×</button></header>
      <p className="config-help">Configure como o worker prepara e valida este repositório. Use os mesmos comandos que você executaria localmente.</p>
      <div className="command-grid">
        <label>Comando de instalação<input value={installCommand} onChange={e=>setInstallCommand(e.target.value)} placeholder="npm ci" /></label>
        <label>Comando de teste<input value={testCommand} onChange={e=>setTestCommand(e.target.value)} placeholder="npm test" /></label>
        <label>Comando de lint<input value={lintCommand} onChange={e=>setLintCommand(e.target.value)} placeholder="npm run lint" /></label>
        <label>Comando de build<input value={buildCommand} onChange={e=>setBuildCommand(e.target.value)} placeholder="npm run build" /></label>
      </div>
      <label>Webhook de deploy HTTPS<input type="url" value={deployWebhookUrl} disabled={removeDeployWebhook} onChange={e => setDeployWebhookUrl(e.target.value)} placeholder={removeDeployWebhook ? "O webhook será removido ao salvar" : configApp.deployConfigured ? "Já configurado — cole outro para substituir" : "https://..."} /></label>
      <footer><button type="button" className="secondary" onClick={() => setConfigApp(null)}>Cancelar</button>{configApp.deployConfigured && <button type="button" className="danger" onClick={() => setRemoveDeployWebhook(value=>!value)}>{removeDeployWebhook?"Manter webhook":"Remover webhook"}</button>}<button className="primary">Salvar</button></footer>
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

    {detail && <div className="overlay ticket-overlay" onMouseDown={() => setDetail(null)}><aside className="detail wide" onMouseDown={e => e.stopPropagation()}>
      <header><div><p>CHAMADO #{detail.id}</p><h2>{detail.title}</h2></div><button onClick={() => setDetail(null)}>×</button></header>
      <div className="locked"><i style={{background:app(detail.appId).color}}>{app(detail.appId).name[0]}</i><div><strong>{app(detail.appId).name}</strong><small>{app(detail.appId).repo} · {app(detail.appId).branch}</small></div><b>Repositório bloqueado</b></div>
      <section className="ticket-description"><h4>DESCRIÇÃO COMPLETA</h4><p>{detail.description}</p></section><h4>ATIVIDADE DO AGENTE</h4>
      {!ticketDetails && <div className="detail-loading">Carregando atividade…</div>}
      {ticketDetails && <div className="timeline">{ticketDetails.events.map((event,index)=><div className={event.kind.includes("failed")?"failed":index===ticketDetails.events.length-1?"running":"done"} key={event.id}><i>{event.kind.includes("failed")?"!":index+1}</i><span><strong>{eventLabels[event.kind]??event.kind}</strong><small>{event.message} · {new Date(event.created_at).toLocaleString("pt-BR")}</small></span></div>)}</div>}
      {pendingApproval && <section className="approval-panel"><h4>APROVAÇÃO NECESSÁRIA</h4><strong>{pendingApproval.reason}</strong><p>{pendingApproval.patch_available?"A correção foi preservada. Ao aprovar, o worker criará um clone limpo, restaurará o patch e continuará somente com as automações escolhidas no chamado.":"Esta execução não possui patch preservado. Se for um chamado antigo, duplique-o para executar novamente. Se houver Pull Request, a autorização deve ser feita no GitHub."}</p><div><button className="approve-ticket" disabled={!pendingApproval.patch_available} onClick={()=>decideApproval("approved")}>Aprovar correção</button><button className="danger" onClick={()=>decideApproval("rejected")}>Rejeitar correção</button></div></section>}
      {codexProgressEvent && <section className="codex-conversation"><div className="conversation-title"><h4>ATIVIDADE PÚBLICA DO CODEX</h4><span>Atualização automática</span></div>{codexTranscript.length>0?codexTranscript.map((item,index)=><article className={item.type} key={`${item.at}-${index}`}><small>{new Date(item.at).toLocaleTimeString("pt-BR")}</small><p>{item.text}</p></article>):<p className="conversation-empty">O Codex ainda não emitiu uma atualização detalhada.</p>}{codexPrompt&&<details><summary>Ver prompt enviado ao Codex</summary><pre>{codexPrompt}</pre></details>}<small className="conversation-note">Mostra mensagens e ações públicas. O raciocínio interno privado do modelo não é disponibilizado.</small></section>}
      {showLogs && ticketDetails && <section className="full-logs"><h4>DETALHES TÉCNICOS</h4>{ticketDetails.executions.map(execution=><article key={execution.id}><strong>Tentativa {execution.attempt} · {execution.state}</strong><small>{execution.started_at?`Iniciada em ${new Date(execution.started_at).toLocaleString("pt-BR")}`:"Não iniciada"}</small>{execution.error_message&&<pre>{execution.error_message}</pre>}</article>)}{ticketDetails.events.map(event=><article key={`log-${event.id}`}><strong>{eventLabels[event.kind]??event.kind}</strong><small>{event.message}</small>{Object.keys(event.metadata??{}).length>0&&<details><summary>Ver dados técnicos</summary><pre>{JSON.stringify(event.metadata,null,2)}</pre></details>}</article>)}</section>}
      <footer className="ticket-actions"><div><button className="danger" onClick={cancelExecution} disabled={["Concluído","Falhou","Aguardando aprovação"].includes(detail.status)}>Cancelar execução</button><button className="delete-ticket" onClick={deleteTicket}>Excluir cartão</button></div><div><button className="secondary" onClick={cloneTicket}>Duplicar sem logs</button><button className="secondary" onClick={()=>setShowLogs(value=>!value)}>{showLogs?"Ocultar logs":"Ver logs completos"}</button></div></footer>
    </aside></div>}
  </main>;
}
