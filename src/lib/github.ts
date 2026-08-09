const api = "https://api.github.com";
const headers = () => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" });
export async function listAuthorizedRepos() {
  const response = await fetch(`${api}/user/repos?per_page=100&sort=updated`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  return response.json() as Promise<Array<{ id:number; name:string; full_name:string; default_branch:string; language:string|null; clone_url:string }>>;
}
export async function validateRepo(fullName: string, expectedId: number) {
  const response = await fetch(`${api}/repos/${fullName}`, { headers: headers(), cache: "no-store", signal:AbortSignal.timeout(15_000) });
  if (!response.ok) return false;
  return (await response.json() as { id:number }).id === expectedId;
}
export async function listRepositoryTags(fullName:string) {
  const response=await fetch(`${api}/repos/${fullName}/tags?per_page=30`,{headers:headers(),cache:"no-store"});
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  return response.json() as Promise<Array<{name:string;commit:{sha:string}}>>;
}
export type RepositoryActionRun = {
  id:number; name:string; display_title:string; status:string; conclusion:string|null;
  html_url:string; created_at:string;
};
export async function listRecentRepositoryActions(fullName:string) {
  const response=await fetch(`${api}/repos/${fullName}/actions/runs?per_page=5`,{headers:headers(),cache:"no-store"});
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  const result=await response.json() as {workflow_runs:RepositoryActionRun[]};
  return result.workflow_runs;
}
export async function getDefaultBranchCommit(fullName:string,defaultBranch:string) {
  const response=await fetch(`${api}/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`,{
    headers:headers(),cache:"no-store",signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  return (await response.json() as {sha:string}).sha;
}
export async function listLionWorkForceBranches(fullName:string) {
  const response=await fetch(`${api}/repos/${fullName}/git/matching-refs/heads/lionworkforce%2Fchamado-`,{
    headers:headers(),cache:"no-store",signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  const refs=await response.json() as Array<{ref:string}>;
  return refs.map(item=>item.ref.replace(/^refs\/heads\//,""));
}
export async function deleteRepositoryBranch(fullName:string,branch:string) {
  if (!/^lionworkforce\/chamado-\d+$/.test(branch)) throw new Error("BRANCH_NOT_ALLOWED");
  const ref=branch.split("/").map(encodeURIComponent).join("/");
  const response=await fetch(`${api}/repos/${fullName}/git/refs/heads/${ref}`,{
    method:"DELETE",headers:headers(),cache:"no-store",signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status!==404) throw new Error(`GitHub respondeu ${response.status}`);
}
export type PullRequestStatus={number:number;state:"open"|"closed";merged:boolean;mergeCommitSha:string|null;htmlUrl:string};
export async function getPullRequestStatus(fullName:string,number:number):Promise<PullRequestStatus> {
  const response=await fetch(`${api}/repos/${fullName}/pulls/${number}`,{
    headers:headers(),cache:"no-store",signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  const result=await response.json() as {number:number;state:"open"|"closed";merged:boolean;merge_commit_sha:string|null;html_url:string};
  return {number:result.number,state:result.state,merged:result.merged,mergeCommitSha:result.merge_commit_sha,htmlUrl:result.html_url};
}

export async function defaultBranchContainsCommit(fullName:string,commit:string,defaultBranch:string) {
  const response=await fetch(`${api}/repos/${fullName}/compare/${encodeURIComponent(commit)}...${encodeURIComponent(defaultBranch)}`,{
    headers:headers(),cache:"no-store",signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok) return false;
  const result=await response.json() as {status:string};
  return result.status==="identical" || result.status==="ahead";
}
