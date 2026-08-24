import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApiErrorSchema,
  RETRIEVAL_DEFAULT_LIMIT,
  RelatedDocsSchema,
  RelatedQuerySchema,
  type RelatedDoc,
} from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { ONE_LINE_MAX_CHARS } from "../core/one-line.js";
import { HttpError } from "../errors.js";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { relatedDocs } from "./related.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const NOW = Date.parse("2026-07-26T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string =>
  new Date(NOW - days * MS_PER_DAY).toISOString().replace(/\.\d{3}Z$/, "Z");

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

const related = async (
  id: string,
  params: Readonly<Record<string, string>> = {},
): Promise<RelatedDoc[]> =>
  (await relatedDocs(ws.db, id, RelatedQuerySchema.parse(params))).related;

const ids = (rows: readonly RelatedDoc[]): string[] => rows.map((row) => row.id);

// ---------------------------------------------------------------------------
// The fixture graph, all around `doc_a`:
//
//   doc_a → doc_b          outgoing
//   doc_c → doc_a          incoming
//   doc_a ↔ doc_d          mutual
//   doc_a → doc_nope       dangling (no such document)
//   doc_a → doc_a          self-reference
//   doc_a → doc_arch       archived neighbour
//   th_ref → doc_a         written inside a thread *turn*
//   doc_e                  orphan, connected to nothing
// ---------------------------------------------------------------------------

beforeAll(() => {
  ws = createWorkspace("related");
  ws.doc({
    id: "doc_a",
    title: "Anchor document",
    body: "Refers to [[doc_b]], [[doc_d]], [[doc_nope]], [[doc_arch]] and itself [[doc_a]].",
    updated: daysAgo(1),
  });
  ws.doc({
    id: "doc_b",
    title: "Outgoing target",
    body: "  \n\nFirst line of the outgoing target.\nSecond line, which a one-line excerpt must fold in.\n",
    updated: daysAgo(2),
  });
  ws.doc({
    id: "doc_c",
    title: "Incoming source",
    body: "Points at [[doc_a]].",
    updated: daysAgo(3),
  });
  ws.doc({
    id: "doc_d",
    title: "Mutual partner",
    body: "Points back at [[doc_a]].",
    updated: daysAgo(9),
  });
  ws.doc({ id: "doc_e", title: "Orphan", body: "Connected to nothing.", updated: daysAgo(1) });
  ws.doc({
    id: "doc_arch",
    title: "Archived neighbour",
    status: "archived",
    body: "Archived, but still a real relation.",
    updated: daysAgo(4),
  });
  ws.thread({
    id: "th_ref",
    title: "Thread that refers",
    parent: "doc_e",
    turns: [{ author: "user", ts: daysAgo(5), body: "See [[doc_a]] for the reserve rules." }],
    updated: daysAgo(5),
  });
  ws.reproject();

  server = createServer(config(ws.config.workspaceRoot), { projection: ws.db, now: () => NOW });
});

afterAll(async () => {
  await server.close();
  ws.close();
});

