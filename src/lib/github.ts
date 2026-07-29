const api = "https://api.github.com";
const headers = () => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" });
export async function listAuthorizedRepos() {
  const response = await fetch(`${api}/user/repos?per_page=100&sort=updated`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
  return response.json() as Promise<Array<{ id:number; name:string; full_name:string; default_branch:string; language:string|null; clone_url:string }>>;
}
export async function validateRepo(fullName: string, expectedId: number) {
  const response = await fetch(`${api}/repos/${fullName}`, { headers: headers(), cache: "no-store" });
  if (!response.ok) return false;
  return (await response.json() as { id:number }).id === expectedId;
}

