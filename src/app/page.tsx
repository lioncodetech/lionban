"use client";

import { ClipboardEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AttachmentList, type Attachment } from "./attachment-list";
import { attachmentName } from "./attachment-names";

type Status = "Aberto" | "Analisando" | "Corrigindo" | "Testando" | "Aguardando aprovação" | "Concluído" | "Falhou";
type App = {
  id:string; name:string; repo:string; language:string; branch:string; color:string; deployConfigured:boolean;
  deployVerificationConfigured:boolean; deployTimeoutMinutes:number;
  installCommand:string; testCommand:string; lintCommand:string; buildCommand:string; testEnvironmentKeys:string[]; testDatabaseSchema:string;
  projectContext:string; technicalHistory:string;
};
type Ticket = { id:number; appId:string; title:string; description:string; priority:"Baixa"|"Média"|"Alta"|"Crítica"; queuePriority:number; ticketKind:"fix"|"deploy"; scheduledAt:string|null; status:Status; age:string; deployStatus:string };
type GitHubRepo = { id: number; name: string; full_name: string; default_branch: string; language: string | null; clone_url: string };
type StoredAttachment = { name:string; mimeType:string; size:number; data:string };
type PreviewImage = { name:string; src:string };
type AgentHealth = { workerOnline:boolean; codexAuthenticated:boolean; queuePaused:boolean; lastSeen:string|null; message:string };
type TicketEvent = { id:number; kind:string; message:string; metadata:Record<string,unknown>; created_at:string };
type TicketExecution = { id:string; state:string; attempt:number; started_at:string|null; finished_at:string|null; error_message:string|null };
type TicketApproval = { id:string; reason:string; decision:string|null; decided_at:string|null; created_at:string; patch_available:boolean };
type TicketDetails = {
  events:TicketEvent[]; executions:TicketExecution[]; approvals:TicketApproval[];
  ticket_kind:"fix"|"deploy"; scheduled_at:string|null;
  ai_model:string|null;
  auto_commit:boolean; auto_push:boolean; auto_pull_request:boolean; auto_deploy:boolean;
  create_tag:boolean; release_tag:string|null;
  deploy_status:string; deploy_updated_at:string|null;
};
type RepoTag = { name:string; commit:{sha:string} };
type RepoAction = { id:number; name:string; display_title:string; status:string; conclusion:string|null; html_url:string; created_at:string };
type CodexTranscriptItem = { at:string; type:string; text:string };

