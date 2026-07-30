import { afterEach, describe, expect, it, vi } from "vitest";

import { listRecentRepositoryActions } from "./github";

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