describe("relatedDocs", () => {
  it("surfaces outgoing, incoming and mutual neighbours, and nothing else", async () => {
    const rows = await related("doc_a");
    expect(ids(rows)).toContain("doc_b");
    expect(ids(rows)).toContain("doc_c");
    expect(ids(rows)).toContain("doc_d");
    expect(ids(rows)).not.toContain("doc_e");
  });

  it("ranks a mutual link above a one-directional one, deterministically", async () => {
    const rows = await related("doc_a");
    // `doc_d` is mutual and the *least* recently updated of the three, so it can
    // only be first because reciprocity outranks recency.
    expect(ids(rows)[0]).toBe("doc_d");
    // The rest fall back to recency, then id.
    expect(ids(rows)).toEqual(["doc_d", "doc_b", "doc_c", "th_ref"]);
    expect(ids(await related("doc_a"))).toEqual(ids(await related("doc_a")));
  });

  it("never hands back a dangling reference", async () => {
    // `links` stores `doc_a → doc_nope` by design (SPEC.md §5); an id the agent
    // cannot then read is worse than no row.
    expect(
      ws.db.prepare("SELECT 1 FROM links WHERE from_id = 'doc_a' AND to_id = 'doc_nope'").get(),
    ).toBeDefined();
    expect(ids(await related("doc_a"))).not.toContain("doc_nope");
  });

  it("never relates a document to itself", async () => {
    expect(
      ws.db.prepare("SELECT 1 FROM links WHERE from_id = 'doc_a' AND to_id = 'doc_a'").get(),
    ).toBeDefined();
    expect(ids(await related("doc_a"))).not.toContain("doc_a");
  });

  it("includes a thread whose turn wrote the reference — a decision, not an accident", async () => {
    // `insertLinks` scans the body *plus every turn body*, so a `[[ref]]` typed
    // in a reply is a row keyed on the thread's own document id. A thread is a
    // document (SPEC.md §6) and is readable by the same `corpus doc show`, so
    // it is a row.
    expect(ids(await related("doc_a"))).toContain("th_ref");
    expect(
      ws.db.prepare("SELECT 1 FROM links WHERE from_id = 'th_ref' AND to_id = 'doc_a'").get(),
    ).toBeDefined();
  });

  it("excludes an archived neighbour by default and includes it with the flag", async () => {
    expect(ids(await related("doc_a"))).not.toContain("doc_arch");
    expect(ids(await related("doc_a", { includeArchived: "true" }))).toContain("doc_arch");
  });

  // Still `linked` and only `linked` here, and for a stronger reason than in
  // Phase A: this workspace has no semantic index, so the `similar` half
  // contributes nothing and every row is a reference-graph row. `both` and
  // `similar` are proved in `related-semantic.test.ts`, where there are vectors.
  it("labels every row of a lexical-only workspace `linked`, and only `linked`", async () => {
    for (const row of await related("doc_a", { includeArchived: "true" })) {
      expect(row.relation).toBe("linked");
    }
  });

  it("answers an empty set for a document nothing links to", async () => {
    expect(await related("doc_e")).toEqual([]);
  });

  it("throws the shipped 404 for an unknown id", async () => {
    await expect(related("doc_missing")).rejects.toThrow(HttpError);
    try {
      await related("doc_missing");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as HttpError).body).toEqual({
        code: "not_found",
        message: "no document with id doc_missing",
      });
    }
  });

  it("caps the result set, and defaults the cap to the frugal ten", async () => {
    expect(await related("doc_a", { limit: "1" })).toHaveLength(1);
    expect(RelatedQuerySchema.parse({}).limit).toBe(RETRIEVAL_DEFAULT_LIMIT);
  });
});