const statuses: Status[] = ["Aberto", "Analisando", "Corrigindo", "Testando", "Aguardando aprovação", "Concluído", "Falhou"];
const codexModels=[
  {value:"",label:"Padrão da conta Codex"},
  {value:"gpt-5.6-sol",label:"GPT-5.6 Sol — mais detalhado"},
  {value:"gpt-5.6-terra",label:"GPT-5.6 Terra — uso geral"},
  {value:"gpt-5.6-luna",label:"GPT-5.6 Luna — tarefas objetivas"},
  {value:"gpt-5.6",label:"GPT-5.6 — seleção padrão da versão"},
] as const;
const statusFromApi: Record<string, Status> = { open:"Aberto", analyzing:"Analisando", fixing:"Corrigindo", testing:"Testando", approval:"Aguardando aprovação", completed:"Concluído", failed:"Falhou", cancelled:"Falhou" };
const priorityFromApi: Record<string, Ticket["priority"]> = { low:"Baixa", medium:"Média", high:"Alta", critical:"Crítica" };
const priorityToApi: Record<Ticket["priority"], string> = { Baixa:"low", Média:"medium", Alta:"high", Crítica:"critical" };
const statusToApi: Record<Status, string> = { Aberto:"open", Analisando:"analyzing", Corrigindo:"fixing", Testando:"testing", "Aguardando aprovação":"approval", Concluído:"completed", Falhou:"failed" };
const eventLabels:Record<string,string> = {
  "ticket.created":"Chamado criado", "ticket.moved":"Chamado movimentado", "repository.cloned":"Repositório preparado",
  "ticket.edited":"Chamado atualizado",
  "repository.validating":"Validando repositório", "repository.cloning":"Clonando repositório",
  "repository.validated":"Repositório validado", "codex.started":"Codex trabalhando",
  "execution.recovered":"Execução recuperada", "execution.retried":"Nova tentativa iniciada", "execution.failed":"Execução falhou",
  "execution.cancelled":"Execução cancelada", "execution.cancel_requested":"Cancelamento solicitado", "commit.created":"Commit criado",
  "branch.pushed":"Branch enviada", "pull_request.created":"Pull Request criado", "merge.completed":"Correção integrada",
  "merge.prepared":"Integração preparada", "merge.pushed":"Integração publicada",
  "tag.created":"Versão criada", "deploy.started":"Deploy iniciado", "deploy.triggered":"Solicitação de deploy aceita", "deploy.completed":"Deploy concluído", "patch.prepared":"Correção preparada",
  "deploy.failed":"Falha ao confirmar deploy", "deploy.verification_required":"Verificação automática não configurada",
  "dependencies.installing":"Instalando dependências", "dependencies.installed":"Dependências instaladas",
  "documentation.started":"Documentando a correção", "documentation.updated":"Documentação atualizada",
  "context.history_updated":"Histórico técnico atualizado",
  "context.synchronized":"Contexto permanente sincronizado", "context.sync_skipped":"Sincronização do contexto ignorada",
  "approval.requested":"Aprovação solicitada", "approval.approved":"Correção aprovada",
  "approval.rejected":"Correção rejeitada", "approval.restored":"Patch aprovado restaurado",
  "approval.completed":"Aprovação concluída",
  "version.updated":"Versão sincronizada com a tag", "version.skipped":"Sincronização de versão ignorada",
  "validation.baseline_passed":"Validação inicial aprovada", "validation.baseline_failed":"Falha preexistente identificada",
  "validation.passed":"Validação final aprovada", "validation.preexisting":"Falha preexistente confirmada",
  "deploy.only":"Deploy exclusivo iniciado", "deploy.only_completed":"Deploy exclusivo concluído",
};
const ticketDetailsFromApi=(result:Record<string,unknown>):TicketDetails => ({
  events:(result.events as TicketEvent[] | undefined) ?? [],
  executions:(result.executions as TicketExecution[] | undefined) ?? [],
  approvals:(result.approvals as TicketApproval[] | undefined) ?? [],
  ticket_kind:result.ticket_kind==="deploy"?"deploy":"fix",scheduled_at:result.scheduled_at?String(result.scheduled_at):null,
  ai_model:result.ai_model ? String(result.ai_model) : null,
  auto_commit:Boolean(result.auto_commit),auto_push:Boolean(result.auto_push),
  auto_pull_request:Boolean(result.auto_pull_request),auto_deploy:Boolean(result.auto_deploy),
  create_tag:Boolean(result.create_tag),release_tag:result.release_tag ? String(result.release_tag) : null,
  deploy_status:String(result.deploy_status ?? "not_requested"),deploy_updated_at:result.deploy_updated_at ? String(result.deploy_updated_at) : null,
});
const toLocalDateTimeInput=(value:string|null) => {
  if (!value) return "";
  const date=new Date(value);
  return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);
};

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [applicationList, setApplicationList] = useState<App[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState("");
  const [view, setView] = useState<"board" | "apps" | "archive" | "settings">("board");
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [query, setQuery] = useState("");
  const [repoQuery, setRepoQuery] = useState("");
  const [appId, setAppId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Ticket["priority"]>("Média");
  const [queuePriority, setQueuePriority] = useState(5);
  const [ticketKind,setTicketKind]=useState<"fix"|"deploy">("fix");
  const [scheduledAt,setScheduledAt]=useState("");
  const [aiModel,setAiModel]=useState("");
  const [importModal, setImportModal] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubQuery, setGithubQuery] = useState("");
  const [importing, setImporting] = useState<number | null>(null);
  const [importError, setImportError] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draggedTicket, setDraggedTicket] = useState<number | null>(null);
  const [agentHealth, setAgentHealth] = useState<AgentHealth>({ workerOnline:false,codexAuthenticated:false,queuePaused:false,lastSeen:null,message:"Verificando o executor…" });
  const [autoCommit, setAutoCommit] = useState(true);
  const [autoPush, setAutoPush] = useState(true);
  const [autoPullRequest, setAutoPullRequest] = useState(false);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [configApp, setConfigApp] = useState<App | null>(null);
  const [deployWebhookUrl, setDeployWebhookUrl] = useState("");
  const [deployVerificationUrl,setDeployVerificationUrl]=useState("");
  const [deployTimeoutMinutes,setDeployTimeoutMinutes]=useState(20);
  const [removeDeployWebhook, setRemoveDeployWebhook] = useState(false);
  const [installCommand, setInstallCommand] = useState("");
  const [testCommand, setTestCommand] = useState("");
  const [lintCommand, setLintCommand] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [testEnvironmentText,setTestEnvironmentText]=useState("");
  const [configSaving,setConfigSaving]=useState(false);
  const [configMessage,setConfigMessage]=useState("");
  const [archiveAfterDays,setArchiveAfterDays]=useState(7);
  const [deleteAfterDays,setDeleteAfterDays]=useState(15);
  const [ticketDetails, setTicketDetails] = useState<TicketDetails | null>(null);
  const [ticketDetailsError,setTicketDetailsError]=useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [repoTags, setRepoTags] = useState<RepoTag[]>([]);
  const [repoActions, setRepoActions] = useState<RepoAction[]>([]);
  const [createTag, setCreateTag] = useState(false);
  const [releaseTag, setReleaseTag] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [editingTicketId,setEditingTicketId]=useState<number|null>(null);
  const [ticketImages,setTicketImages]=useState<StoredAttachment[]>([]);
  const [previewImage,setPreviewImage]=useState<PreviewImage|null>(null);
  const [submittingTicket,setSubmittingTicket]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const app = (id: string) => applicationList.find(a => a.id === id) ?? {
    id,name:"Aplicação indisponível",repo:"Repositório removido",language:"—",branch:"—",color:"#829087",
    deployConfigured:false,deployVerificationConfigured:false,deployTimeoutMinutes:20,installCommand:"",testCommand:"",lintCommand:"",buildCommand:"",testEnvironmentKeys:[],testDatabaseSchema:"",projectContext:"",technicalHistory:"",
  };
  const projectContextUrl=(application:App,action:"blob"|"edit"|"new")=>{
    const [owner,repository]=application.repo.split("/").map(encodeURIComponent);
    const branch=encodeURIComponent(application.branch);
    if (action==="new") return `https://github.com/${owner}/${repository}/new/${branch}?filename=docs%2FPROJECT_CONTEXT.md`;
    return `https://github.com/${owner}/${repository}/${action}/${branch}/docs/PROJECT_CONTEXT.md`;
  };
  const visible = tickets.filter(t => `${t.title} ${app(t.appId).name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    let active=true;
    let initialLoad=true;
    let refreshing=false;
    async function loadData() {
      if (refreshing || document.hidden) return;
      refreshing=true;
      try {
        const [appsResponse, ticketsResponse] = await Promise.all([
          fetch("/api/applications",{cache:"no-store"}),
          fetch(view==="archive"?"/api/tickets?archived=true":"/api/tickets",{cache:"no-store"}),
        ]);
        if (!appsResponse.ok || !ticketsResponse.ok) throw new Error("Falha ao carregar os dados");
        const [appRows, ticketRows] = await Promise.all([appsResponse.json(), ticketsResponse.json()]);
        if (!active) return;
        setApplicationList(appRows.map((row: Record<string, unknown>) => ({
          id:String(row.id), name:String(row.name), repo:String(row.full_name),
          language:String(row.language ?? "Não detectada"), branch:String(row.default_branch), color:"#236b50", deployConfigured:Boolean(row.deploy_configured),
          deployVerificationConfigured:Boolean(row.deploy_verification_configured),deployTimeoutMinutes:Number(row.deploy_timeout_minutes ?? 20),
          installCommand:String(row.install_command ?? ""),testCommand:String(row.test_command ?? ""),
          lintCommand:String(row.lint_command ?? ""),buildCommand:String(row.build_command ?? ""),
          testEnvironmentKeys:Array.isArray(row.test_environment_keys)?row.test_environment_keys.map(String):[],
          testDatabaseSchema:String(row.test_database_schema ?? ""),
          projectContext:String(row.project_context ?? ""),technicalHistory:String(row.technical_history ?? ""),
        })));
        setTickets(ticketRows.map((row: Record<string, unknown>) => ({
          id:Number(row.id), appId:String(row.application_id), title:String(row.title), description:String(row.description),
          priority:priorityFromApi[String(row.priority)] ?? "Média",queuePriority:Number(row.queue_priority ?? 5),status:statusFromApi[String(row.status)] ?? "Falhou",
          ticketKind:row.ticket_kind==="deploy"?"deploy":"fix",scheduledAt:row.scheduled_at?String(row.scheduled_at):null,
          age:new Date(String(row.created_at)).toLocaleDateString("pt-BR"),deployStatus:String(row.deploy_status ?? "not_requested"),
        })));
        setDataError("");
      } catch {
        if (active && initialLoad) setDataError("Não foi possível carregar os dados do PostgreSQL.");
      } finally {
        if (active && initialLoad) setLoadingData(false);
        initialLoad=false;
        refreshing=false;
      }
    }
    loadData();
    const timer=window.setInterval(loadData,10000);
    return ()=>{ active=false; window.clearInterval(timer); };
  }, [view]);

  useEffect(()=>{
    if (view!=="settings") return;
    fetch("/api/settings",{cache:"no-store"}).then(response=>response.json()).then(result=>{
      setArchiveAfterDays(Number(result.archive_after_days ?? 7));
      setDeleteAfterDays(Number(result.delete_after_days ?? 15));
    }).catch(()=>setDataError("Não foi possível carregar as configurações."));
  },[view]);

  useEffect(() => {
    if (!detail) return;
    const ticketId=detail.id;
    const timer=window.setInterval(async ()=>{
      if (document.hidden) return;
      const response=await fetch(`/api/tickets/${ticketId}`,{cache:"no-store"});
      if (response.ok) {
        const result=await response.json();
        setTicketDetails(ticketDetailsFromApi(result));
        setTicketDetailsError("");
      } else {
        setTicketDetailsError("Não foi possível atualizar a atividade do chamado.");
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
        if (active) setAgentHealth({ workerOnline:false,codexAuthenticated:false,queuePaused:false,lastSeen:null,message:"Não foi possível consultar o executor." });
      }
    }
    loadHealth();
    const timer = window.setInterval(loadHealth, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function toggleQueuePause() {
    const paused=!agentHealth.queuePaused;
    const response=await fetch("/api/health",{
      method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({paused}),
    });
    const result=await response.json().catch(()=>({}));
    if (!response.ok) { setDataError(result.error??"Não foi possível alterar a pausa da fila."); return; }
    setAgentHealth(current=>({
      ...current,queuePaused:Boolean(result.queuePaused),
      message:result.queuePaused
        ? "Fila pausada. A execução atual pode terminar; novos chamados não serão iniciados."
        : "Executor pronto para receber chamados.",
    }));
  }

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
      setTicketDetailsError("");
    } else {
      const result=await response.json().catch(()=>({}));
      setTicketDetailsError(result.error??"Não foi possível carregar a atividade do chamado.");
    }
  }
  async function openTicket(ticket:Ticket) {
    setDetail(ticket); setTicketDetails(null); setTicketImages([]); setTicketDetailsError(""); setShowLogs(false);
    const [detailsResponse,imagesResponse]=await Promise.all([
      fetch(`/api/tickets/${ticket.id}`,{cache:"no-store"}),
      fetch(`/api/tickets/${ticket.id}/attachments`,{cache:"no-store"}),
    ]);
    if (detailsResponse.ok) setTicketDetails(ticketDetailsFromApi(await detailsResponse.json()));
    else setTicketDetailsError("Não foi possível carregar a atividade do chamado.");
    if (imagesResponse.ok) setTicketImages(await imagesResponse.json());
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
    setAttachments([]); setDataError("");
    setAppId(detail.appId); setTitle(`${detail.title} (cópia)`); setDescription(detail.description); setPriority(detail.priority); setQueuePriority(detail.queuePriority);
    setTicketKind(ticketDetails?.ticket_kind ?? detail.ticketKind); setScheduledAt("");
    setAiModel(ticketDetails?.ai_model ?? "");
    setAutoCommit(ticketDetails?.auto_commit ?? true); setAutoPush(ticketDetails?.auto_push ?? true);
    setAutoPullRequest(ticketDetails?.auto_pull_request ?? false); setAutoDeploy(ticketDetails?.auto_deploy ?? false);
    setCreateTag(ticketDetails?.create_tag ?? false); setReleaseTag(ticketDetails?.release_tag ?? "");
    setRepoQuery(""); setRepoTags([]); setRepoActions([]); setDataError(""); setDuplicating(true); setEditingTicketId(null);
    setSubmitError(""); setSubmittingTicket(false);
    const [tagsResponse,actionsResponse,attachmentsResponse]=await Promise.all([
      fetch(`/api/applications/${detail.appId}/tags`,{cache:"no-store"}),
      fetch(`/api/applications/${detail.appId}/actions`,{cache:"no-store"}),
      fetch(`/api/tickets/${detail.id}/attachments`,{cache:"no-store"}),
    ]);
    if (tagsResponse.ok) setRepoTags(await tagsResponse.json());
    if (actionsResponse.ok) setRepoActions(await actionsResponse.json());
    if (attachmentsResponse.ok) {
      const stored=await attachmentsResponse.json() as StoredAttachment[];
      setAttachments(stored.map((item,index)=>{
        const binary=atob(item.data);
        const bytes=new Uint8Array(binary.length);
        for (let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
        const file=new File([bytes],attachmentName(item.name,index),{type:item.mimeType});
        return {file,preview:URL.createObjectURL(file)};
      }));
    } else {
      setSubmitError("A cópia foi aberta, mas não foi possível recuperar as imagens do chamado original.");
    }
    setDetail(null); setModal(true);
  }

  async function editTicket() {
    if (!detail || detail.status!=="Aberto") return;
    attachments.forEach(item=>URL.revokeObjectURL(item.preview));
    setAttachments([]); setAppId(detail.appId); setTitle(detail.title); setDescription(detail.description);
    setPriority(detail.priority); setQueuePriority(detail.queuePriority);
    setTicketKind(ticketDetails?.ticket_kind ?? detail.ticketKind); setScheduledAt(toLocalDateTimeInput(ticketDetails?.scheduled_at ?? detail.scheduledAt));
    setAiModel(ticketDetails?.ai_model ?? "");
    setAutoCommit(ticketDetails?.auto_commit ?? true); setAutoPush(ticketDetails?.auto_push ?? true);
    setAutoPullRequest(ticketDetails?.auto_pull_request ?? false); setAutoDeploy(ticketDetails?.auto_deploy ?? false);
    setCreateTag(ticketDetails?.create_tag ?? false); setReleaseTag(ticketDetails?.release_tag ?? "");
    setRepoQuery(""); setRepoTags([]); setRepoActions([]); setDuplicating(false); setEditingTicketId(detail.id);
    setSubmitError(""); setSubmittingTicket(false);
    const [tagsResponse,actionsResponse,imagesResponse]=await Promise.all([
      fetch(`/api/applications/${detail.appId}/tags`,{cache:"no-store"}),
      fetch(`/api/applications/${detail.appId}/actions`,{cache:"no-store"}),
      fetch(`/api/tickets/${detail.id}/attachments`,{cache:"no-store"}),
    ]);
    if (tagsResponse.ok) setRepoTags(await tagsResponse.json());
    if (actionsResponse.ok) setRepoActions(await actionsResponse.json());
    if (imagesResponse.ok) {
      const stored=await imagesResponse.json() as StoredAttachment[];
      setAttachments(stored.map((item,index)=>{
        const binary=atob(item.data); const bytes=new Uint8Array(binary.length);
        for (let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
        const file=new File([bytes],attachmentName(item.name,index),{type:item.mimeType});
        return {file,preview:URL.createObjectURL(file)};
      }));
    }
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
    setAppId(id); setRepoTags([]); setRepoActions([]); setCreateTag(false); setReleaseTag("");
    const [tagsResponse,actionsResponse]=await Promise.all([
      fetch(`/api/applications/${id}/tags`,{cache:"no-store"}),
      fetch(`/api/applications/${id}/actions`,{cache:"no-store"}),
    ]);
    if (tagsResponse.ok) { const tags=await tagsResponse.json(); setRepoTags(tags); setReleaseTag(suggestNextTag(tags)); }
    if (actionsResponse.ok) setRepoActions(await actionsResponse.json());
  }

  function openNewTicket() {
    attachments.forEach(item=>URL.revokeObjectURL(item.preview));
    setAttachments([]); setAppId(""); setTitle(""); setDescription(""); setPriority("Média"); setQueuePriority(5);
    setTicketKind("fix"); setScheduledAt(""); setAiModel(""); setAutoCommit(true); setAutoPush(true); setAutoPullRequest(false); setAutoDeploy(false);
    setCreateTag(false); setReleaseTag(""); setRepoTags([]); setRepoActions([]); setRepoQuery(""); setDuplicating(false); setEditingTicketId(null); setDataError("");
    setSubmitError(""); setSubmittingTicket(false); setModal(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitError("");
    if (appId && ticketKind==="deploy" && !app(appId).deployConfigured) return setSubmitError("Configure o webhook de deploy desta aplicaÃ§Ã£o antes de criar o chamado.");
    if (!appId) return setSubmitError("Escolha uma aplicação.");
    if (title.trim().length<3) return setSubmitError("O título precisa ter pelo menos 3 caracteres.");
    if (description.trim().length<10) return setSubmitError("A descrição precisa ter pelo menos 10 caracteres.");
    setSubmittingTicket(true);
    try {
      const encodedAttachments = await Promise.all(attachments.map(async ({ file }, index) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
      });
      return { name:attachmentName(file.name, index), mimeType:file.type, size:file.size, data:dataUrl.split(",")[1] };
      }));
      const response = await fetch(editingTicketId?`/api/tickets/${editingTicketId}`:"/api/tickets", {
      method:editingTicketId?"PATCH":"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({ edit:Boolean(editingTicketId),applicationId:appId,title,description,priority:priorityToApi[priority],queuePriority,ticketKind,scheduledAt:scheduledAt?new Date(scheduledAt).toISOString():null,aiModel:aiModel.trim()||null,attachments:ticketKind==="deploy"?[]:encodedAttachments,autoCommit,autoPush,autoPullRequest,autoDeploy,createTag,releaseTag:createTag?releaseTag:(editingTicketId?null:undefined) }),
      });
      const created = await response.json().catch(()=>({}));
      if (!response.ok) {
        setSubmitError(created.error??"Não foi possível criar o chamado.");
        return;
      }
      const savedTicket={ id:Number(created.id),appId:String(created.application_id),title:String(created.title),description:String(created.description),priority,queuePriority,ticketKind:created.ticket_kind==="deploy"?"deploy" as const:"fix" as const,scheduledAt:created.scheduled_at?String(created.scheduled_at):null,status:"Aberto" as Status,age:editingTicketId?(tickets.find(item=>item.id===editingTicketId)?.age??"agora"):"agora",deployStatus:String(created.deploy_status??"not_requested") };
      setTickets(current=>editingTicketId?current.map(item=>item.id===editingTicketId?savedTicket:item):[savedTicket,...current]);
      attachments.forEach(item => URL.revokeObjectURL(item.preview));
      setModal(false); setAppId(""); setTitle(""); setDescription(""); setPriority("Média"); setQueuePriority(5); setAttachments([]); setDuplicating(false); setEditingTicketId(null);
      setTicketKind("fix"); setScheduledAt(""); setAiModel(""); setAutoCommit(true); setAutoPush(true); setAutoPullRequest(false); setAutoDeploy(false);
      setCreateTag(false); setReleaseTag(""); setRepoTags([]); setRepoActions([]);
    } catch {
      setSubmitError("Falha de conexão ao enviar o chamado. Tente novamente.");
    } finally {
      setSubmittingTicket(false);
    }
  }

  function addImages(files: File[]) {
    const accepted = files.filter(file => ["image/png","image/jpeg","image/webp","image/gif"].includes(file.type) && file.size <= 5 * 1024 * 1024);
    if (accepted.length !== files.length) setDataError("Use imagens PNG, JPEG, WebP ou GIF de até 5 MB.");
    setAttachments(current => {
      const room = Math.max(0, 5 - current.length);
      const additions=accepted.slice(0, room).map((file,index) => {
        const numberedFile=new File([file],attachmentName(file.name,current.length+index),{type:file.type,lastModified:file.lastModified});
        return {file:numberedFile,preview:URL.createObjectURL(numberedFile)};
      });
      return [...current,...additions];
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
    setAttachments(current => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_,itemIndex)=>itemIndex!==index).map((item,itemIndex)=>{
        const name=attachmentName(item.file.name,itemIndex);
        if (item.file.name===name) return item;
        URL.revokeObjectURL(item.preview);
        const file=new File([item.file],name,{type:item.file.type,lastModified:item.file.lastModified});
        return {file,preview:URL.createObjectURL(file)};
      });
    });
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
      deployVerificationConfigured:Boolean(result.deploy_verification_configured),deployTimeoutMinutes:Number(result.deploy_timeout_minutes ?? 20),
      installCommand:String(result.install_command ?? ""),testCommand:String(result.test_command ?? ""),
      lintCommand:String(result.lint_command ?? ""),buildCommand:String(result.build_command ?? ""),
      testEnvironmentKeys:[],testDatabaseSchema:"",
      projectContext:String(result.project_context ?? ""),technicalHistory:String(result.technical_history ?? ""),
    };
    setApplicationList(current => [...current.filter(item => item.repo !== imported.repo), imported]);
    setImporting(null); setImportModal(false); setView("apps");
  }

  async function saveApplicationConfig(e:FormEvent) {
    e.preventDefault();
    if (!configApp) return;
    setConfigSaving(true); setConfigMessage("");
    const response=await fetch(`/api/applications/${configApp.id}`,{
      method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({
        deployWebhookUrl:removeDeployWebhook ? null : (deployWebhookUrl.trim() || undefined),
        deployVerificationUrl:deployVerificationUrl.trim() || undefined,
        deployTimeoutMinutes,
        installCommand:installCommand.trim(),testCommand:testCommand.trim(),
        lintCommand:lintCommand.trim(),buildCommand:buildCommand.trim(),
        projectContext:configApp.projectContext,
        testEnvironment:testEnvironmentText.trim()?Object.fromEntries(testEnvironmentText.split(/\r?\n/).filter(line=>line.includes("=")).map(line=>{
          const separator=line.indexOf("="); return [line.slice(0,separator).trim(),line.slice(separator+1)];
        })):undefined,
      }),
    });
    const result=await response.json().catch(()=>({}));
    if (!response.ok) {
      setConfigMessage(result.error??"Não foi possível salvar a configuração da aplicação.");
      setConfigSaving(false); return;
    }
    setApplicationList(current => current.map(item => item.id === configApp.id ? {
      ...item,deployConfigured:Boolean(result.deploy_configured),
      deployVerificationConfigured:Boolean(result.deploy_verification_configured),deployTimeoutMinutes:Number(result.deploy_timeout_minutes ?? 20),
      installCommand:String(result.install_command ?? ""),testCommand:String(result.test_command ?? ""),
      lintCommand:String(result.lint_command ?? ""),buildCommand:String(result.build_command ?? ""),
      testEnvironmentKeys:Array.isArray(result.test_environment_keys)?result.test_environment_keys.map(String):item.testEnvironmentKeys,
      testDatabaseSchema:String(result.test_database_schema ?? ""),
      projectContext:String(result.project_context ?? ""),technicalHistory:String(result.technical_history ?? ""),
    } : item));
    setConfigApp(current=>current?{
      ...current,deployConfigured:Boolean(result.deploy_configured),
      deployVerificationConfigured:Boolean(result.deploy_verification_configured),deployTimeoutMinutes:Number(result.deploy_timeout_minutes ?? 20),
      testEnvironmentKeys:Array.isArray(result.test_environment_keys)?result.test_environment_keys.map(String):current.testEnvironmentKeys,
      testDatabaseSchema:String(result.test_database_schema ?? ""),
      projectContext:String(result.project_context ?? ""),technicalHistory:String(result.technical_history ?? ""),
    }:current);
    setTestEnvironmentText(""); setConfigSaving(false);
    setConfigMessage(`Configuração salva${result.test_database_schema?` — schema ${result.test_database_schema}`:""}.`);
  }

  async function saveSettings(e:FormEvent) {
    e.preventDefault();
    const response=await fetch("/api/settings",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({archiveAfterDays,deleteAfterDays})});
    const result=await response.json().catch(()=>({}));
    setDataError(response.ok?"":result.error??"Não foi possível salvar as configurações.");
  }

  async function confirmDeployCompleted() {
    if (!detail) return;
    const response=await fetch(`/api/tickets/${detail.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({deployCompleted:true})});
    if (!response.ok) return setDataError("Não foi possível confirmar o deploy.");
    await loadTicketDetails(detail.id);
  }

  const codexProgressEvent=ticketDetails?.events.findLast(event=>event.kind==="codex.started");
  const codexTranscript=Array.isArray(codexProgressEvent?.metadata?.transcript)
    ? codexProgressEvent.metadata.transcript as CodexTranscriptItem[] : [];
  const codexPrompt=typeof codexProgressEvent?.metadata?.prompt==="string" ? codexProgressEvent.metadata.prompt : "";
  const pendingApproval=ticketDetails?.approvals.find(approval=>approval.decision===null);

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><i>L</i><div><strong>LionWorkForce</strong><span>Autonomous fixes</span></div></div>
      <nav>
        <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ <span>Quadro</span></button>
        <button className={view === "apps" ? "active" : ""} onClick={() => setView("apps")}>⌘ <span>Aplicações</span><b>{applicationList.length}</b></button>
        <button className={view === "archive" ? "active" : ""} onClick={() => setView("archive")}>◫ <span>Arquivados</span></button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>⚙ <span>Configurações</span></button>
      </nav>
      <div className={`agent ${agentHealth.queuePaused?"paused":agentHealth.workerOnline&&agentHealth.codexAuthenticated?"online":"offline"}`}><strong><i /> {agentHealth.queuePaused?"Fila pausada":agentHealth.workerOnline?(agentHealth.codexAuthenticated?"Codex conectado":"Codex sem autenticação"):"Worker desconectado"}</strong><p>{agentHealth.message}</p>{agentHealth.lastSeen&&<small>Último sinal: {new Date(agentHealth.lastSeen).toLocaleTimeString("pt-BR")}</small>}<button className="pause-queue" onClick={toggleQueuePause}>{agentHealth.queuePaused?"▶ Retomar fila":"Ⅱ Pausar fila"}</button></div>
      <div className="user"><i>ES</i><div><strong>Elder</strong><span>Administrador</span></div><b>•••</b></div>
    </aside>

    <section className="content">
      <header>
        <div><p>{view==="board"?"CENTRO DE CORREÇÕES":view==="apps"?"REPOSITÓRIOS AUTORIZADOS":view==="archive"?"HISTÓRICO AUTOMÁTICO":"PREFERÊNCIAS"}</p><h1>{view==="board"?"Quadro de chamados":view==="apps"?"Aplicações":view==="archive"?"Chamados arquivados":"Configurações"}</h1></div>
        <div className="actions"><label>⌕ <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar chamado..." /></label><button className="primary" onClick={openNewTicket}>＋ Novo chamado</button></div>
      </header>

      {view === "board" || view==="archive" ? <>
        {view==="board" && <div className="stats">
          <div><span>Em andamento</span><strong>{tickets.filter(t => ["Analisando","Corrigindo","Testando"].includes(t.status)).length}</strong><small>execuções ativas</small></div>
          <div><span>Aguardando você</span><strong>{tickets.filter(t => t.status === "Aguardando aprovação").length}</strong><small>aprovações pendentes</small></div>
          <div><span>Concluídos</span><strong>{tickets.filter(t => t.status === "Concluído").length}</strong><small>no histórico</small></div>
          <div><span>Executor</span><strong className={agentHealth.queuePaused?"paused-state":agentHealth.workerOnline&&agentHealth.codexAuthenticated?"ok":"warning"}>{agentHealth.queuePaused?"Pausado":agentHealth.workerOnline?(agentHealth.codexAuthenticated?"Operacional":"Sem login"):"Offline"}</strong><small>{agentHealth.message}</small></div>
        </div>}
        {dataError && <div className="import-error">{dataError}</div>}
        {loadingData ? <div className="loading-board">Carregando seus chamados…</div> : <div className="board">{statuses.map(status => <section className={`column ${draggedTicket !== null ? "drop-enabled" : ""}`} key={status} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedTicket !== null) moveTicket(draggedTicket, status); setDraggedTicket(null); }}>
          <header><i className={`status s${statuses.indexOf(status)}`} /><strong>{status}</strong><b>{visible.filter(t => t.status === status).length}</b></header>
          {visible.filter(t => t.status === status).map(t => <button className={`ticket ${draggedTicket === t.id ? "dragging" : ""}`} draggable key={t.id} onDragStart={event => { event.dataTransfer.effectAllowed = "move"; setDraggedTicket(t.id); }} onDragEnd={() => setDraggedTicket(null)} onClick={() => openTicket(t)}>
            <div className="ticket-top"><span className={`p-${t.priority}`}>{t.ticketKind==="deploy"?"DEPLOY":t.priority}</span><b className="queue-priority">Fila {t.queuePriority}</b><small>#{t.id}</small></div>
            <h3>{t.title}</h3><p>{t.description}</p>
            <div className="repo"><i style={{ background: app(t.appId).color }}>{app(t.appId).name[0]}</i><div><strong>{app(t.appId).name}</strong><small>{app(t.appId).repo}</small></div></div>
            <footer><span>{t.scheduledAt&&new Date(t.scheduledAt)>new Date()?`Agendado: ${new Date(t.scheduledAt).toLocaleString("pt-BR")}`:`⑂ ${app(t.appId).branch}`}</span><span>{t.age}</span></footer>
          </button>)}
          {!visible.some(t => t.status === status) && <div className="empty">Nenhum chamado</div>}
        </section>)}</div>}
      </> : view==="apps" ? <div className="apps">{applicationList.map(a => <article key={a.id}>
        <div className="app-icon" style={{ background: a.color }}>{a.name[0]}</div><span className="authorized">● AUTORIZADO</span>
        <h2>{a.name}</h2><p>◉ {a.repo}</p>
        <dl><div><dt>Linguagem</dt><dd>{a.language}</dd></div><div><dt>Branch principal</dt><dd>{a.branch}</dd></div></dl>
        <footer><span>{tickets.filter(t => t.appId === a.id).length} chamados</span><button onClick={() => {
          setConfigApp(a); setDeployWebhookUrl(""); setDeployVerificationUrl(""); setDeployTimeoutMinutes(a.deployTimeoutMinutes); setRemoveDeployWebhook(false);
          setInstallCommand(a.installCommand); setTestCommand(a.testCommand);
          setLintCommand(a.lintCommand); setBuildCommand(a.buildCommand);
          setTestEnvironmentText(""); setConfigMessage("");
        }}>Configurar →</button></footer>
      </article>)}<button className="add" onClick={openImport}><b>＋</b><strong>Importar repositório</strong><small>Conectar outra aplicação do GitHub</small></button></div> :
      <form className="settings-panel" onSubmit={saveSettings}><h2>Retenção dos chamados</h2><p>O prazo é contado desde a conclusão ou falha. O worker aplica a limpeza automaticamente.</p><div className="command-grid"><label>Arquivar depois de<input type="number" min={1} max={3650} value={archiveAfterDays} onChange={e=>setArchiveAfterDays(Number(e.target.value))} /><small>dias</small></label><label>Excluir definitivamente depois de<input type="number" min={2} max={3650} value={deleteAfterDays} onChange={e=>setDeleteAfterDays(Number(e.target.value))} /><small>dias</small></label></div><button className="primary" disabled={deleteAfterDays<=archiveAfterDays}>Salvar configurações</button></form>}
    </section>

    {modal && <div className="overlay" onMouseDown={() => setModal(false)}><form className="modal" onSubmit={submit} onPaste={pasteImages} onMouseDown={e => e.stopPropagation()}>
      <header><div><p>{editingTicketId?"EDITAR CHAMADO":duplicating?"DUPLICAR CHAMADO":"NOVO CHAMADO"}</p><h2>{ticketKind==="deploy"?"Agende um deploy sem alterar o código":editingTicketId?"Atualize os dados enquanto está na fila":duplicating?"Revise e edite a cópia":"O que precisa ser corrigido?"}</h2></div><button type="button" onClick={() => setModal(false)}>×</button></header>
      <label>Aplicação <b>*</b><small>{editingTicketId?"O repositório não pode ser alterado.":"O repositório ficará bloqueado após criar."}</small></label>
      <div className="picker"><label>⌕ <input value={repoQuery} onChange={e => setRepoQuery(e.target.value)} placeholder="Buscar aplicação ou repositório..." /></label>
        {applicationList.filter(a => `${a.name} ${a.repo}`.toLowerCase().includes(repoQuery.toLowerCase()) && (!editingTicketId || a.id===appId)).map(a => <button type="button" disabled={Boolean(editingTicketId)} className={appId === a.id ? "chosen" : ""} onClick={() => chooseApplication(a.id)} key={a.id}><i style={{ background: a.color }}>{a.name[0]}</i><div><strong>{a.name}</strong><small>{a.repo}</small></div><em>{a.language}</em><b>{appId === a.id ? "✓" : ""}</b></button>)}
      </div>
      <section className="execution-options">
        <div className="execution-heading"><div><span>EXECUÇÃO</span><strong>Como este chamado deve começar?</strong></div>{scheduledAt&&<b>Agendado</b>}</div>
        <div className="execution-grid">
          <label>Tipo do chamado<select value={ticketKind} onChange={e=>{const kind=e.target.value as "fix"|"deploy";setTicketKind(kind);if(kind==="deploy"){setAttachments([]);setAutoDeploy(true);setCreateTag(false);}}}><option value="fix">Correção com Codex</option><option value="deploy">Somente deploy</option></select><small>{ticketKind==="deploy"?"Dispara o webhook sem clonar nem alterar código.":"Analisa, corrige e valida o repositório."}</small></label>
          <div className="schedule-field"><span>Momento da execução</span><div className="schedule-choice"><button type="button" className={!scheduledAt?"active":""} onClick={()=>setScheduledAt("")}>Executar assim que possível</button><button type="button" className={scheduledAt?"active":""} onClick={()=>{if(!scheduledAt){const date=new Date(Date.now()+60*60*1000);date.setMinutes(Math.ceil(date.getMinutes()/5)*5,0,0);setScheduledAt(toLocalDateTimeInput(date.toISOString()));}}}>Agendar data e hora</button></div>{scheduledAt&&<input aria-label="Data e hora do agendamento" type="datetime-local" min={toLocalDateTimeInput(new Date().toISOString())} value={scheduledAt} onChange={e=>setScheduledAt(e.target.value)} />}<small>{scheduledAt?`Será liberado para a fila em ${new Date(scheduledAt).toLocaleString("pt-BR")}.`:"Entrará na fila imediatamente após a criação."}</small></div>
        </div>
      </section>
      <label>Título <b>*</b><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Login falha depois de redefinir a senha" /></label>
      <label>{ticketKind==="deploy"?"Observações do deploy":"Descrição do bug"} <b>*</b><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={ticketKind==="deploy"?"Explique o motivo ou os cuidados para este deploy...":"Explique o comportamento atual, o esperado e como reproduzir..."} /></label>
      <div className="row ticket-fields"><label>Criticidade<select value={priority} onChange={e => setPriority(e.target.value as Ticket["priority"])}><option>Baixa</option><option>Média</option><option>Alta</option><option>Crítica</option></select></label><label>Ordem da fila<select value={queuePriority} onChange={e=>setQueuePriority(Number(e.target.value))}>{Array.from({length:10},(_,index)=>index+1).map(value=><option key={value} value={value}>{value} — {value===1?"primeiro":value===10?"último":"prioridade da fila"}</option>)}</select></label><div className="drop" role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }} onDragOver={e => e.preventDefault()} onDrop={dropImages}>⌁ <span>Logs e imagens<small>Clique, arraste ou cole com Ctrl+V</small></span><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={e => addImages(Array.from(e.target.files ?? []))} /></div></div>
      {ticketKind==="fix"?<label>Modelo de IA<select value={aiModel} onChange={e=>setAiModel(e.target.value)}>{codexModels.map(model=><option key={model.value||"default"} value={model.value}>{model.label}</option>)}</select><small>A disponibilidade depende do seu plano e da conta autenticada no Codex.</small></label>:<p className="config-help">Este chamado usa o commit atual da branch principal e o webhook configurado na aplicação. O Codex não será iniciado.</p>}
      <p className={`severity-help severity-${priority}`}>{priority==="Alta"||priority==="Crítica"?"Esta criticidade exige sua aprovação antes de commit, push ou merge.":"Esta criticidade continua automaticamente após a correção; Pull Request ainda exige autorização no GitHub."}</p>
      <fieldset className="automation-options"><legend>Automação após corrigir e testar</legend>
        <label><input type="checkbox" checked={autoCommit} onChange={e => { setAutoCommit(e.target.checked); if (!e.target.checked) { setAutoPush(false); setAutoPullRequest(false); setAutoDeploy(false); } }} /><span><strong>Commit automático</strong><small>Criar um commit com a correção</small></span></label>
        <label><input type="checkbox" checked={autoPush} onChange={e => { setAutoPush(e.target.checked); if (e.target.checked) setAutoCommit(true); else { setAutoPullRequest(false); setAutoDeploy(false); } }} /><span><strong>Push automático</strong><small>Enviar a branch lionworkforce/chamado-ID</small></span></label>
        <label><input type="checkbox" checked={autoPullRequest} onChange={e => { setAutoPullRequest(e.target.checked); if (e.target.checked) { setAutoCommit(true); setAutoPush(true); setAutoDeploy(false); } }} /><span><strong>Pull Request automático</strong><small>Criar PR em vez de integrar diretamente</small></span></label>
        <label className={!appId || !app(appId).deployConfigured || autoPullRequest ? "disabled" : ""}><input type="checkbox" checked={autoDeploy} disabled={!appId || !app(appId).deployConfigured || autoPullRequest} onChange={e => { setAutoDeploy(e.target.checked); if (e.target.checked) { setAutoCommit(true); setAutoPush(true); } }} /><span><strong>Deploy automático</strong><small>{appId && app(appId).deployConfigured ? (autoPullRequest ? "Disponível somente sem Pull Request" : "Disparar webhook do EasyPanel após integrar") : "Configure o webhook na aplicação"}</small></span></label>
        <label className={!appId || autoPullRequest ? "disabled" : ""}><input type="checkbox" checked={createTag} disabled={!appId || autoPullRequest} onChange={e => { setCreateTag(e.target.checked); if (e.target.checked) { setAutoCommit(true); setAutoPush(true); } }} /><span><strong>Criar tag e ativar Action</strong><small>{autoPullRequest?"Disponível após integração, sem Pull Request":repoTags.length?`${repoTags.length} tag(s) encontrada(s)`:"Nenhuma tag encontrada; iniciar em v1.0.0"}</small></span></label>
      </fieldset>
      {createTag && <div className="tag-options"><label>Nova versão<input value={releaseTag} onChange={e=>setReleaseTag(e.target.value)} placeholder="v1.0.0" />{repoTags.some(tag=>tag.name===releaseTag)&&<small className="tag-error">Essa tag já existe. Altere o número da versão.</small>}</label><div><strong>Tags anteriores</strong><p>{repoTags.length?repoTags.slice(0,8).map(tag=><button type="button" key={tag.name} onClick={()=>setReleaseTag(tag.name)} title="Usar como base e editar">{tag.name}</button>):<small>Nenhuma tag neste repositório.</small>}</p></div><div className="recent-actions"><strong>Últimas Actions</strong>{repoActions.length?<ol>{repoActions.slice(0,5).map(action=><li key={action.id}><a href={action.html_url} target="_blank" rel="noreferrer">{action.display_title || action.name}</a><small>{action.conclusion ?? action.status} · {new Date(action.created_at).toLocaleString("pt-BR")}</small></li>)}</ol>:<small>Nenhuma execução recente encontrada.</small>}</div></div>}
      {ticketKind==="fix" && attachments.length > 0 && <AttachmentList attachments={attachments} onPreview={item=>setPreviewImage({name:item.file.name,src:item.preview})} onRemove={removeImage} />}
      {submitError&&<div className="import-error">{submitError}</div>}
      <footer><button type="button" className="secondary" onClick={() => setModal(false)}>Cancelar</button><button className="primary" disabled={submittingTicket || !appId || !title || !description || (ticketKind==="deploy"&&!app(appId).deployConfigured) || (ticketKind==="fix"&&createTag && (!releaseTag || repoTags.some(tag=>tag.name===releaseTag)))}>{submittingTicket?"Salvando...":editingTicketId?"Salvar alterações":ticketKind==="deploy"?(scheduledAt?"Agendar deploy →":"Criar chamado de deploy →"):duplicating?"Criar cópia e enviar ao Codex →":"Criar e enviar ao Codex →"}</button></footer>
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
      <section className="context-file">
        <div><strong>Contexto permanente do projeto</strong><code>docs/PROJECT_CONTEXT.md</code><small>{configApp.projectContext?"Há um contexto sincronizado no LionWorkForce. O arquivo da branch principal continua sendo a fonte oficial.":"Nenhum contexto foi sincronizado ainda. Crie o arquivo na branch principal."}</small></div>
        <nav><a href={projectContextUrl(configApp,"blob")} target="_blank" rel="noreferrer">Abrir arquivo</a><a href={projectContextUrl(configApp,configApp.projectContext?"edit":"new")} target="_blank" rel="noreferrer">{configApp.projectContext?"Editar no GitHub":"Criar no GitHub"}</a></nav>
      </section>
      {configApp.technicalHistory&&<details className="project-history"><summary>Ver histórico técnico integrado</summary><pre>{configApp.technicalHistory}</pre><small>Atualizado automaticamente somente depois que uma correção é integrada à branch principal.</small></details>}
      <label>Variáveis exclusivas do ambiente de teste<textarea value={testEnvironmentText} onChange={e=>{setTestEnvironmentText(e.target.value);setConfigMessage("");}} placeholder={"DATABASE_URL=postgresql://usuario:senha@servidor:5432/base_teste\nE2E_BASE_URL=https://teste.exemplo.com"} /><small>{configApp.testEnvironmentKeys.length?`Já configuradas (valores ocultos): ${configApp.testEnvironmentKeys.join(", ")}${configApp.testDatabaseSchema?` — schema atual: ${configApp.testDatabaseSchema}`:" — nenhum parâmetro schema detectado"}. Deixe vazio para manter; preencha para substituir.`:"Nenhuma variável configurada. Use somente banco e serviços de teste, nunca a base de produção."}</small></label>
      {configMessage&&<div className={configMessage.startsWith("Configuração salva")?"config-success":"import-error"}>{configMessage}</div>}
      <label>Webhook de deploy HTTPS<input type="url" value={deployWebhookUrl} disabled={removeDeployWebhook} onChange={e => setDeployWebhookUrl(e.target.value)} placeholder={removeDeployWebhook ? "O webhook será removido ao salvar" : configApp.deployConfigured ? "Já configurado — cole outro para substituir" : "https://..."} /></label>
      <label>URL HTTPS de verificação da versão<input type="url" value={deployVerificationUrl} onChange={e=>setDeployVerificationUrl(e.target.value)} placeholder={configApp.deployVerificationConfigured?"Já configurada — cole outra para substituir":"https://seu-app.com/api/version"} /><small>Deve retornar JSON com commit/sha ou o cabeçalho X-Commit-Sha. É usada para confirmar o deploy e liberar a fila.</small></label>
      <label>Tempo limite do deploy (minutos)<input type="number" min={1} max={120} value={deployTimeoutMinutes} onChange={e=>setDeployTimeoutMinutes(Number(e.target.value))} /></label>
      <footer><button type="button" className="secondary" onClick={() => setConfigApp(null)}>Fechar</button>{configApp.deployConfigured && <button type="button" className="danger" onClick={() => setRemoveDeployWebhook(value=>!value)}>{removeDeployWebhook?"Manter webhook":"Remover webhook"}</button>}<button className="primary" disabled={configSaving}>{configSaving?"Salvando...":"Salvar"}</button></footer>
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
      <section className="ticket-description"><h4>DESCRIÇÃO COMPLETA</h4><p>{detail.description}</p></section>
      {ticketDetails&&<section className="ticket-configuration"><h4>EXECUÇÃO</h4><dl><div><dt>Tipo</dt><dd>{ticketDetails.ticket_kind==="deploy"?"Somente deploy":"Correção com Codex"}</dd></div><div><dt>Agendamento</dt><dd>{ticketDetails.scheduled_at?new Date(ticketDetails.scheduled_at).toLocaleString("pt-BR"):"Sem agendamento"}</dd></div></dl></section>}
      {ticketDetails&&<section className="ticket-configuration"><h4>CONFIGURAÇÕES DO CHAMADO</h4><dl><div><dt>Modelo de IA</dt><dd>{ticketDetails.ai_model??"Padrão da conta Codex"}</dd></div><div><dt>Criticidade</dt><dd>{detail.priority}</dd></div><div><dt>Ordem da fila</dt><dd>{detail.queuePriority}</dd></div><div><dt>Commit automático</dt><dd>{ticketDetails.auto_commit?"Sim":"Não"}</dd></div><div><dt>Push automático</dt><dd>{ticketDetails.auto_push?"Sim":"Não"}</dd></div><div><dt>Pull Request automático</dt><dd>{ticketDetails.auto_pull_request?"Sim":"Não"}</dd></div><div><dt>Deploy automático</dt><dd>{ticketDetails.auto_deploy?"Sim":"Não"}</dd></div><div><dt>Criar tag</dt><dd>{ticketDetails.create_tag?(ticketDetails.release_tag??"Sim"):"Não"}</dd></div></dl></section>}
      {ticketImages.length>0&&<section className="ticket-gallery"><h4>IMAGENS DO CHAMADO</h4><div>{ticketImages.map((image,index)=><button type="button" key={`${image.name}-${index}`} onClick={()=>setPreviewImage({name:image.name,src:`data:${image.mimeType};base64,${image.data}`})} aria-label={`Ampliar ${image.name}`}><Image src={`data:${image.mimeType};base64,${image.data}`} alt="" width={180} height={120} unoptimized /><span>{image.name}</span></button>)}</div></section>}
      <h4>ATIVIDADE DO AGENTE</h4>
      {ticketDetails && ticketDetails.deploy_status!=="not_requested" && <section className={`deploy-panel deploy-${ticketDetails.deploy_status}`}><h4>DEPLOY</h4><strong>{ticketDetails.deploy_status==="completed"?"Deploy concluído":ticketDetails.deploy_status==="failed"?"Falha ao confirmar deploy":"Deploy em curso no EasyPanel"}</strong><p>{ticketDetails.deploy_status==="in_progress"?"A fila está pausada enquanto o LionWorkForce procura o novo commit na URL de verificação. A confirmação manual continua disponível como alternativa.":ticketDetails.deploy_updated_at?`Atualizado em ${new Date(ticketDetails.deploy_updated_at).toLocaleString("pt-BR")}`:""}</p>{ticketDetails.deploy_status==="in_progress"&&<button className="approve-ticket" onClick={confirmDeployCompleted}>Confirmar deploy concluído</button>}</section>}
      {!ticketDetails && !ticketDetailsError && <div className="detail-loading">Carregando atividade…</div>}
      {ticketDetailsError&&<div className="import-error">{ticketDetailsError}</div>}
      {ticketDetails && <div className="timeline">{ticketDetails.events.map((event,index)=><div className={event.kind.includes("failed")?"failed":index===ticketDetails.events.length-1?"running":"done"} key={event.id}><i>{event.kind.includes("failed")?"!":index+1}</i><span><strong>{eventLabels[event.kind]??event.kind}</strong><small>{event.message} · {new Date(event.created_at).toLocaleString("pt-BR")}</small></span></div>)}</div>}
      {pendingApproval && <section className="approval-panel"><h4>APROVAÇÃO NECESSÁRIA</h4><strong>{pendingApproval.reason}</strong><p>{pendingApproval.patch_available?"A correção foi preservada. Ao aprovar, o worker criará um clone limpo, restaurará o patch e continuará somente com as automações escolhidas no chamado.":"Esta execução não possui patch preservado. Se for um chamado antigo, duplique-o para executar novamente. Se houver Pull Request, a autorização deve ser feita no GitHub."}</p><div><button className="approve-ticket" disabled={!pendingApproval.patch_available} onClick={()=>decideApproval("approved")}>Aprovar correção</button><button className="danger" onClick={()=>decideApproval("rejected")}>Rejeitar correção</button></div></section>}
      {codexProgressEvent && <section className="codex-conversation"><div className="conversation-title"><h4>ATIVIDADE PÚBLICA DO CODEX</h4><span>Atualização automática</span></div>{codexTranscript.length>0?codexTranscript.map((item,index)=><article className={item.type} key={`${item.at}-${index}`}><small>{new Date(item.at).toLocaleTimeString("pt-BR")}</small><p>{item.text}</p></article>):<p className="conversation-empty">O Codex ainda não emitiu uma atualização detalhada.</p>}{codexPrompt&&<details><summary>Ver prompt enviado ao Codex</summary><pre>{codexPrompt}</pre></details>}<small className="conversation-note">Mostra mensagens e ações públicas. O raciocínio interno privado do modelo não é disponibilizado.</small></section>}
      {showLogs && ticketDetails && <section className="full-logs"><h4>DETALHES TÉCNICOS</h4>{ticketDetails.executions.map(execution=><article key={execution.id}><strong>Tentativa {execution.attempt} · {execution.state}</strong><small>{execution.started_at?`Iniciada em ${new Date(execution.started_at).toLocaleString("pt-BR")}`:"Não iniciada"}</small>{execution.error_message&&<pre>{execution.error_message}</pre>}</article>)}{ticketDetails.events.map(event=><article key={`log-${event.id}`}><strong>{eventLabels[event.kind]??event.kind}</strong><small>{event.message}</small>{Object.keys(event.metadata??{}).length>0&&<details><summary>Ver dados técnicos</summary><pre>{JSON.stringify(event.metadata,null,2)}</pre></details>}</article>)}</section>}
      <footer className="ticket-actions"><div>{detail.status==="Aberto"&&<button className="approve-ticket" onClick={editTicket}>Editar chamado</button>}<button className="danger" onClick={cancelExecution} disabled={["Concluído","Falhou","Aguardando aprovação"].includes(detail.status)}>Cancelar execução</button><button className="delete-ticket" onClick={deleteTicket}>Excluir cartão</button></div><div><button className="secondary" onClick={cloneTicket}>Duplicar com imagens</button><button className="secondary" onClick={()=>setShowLogs(value=>!value)}>{showLogs?"Ocultar logs":"Ver logs completos"}</button></div></footer>
    </aside></div>}
    {previewImage&&<div className="overlay image-preview" onClick={()=>setPreviewImage(null)}><section role="dialog" aria-modal="true" aria-label={`Imagem ampliada: ${previewImage.name}`} onClick={event=>event.stopPropagation()}><header><strong>{previewImage.name}</strong><button type="button" onClick={()=>setPreviewImage(null)} aria-label="Fechar imagem ampliada">×</button></header><Image src={previewImage.src} alt={previewImage.name} width={1400} height={1000} unoptimized /></section></div>}
  </main>;
}
