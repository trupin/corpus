import { join } from "node:path";
import { ApiErrorSchema, DocListSchema, FolderTreeSchema } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { formatInstant } from "../core/time.js";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const NOW = Date.parse("2026-07-26T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => formatInstant(NOW - days * MS_PER_DAY);

let ws: Workspace;
let server: CorpusServer;

const config = (workspaceRoot: string): ServerConfig => ({
  workspaceRoot,
  corpusDir: join(workspaceRoot, ".corpus"),
  attachments: DEFAULT_ATTACHMENT_LIMITS,
  dataDir: join(workspaceRoot, "data"),
  configPath: join(workspaceRoot, ".corpus", "config.json"),
  host: "127.0.0.1",
  port: 0,
  token: TOKEN,
  version: "9.9.9",
  logLevel: "silent",
  uiDistDir: undefined,
  embedding: { kind: "absent" },
  warnings: [],
});

const get = async (path: string, init: RequestInit = { headers: AUTH }): Promise<Response> =>
  server.app.request(path, init);

async function json(path: string): Promise<unknown> {
  const response = await get(path);
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(() => {
  ws = createWorkspace("routes");
  ws.doc({
    id: "doc_mortgage",
    path: "data/docs/finance/mortgage.md",
    title: "Escrow basics",
    tags: ["finance"],
    updated: daysAgo(2),
  });
  ws.doc({ id: "doc_old", path: "data/docs/finance/old.md", updated: daysAgo(200) });
  ws.doc({ id: "doc_note", path: "data/docs/inbox/note.md", updated: daysAgo(1) });
  ws.thread({
    id: "th_one",
    parent: "doc_mortgage",
    agent: "engaged",
    turns: [{ author: "agent", ts: daysAgo(1), body: "Rates moved." }],
  });
  ws.reproject();

  server = createServer(config(ws.config.workspaceRoot), {
    projection: ws.db,
    now: () => NOW,
  });
});

afterAll(async () => {
  await server.close();
  ws.close();
});

describe("GET /api/docs", () => {
  it("answers a contract-shaped list", async () => {
    const body = await json("/api/docs");
    const parsed = DocListSchema.parse(body);
    expect(parsed.page).toEqual({ total: 4, limit: 50, offset: 0 });
    expect(parsed.items.map((item) => item.id)).toEqual([
      "doc_note",
      "doc_mortgage",
      "th_one",
      "doc_old",
    ]);
  });

  it("composes filters from the query string", async () => {
    const body = DocListSchema.parse(await json("/api/docs?folder=finance&type=note"));
    expect(body.items.map((item) => item.id).sort()).toEqual(["doc_mortgage", "doc_old"]);
  });

  it("ignores an unknown parameter name rather than rejecting it", async () => {
    const withExtra = DocListSchema.parse(await json("/api/docs?colour=blue&type=note"));
    const without = DocListSchema.parse(await json("/api/docs?type=note"));
    expect(withExtra).toEqual(without);
  });

  it.each([
    ["stale=ancient", "stale"],
    ["agent=maybe", "agent"],
    ["needs=everyone", "needs"],
    ["due=next-tuesday", "due"],
    ["since=not-a-date", "since"],
    ["unread=perhaps", "unread"],
    ["type=", "type"],
    ["limit=201", "limit"],
    ["limit=0", "limit"],
    ["offset=-1", "offset"],
    ["sort=last-activity", "sort"],
    ["sort=relevance", "sort"],
    ["isParent=maybe", "isParent"],
    // The contradiction, over HTTP: `parent` asks for a document's children and
    // `isParent=true` asks for documents with no parent (CONTRACT-042). It is a
    // 400 rather than an empty list, because `parent` no-ops for non-thread rows
    // and the intersection would be every root non-thread document.
    ["parent=doc_mortgage&isParent=true", "isParent"],
  ])("rejects ?%s with a 400 naming %s", async (query, parameter) => {
    const response = await get(`/api/docs?${query}`);
    expect(response.status).toBe(400);
    const error = ApiErrorSchema.parse(await response.json());
    expect(error.code).toBe("bad_request");
    expect(error.code === "bad_request" ? error.issues : []).not.toHaveLength(0);
    const issues = error.code === "bad_request" ? error.issues : [];
    expect(issues.some((issue) => issue.path.includes(parameter))).toBe(true);
  });

  it("accepts the boundary values the cap allows", async () => {
    expect((await get("/api/docs?limit=200&offset=0")).status).toBe(200);
    expect((await get("/api/docs?q=escrow&sort=relevance")).status).toBe(200);
    // The redundant pairing is not the contradictory one, and is accepted.
    expect((await get("/api/docs?parent=doc_mortgage&isParent=false")).status).toBe(200);
  });

  it("answers `isParent` over the wire, on both sides", async () => {
    // `th_one` is the workspace's only child; every other row is a root,
    // including `doc_note`, which nothing hangs off.
    const roots = DocListSchema.parse(await json("/api/docs?isParent=true"));
    expect(roots.items.map((item) => item.id).sort()).toEqual([
      "doc_mortgage",
      "doc_note",
      "doc_old",
    ]);
    expect(roots.page.total).toBe(3);

    const children = DocListSchema.parse(await json("/api/docs?isParent=false"));
    expect(children.items.map((item) => item.id)).toEqual(["th_one"]);
    expect(children.page.total).toBe(1);
  });

  it("runs one SELECT and one COUNT per request", async () => {
    const executed: string[] = [];
    const prepare = vi.spyOn(ws.db, "prepare").mockImplementation((sql: string) => {
      const statement = ws.db.sqlite.prepare(sql);
      // A counting stand-in rather than a Proxy: better-sqlite3's methods are
      // native and reject a foreign receiver.
      return {
        all: (...args: unknown[]) => {
          executed.push(sql);
          return statement.all(...args);
        },
        get: (...args: unknown[]) => {
          executed.push(sql);
          return statement.get(...args);
        },
      } as unknown as ReturnType<typeof ws.db.prepare>;
    });
    try {
      await json("/api/docs?q=escrow&type=note&tag=finance&folder=finance&sort=-updated");
    } finally {
      prepare.mockRestore();
    }
    expect(executed).toHaveLength(2);
    // The total, and only the total: `COUNT(*)` alone no longer separates the
    // two statements, because the page's `unreadThreads` column counts a
    // document's unread threads in a correlated subquery (CONTRACT-012). What
    // still separates them is which statement *is* a count — the aggregate is
    // the whole SELECT list there and a single column here.
    expect(executed.filter((sql) => sql.includes("SELECT COUNT(*) AS total"))).toHaveLength(1);
    expect(executed.filter((sql) => sql.includes("AS unread_threads"))).toHaveLength(1);
  });
});

describe("GET /api/tree", () => {
  it("answers a contract-shaped tree", async () => {
    const tree = FolderTreeSchema.parse(await json("/api/tree"));
    expect(tree.folders.map((node) => node.path)).toEqual(["finance", "inbox"]);
    // Two documents plus the thread on one of them (SPEC.md §11 folder scoping).
    expect(tree.folders[0]).toMatchObject({ name: "finance", count: 3, totalCount: 3 });
  });
});

describe("the bearer guard", () => {
  it.each(["/api/docs", "/api/tree"])(
    "refuses %s without a token, leaking nothing",
    async (path) => {
      const response = await get(path, {});
      expect(response.status).toBe(401);
      const body = await response.text();
      expect(ApiErrorSchema.parse(JSON.parse(body)).code).toBe("unauthorized");
      expect(body).not.toContain("finance");
      expect(body).not.toContain("total");
    },
  );
});

describe("without a projection", () => {
  it("does not mount the read routes at all", async () => {
    const bare = createServer(config(ws.config.workspaceRoot));
    try {
      const response = await bare.app.request("/api/docs", { headers: AUTH });
      expect(response.status).toBe(404);
    } finally {
      await bare.close();
    }
  });
});

describe("without an injected clock", () => {
  it("reads the wall clock, so `due=today` means today", async () => {
    const live = createServer(config(ws.config.workspaceRoot), { projection: ws.db });
    try {
      const response = await live.app.request("/api/docs?due=today", { headers: AUTH });
      expect(response.status).toBe(200);
      expect(DocListSchema.parse(await response.json()).page.total).toBe(0);
    } finally {
      await live.close();
    }
  });
});