describe("excerpts", () => {
  it("is one line derived from the projection, never the stored multi-line slice", async () => {
    const stored = (
      ws.db.prepare("SELECT body_excerpt FROM documents WHERE id = 'doc_b'").get() as {
        body_excerpt: string;
      }
    ).body_excerpt;
    const row = (await related("doc_a")).find((candidate) => candidate.id === "doc_b");

    // The stored column spans lines and starts at the first non-blank
    // character; the row's excerpt is that text folded onto one line.
    expect(stored).toContain("\n");
    expect(row?.excerpt).not.toContain("\n");
    expect(row?.excerpt).toBe(
      "First line of the outgoing target. Second line, which a one-line excerpt must fold in.",
    );
  });

  it("never carries a body, however long the neighbour is", async () => {
    const big = createWorkspace("related-large");
    try {
      big.doc({ id: "doc_from", body: "Points at [[doc_big]]." });
      big.doc({
        id: "doc_big",
        title: "Huge neighbour",
        body: `# Huge\n\n${"Ledger detail paragraph. ".repeat(400)}`,
      });
      big.reproject();

      const results = await relatedDocs(big.db, "doc_from", RelatedQuerySchema.parse({}));
      const serialized = JSON.stringify(results);
      expect(RelatedDocsSchema.parse(results)).toEqual(results);
      expect(results.related[0]?.excerpt.length).toBeLessThanOrEqual(ONE_LINE_MAX_CHARS);
      expect(serialized.length).toBeLessThan(400);
      for (const row of results.related) {
        expect(Object.keys(row).sort()).toEqual(["excerpt", "id", "relation", "title"]);
      }
    } finally {
      big.close();
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-883 / TEST-930, related's half. `phase-a-related.snapshot.json` was
// captured from the shipped Phase A `relatedDocs` over this exact fixture graph
// before SERVER-045 touched it: every row, every position, every relation, every
// one-line excerpt. The only permitted delta is the newly-present
// `semanticIndex`, stripped before comparison and asserted to be `disabled`.
// ---------------------------------------------------------------------------

describe("Phase A byte-stability", () => {
  const snapshot = JSON.parse(
    readFileSync(new URL("./phase-a-related.snapshot.json", import.meta.url), "utf8"),
  ) as Record<string, { related: RelatedDoc[] }>;

  it.each(Object.keys(snapshot))("answers %s exactly as Phase A did", async (key) => {
    const [id = "", queryString = ""] = key.split("?");
    const params = Object.fromEntries(new URLSearchParams(queryString));
    const results = await relatedDocs(ws.db, id, RelatedQuerySchema.parse(params));

    const { semanticIndex, ...rest } = results;
    expect(semanticIndex).toBe("disabled");
    expect(JSON.stringify(rest)).toBe(JSON.stringify(snapshot[key]));
  });

  it("covers the whole fixture graph, not a lucky subset", () => {
    expect(Object.keys(snapshot).length).toBeGreaterThanOrEqual(5);
    expect(Object.values(snapshot).some((entry) => entry.related.length > 2)).toBe(true);
  });
});

describe("GET /api/docs/{id}/related", () => {
  const get = async (path: string, init: RequestInit = { headers: AUTH }): Promise<Response> =>
    server.app.request(path, init);

  it("reaches the related handler rather than the document read", async () => {
    const response = await get("/api/docs/doc_a/related");
    expect(response.status).toBe(200);
    const body = RelatedDocsSchema.parse(await response.json());
    expect(body.related.map((row) => row.id)).toEqual(["doc_d", "doc_b", "doc_c", "th_ref"]);
    // Phase A pinned this field's *absence* here (`toBeUndefined`), deliberately:
    // emitting a value would have been Phase B leaking early. SERVER-045 is
    // Phase B, so the assertion inverts (sprint-021 premise correction C4) — the
    // related envelope now carries the same one-word claim the search envelope
    // does, and `disabled` is the honest claim for a workspace with no index.
    expect(body.semanticIndex).toBe("disabled");
  });

  it("answers the shipped 404 shape for an unknown document", async () => {
    const response = await get("/api/docs/doc_missing/related");
    expect(response.status).toBe(404);
    expect(ApiErrorSchema.parse(await response.json())).toEqual({
      code: "not_found",
      message: "no document with id doc_missing",
    });
  });

  it("takes the archived flag and the limit over the wire", async () => {
    const widened = RelatedDocsSchema.parse(
      await (await get("/api/docs/doc_a/related?includeArchived=true&limit=2")).json(),
    );
    expect(widened.related).toHaveLength(2);
    const all = RelatedDocsSchema.parse(
      await (await get("/api/docs/doc_a/related?includeArchived=true")).json(),
    );
    expect(all.related.map((row) => row.id)).toContain("doc_arch");
  });

  it("refuses a limit beyond the retrieval cap", async () => {
    expect((await get("/api/docs/doc_a/related?limit=51")).status).toBe(400);
    expect((await get("/api/docs/doc_a/related?limit=50")).status).toBe(200);
  });

  it("requires the bearer token like every other route", async () => {
    expect((await get("/api/docs/doc_a/related", {})).status).toBe(401);
  });
});

/**
 * SERVER-144, on the §7 rider signed 2026-08-24. Measured on a fresh workspace
 * in the SHARED-070 audit: the #1 related document for a user's mortgage note
 * was `doc_skillorchestrate`.
 *
 * Unlike `/api/search`, this route declares no `type` parameter to defer to, so
 * the exclusion is unconditional — and it is the **wider** list, because a
 * neighbour is an answer to "what else bears on this?" and a stored query bears
 * on nothing. `template` is in neither list: it is the user's own writing.
 */
describe("the product's own machinery is never a neighbour (SERVER-144)", () => {
  let machinery: Workspace;

  const neighbours = async (id: string): Promise<string[]> =>
    (await relatedDocs(machinery.db, id, RelatedQuerySchema.parse({}))).related.map(
      (row) => row.id,
    );

  beforeAll(() => {
    machinery = createWorkspace("s144-related");
    machinery.doc({
      id: "doc_subject",
      title: "Mortgage",
      body: "Refers to [[doc_skill01]], [[doc_agent01]], [[doc_tpl01]], [[doc_view01]], [[doc_brd01]] and [[doc_peer01]].",
    });
    machinery.doc({ id: "doc_peer01", title: "Peer note", body: "An ordinary note." });
    machinery.doc({
      id: "doc_skill01",
      path: ".claude/skills/comment/SKILL.md",
      title: "Comment",
      body: "The skill.",
    });
    machinery.doc({
      id: "doc_agent01",
      path: ".claude/agents/resident.md",
      title: "Resident",
      body: "The agent definition.",
    });
    machinery.doc({ id: "doc_tpl01", type: "template", title: "Template", body: "A template." });
    machinery.doc({ id: "doc_view01", type: "view", title: "A view", body: "A stored query." });
    machinery.doc({ id: "doc_brd01", type: "board", title: "A board", body: "A column list." });
    machinery.reproject();
  });

  afterAll(() => {
    machinery.close();
  });

  it("answers with the corpus and not with the machinery", async () => {
    expect((await neighbours("doc_subject")).sort()).toEqual(["doc_peer01", "doc_tpl01"]);
  });

  it("keeps a template, which the user wrote", async () => {
    // The rider's carve-out, pinned on the neighbour surface too: the wider
    // list adds `view` and `board`, never `template`.
    expect(await neighbours("doc_subject")).toContain("doc_tpl01");
  });

  it("still answers for a skill as the subject, which is looked up by id", async () => {
    // The exclusion is about neighbours. `doc related` on a skill keeps
    // working; it simply reports the documents that refer to it.
    expect(await neighbours("doc_skill01")).toEqual(["doc_subject"]);
  });
});
