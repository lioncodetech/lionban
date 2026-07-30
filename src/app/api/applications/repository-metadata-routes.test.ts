import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, listRepositoryTagsMock, listRecentRepositoryActionsMock } = vi.hoisted(() => ({
  queryMock:vi.fn(),
  listRepositoryTagsMock:vi.fn(),
  listRecentRepositoryActionsMock:vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query:queryMock }));
vi.mock("@/lib/github", () => ({
  listRepositoryTags:listRepositoryTagsMock,
  listRecentRepositoryActions:listRecentRepositoryActionsMock,
}));

import { GET as getActions } from "./[id]/actions/route";
import { GET as getTags } from "./[id]/tags/route";

const context = { params:Promise.resolve({ id:"629e4e6e-c6bd-4ba7-998f-12418f5176b5" }) };

describe("metadados do repositório da aplicação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue({ rowCount:1, rows:[{ full_name:"lioncodetech/multi-instance" }] });
  });

  it("busca as tags usando a tabela canônica de aplicações", async () => {
    const tags = Array.from({ length:5 }, (_, index) => ({
      name:`v1.0.${5 - index}`,
      commit:{ sha:`sha-${index}` },
    }));
    listRepositoryTagsMock.mockResolvedValue(tags);

    const response = await getTags(new Request("http://localhost"), context);

    expect(queryMock).toHaveBeenCalledWith(
      "SELECT full_name FROM lwf_applications WHERE id=$1 AND enabled=true",
      ["629e4e6e-c6bd-4ba7-998f-12418f5176b5"],
    );
    await expect(response.json()).resolves.toEqual(tags);
  });

  it("busca as Actions usando a tabela canônica de aplicações", async () => {
    const actions = [{ id:1, name:"CI" }];
    listRecentRepositoryActionsMock.mockResolvedValue(actions);

    const response = await getActions(new Request("http://localhost"), context);

    expect(queryMock).toHaveBeenCalledWith(
      "SELECT full_name FROM lwf_applications WHERE id=$1 AND enabled=true",
      ["629e4e6e-c6bd-4ba7-998f-12418f5176b5"],
    );
    await expect(response.json()).resolves.toEqual(actions);
  });
});
