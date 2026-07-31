import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultBranchContainsCommit, getPullRequestStatus, listRecentRepositoryActions } from "./github";

describe("listRecentRepositoryActions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("traz as cinco execuções mais recentes do GitHub Actions", async () => {
    const workflowRuns = Array.from({ length: 5 }, (_, index) => ({
      id:index + 1,
      name:`Action ${index + 1}`,
      display_title:`Execução ${index + 1}`,
      status:"completed",
      conclusion:"success",
      html_url:`https://github.com/lion/repo/actions/runs/${index + 1}`,
      created_at:`2026-07-${String(30 - index).padStart(2, "0")}T12:00:00Z`,
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workflow_runs:workflowRuns }), { status:200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRecentRepositoryActions("lion/repo")).resolves.toEqual(workflowRuns);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/lion/repo/actions/runs?per_page=5",
      expect.objectContaining({ cache:"no-store" }),
    );
  });
});

describe("GitHub publication checks",()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it("normaliza o estado de um Pull Request",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({
      number:7,state:"closed",merged:true,merge_commit_sha:"abc123",html_url:"https://github.com/lion/repo/pull/7",
    }),{status:200})));
    await expect(getPullRequestStatus("lion/repo",7)).resolves.toEqual({
      number:7,state:"closed",merged:true,mergeCommitSha:"abc123",htmlUrl:"https://github.com/lion/repo/pull/7",
    });
  });
  it("confirma quando a branch principal contém o commit",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({status:"ahead"}),{status:200})));
    await expect(defaultBranchContainsCommit("lion/repo","abc","main")).resolves.toBe(true);
  });
});
