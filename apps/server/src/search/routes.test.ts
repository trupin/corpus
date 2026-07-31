import { join } from "node:path";
import { ApiErrorSchema, SearchResultsSchema } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const NOW = Date.parse("2026-07-26T12:00:00Z");

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

beforeAll(() => {
  ws = createWorkspace("search-routes");
  ws.doc({
    id: "doc_rates",
    path: "data/docs/finance/rates.md",
    title: "Rate guide",
    tags: ["finance"],
    body: "# Guide\n\n## Escrow\n\nThe escrow reserve is recalculated annually.\n",
  });
  ws.doc({
    id: "doc_archived",
    path: "data/docs/finance/archived.md",
    title: "Old escrow guidance",
    status: "archived",
    body: "Escrow, superseded.",
  });
  ws.reproject();

  server = createServer(config(ws.config.workspaceRoot), { projection: ws.db, now: () => NOW });
});

afterAll(async () => {
  await server.close();
  ws.close();
});

describe("GET /api/search", () => {
  it("answers ranked hits in the contract's shape", async () => {
    const response = await get("/api/search?q=escrow");
    expect(response.status).toBe(200);
    const results = SearchResultsSchema.parse(await response.json());
    expect(results.hits.map((hit) => hit.id)).toEqual(["doc_rates"]);
    const [hit] = results.hits;
    expect(hit?.title).toBe("Rate guide");
    expect(hit?.headingPath).toBe("Guide › Escrow");
    expect(hit?.snippet).toContain("recalculated annually");
    // The four fields the contract freezes, and no fifth.
    expect(Object.keys(hit ?? {}).sort()).toEqual(["headingPath", "id", "snippet", "title"]);
  });

  it("refuses a request with no query", async () => {
    const response = await get("/api/search");
    expect(response.status).toBe(400);
    expect(ApiErrorSchema.parse(await response.json()).code).toBe("bad_request");
  });

  it("refuses a limit beyond the retrieval cap", async () => {
    expect((await get("/api/search?q=escrow&limit=51")).status).toBe(400);
    expect((await get("/api/search?q=escrow&limit=50")).status).toBe(200);
  });

  it("ignores the list parameters it does not declare rather than rejecting them", async () => {
    // `pinned`, `sort` and `offset` are `GET /api/docs`'s; a ranked set has one
    // order and no pages, so the query schema strips them (CONTRACT-022).
    const response = await get("/api/search?q=escrow&sort=relevance&offset=10&pinned=true");
    expect(response.status).toBe(200);
    expect(SearchResultsSchema.parse(await response.json()).hits).toHaveLength(1);
  });

  it("applies the archived default and the flag that lifts it", async () => {
    const archivedOut = SearchResultsSchema.parse(await (await get("/api/search?q=escrow")).json());
    expect(archivedOut.hits.map((hit) => hit.id)).not.toContain("doc_archived");
    const widened = SearchResultsSchema.parse(
      await (await get("/api/search?q=escrow&includeArchived=true")).json(),
    );
    expect(widened.hits.map((hit) => hit.id)).toContain("doc_archived");
  });

  it("requires the bearer token like every other route", async () => {
    expect((await get("/api/search?q=escrow", {})).status).toBe(401);
  });
});
