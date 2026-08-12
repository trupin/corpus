// `GET /api/threads/{id}/context` — the bounded context pack (SPEC.md §7, §9.2;
// sprint-022 TEST-956…981).
//
// Every fixture below is a real workspace on disk projected by the real
// projector, so `anchors.resolved_offset` is whatever `resolveAnchorExact`
// actually decided rather than a hand-written row — which is the whole substance
// of the anchored/orphaned split. Vector distances are hand-set for the reason
// `search/hybrid.test.ts` records: a relatedness test that asked a model which
// document is nearer would re-assert the model on every run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTEXT_MAX_EXCERPT_CHARS,
  CONTEXT_MAX_EXCERPTS,
  CONTEXT_MAX_QUOTE_CHARS,
  CONTEXT_MAX_SECTION_CHARS,
  ContextPackSchema,
  HEADING_PATH_SEPARATOR,
  RelatedQuerySchema,
  SearchQuerySchema,
  type ContextPack,
} from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type CorpusServer } from "../app.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import type { ServerConfig } from "../config.js";
import { headingSections } from "../core/headings.js";
import { parseDocument } from "../core/index.js";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { relatedDocs } from "../docs/index.js";
import { createRecordingCommitter } from "../git/git-fixture.js";
import { silentLogger } from "../logger.js";
import { createProjectionQueueMirror, type ProjectionDb } from "../projection/index.js";
import { searchCorpus } from "../search/index.js";
import {
  CHUNK_CHAR_BUDGET,
  createSemanticRetrieval,
  loadSemanticOnlyHits,
  type SemanticRetrieval,
} from "../semantic/index.js";
import { embedDocuments, stubResolution } from "../semantic/vector-fixture.js";
import { threadContextPack, type ContextDeps } from "./context.js";
import type { ThreadReader } from "./read.js";

const NOW = Date.parse("2026-08-01T12:00:00Z");
const IDENTITY = "stub/fixture@2";
const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };

let ws: Workspace;

const reader = (workspace: Workspace = ws): ThreadReader => ({
  workspaceRoot: workspace.config.workspaceRoot,
  projection: workspace.db,
  now: () => NOW,
});

/**
 * Every pack this suite produces is fed through the contract's own schema before
 * a single field is asserted — TEST-970's self-parse, applied to all of them
 * rather than to one, because `strictObject` is what catches a pack claiming one
 * shape while carrying another's fields.
 */
const pack = async (id: string, deps: ContextDeps = {}): Promise<ContextPack> => {
  const result = await threadContextPack(reader(), id, deps);
  const parsed = ContextPackSchema.safeParse(result);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success && parsed.data).toEqual(result);
  return result;
};

const excerptIds = (result: ContextPack): string[] => result.excerpts.map((row) => row.id);

const relationOf = (result: ContextPack, id: string): string | undefined =>
  result.excerpts.find((row) => row.id === id)?.relation;

/** The body of a workspace document, parsed the way the server parses it. */
const bodyOf = (id: string): string =>
  parseDocument(readFileSync(join(ws.config.workspaceRoot, "data", "docs", `${id}.md`), "utf8"))
    .body;

// ---------------------------------------------------------------------------
// The fixture corpus.
//
//   doc_parent  — four heading sections; `anc_one` sits mid-way through the
//                 escrow section, which also cites doc_cited
//   doc_cited   — linked from doc_parent, semantically distant
//   doc_twin    — no link, no shared keyword, near the *turn* topic
//   doc_both    — cited by the standalone thread's own turn *and* near
//   doc_far     — neither
//   doc_arch    — archived and near
//   doc_gapped  — no preamble, for the whole-document opening rule
// ---------------------------------------------------------------------------

const PARENT_BODY = `Preamble sentence that opens the parent document.

# Mortgage

Intro under the top-level heading.

## Rates

Rates are reviewed each quarter.

## Escrow

The escrow reserve is recalculated annually under fixed terms. See [[doc_cited]].

A second paragraph inside the escrow section, so the anchor is not the whole of it.

## Fees

Fees are billed quarterly.
`;

/** Unique in `PARENT_BODY`, so exact-only resolution has one candidate. */
const ANCHOR_EXACT = "recalculated annually under fixed terms";

const paragraphs = (count: number, word: string): string =>
  Array.from(
    { length: count },
    (_, index) => `${word} paragraph ${String(index)} carries filler prose that pads the section.`,
  ).join("\n\n");

const seedCorpus = (workspace: Workspace): void => {
  workspace.doc({
    id: "doc_parent",
    title: "Mortgage options",
    body: PARENT_BODY,
    anchors: { anc_one: { exact: ANCHOR_EXACT } },
  });
  workspace.doc({
    id: "doc_cited",
    title: "Cabinet delivery",
    body: "Cabinets arrive on Tuesday.",
  });
  workspace.doc({
    id: "doc_twin",
    title: "Heating replacement",
    body: "## Boilers\n\nThe boiler swap is scheduled before the cold snap.\n",
  });
  workspace.doc({
    id: "doc_both",
    title: "Trading update",
    body: "The trading update was published.",
  });
  workspace.doc({
    id: "doc_far",
    title: "Bicycle maintenance",
    body: "Chain lubrication schedule.",
  });
  workspace.doc({
    id: "doc_arch",
    title: "Archived escrow memo",
    status: "archived",
    body: "Escrow memo, archived.",
  });
  workspace.doc({
    id: "doc_gapped",
    title: "Renovation plan",
    body: "# Scope\n\nThe scope covers the kitchen only.\n\n## Budget\n\nBudget is fixed.\n",
  });

  workspace.thread({
    id: "th_anchored",
    title: "About the escrow reserve",
    parent: "doc_parent",
    anchor: "anc_one",
    turns: [
      { author: "user", ts: "2026-07-30T09:00:00Z", body: "Does the boiler swap affect it?" },
    ],
  });
  workspace.thread({
    id: "th_whole",
    title: "About the document",
    parent: "doc_parent",
    turns: [{ author: "user", ts: "2026-07-30T09:05:00Z", body: "Is this still current?" }],
  });
  workspace.thread({
    id: "th_solo",
    title: "A standalone question",
    turns: [
      {
        author: "user",
        ts: "2026-07-30T09:10:00Z",
        body: "What did we decide about [[doc_both]]?",
      },
    ],
  });
  workspace.thread({
    id: "th_gone",
    title: "About a deleted document",
    parent: "doc_deleted",
    turns: [{ author: "user", ts: "2026-07-30T09:15:00Z", body: "Where did it go?" }],
  });
  workspace.reproject();
};

beforeEach(() => {
  ws = createWorkspace("s022-context");
  seedCorpus(ws);
});

afterEach(() => {
  ws.close();
});

// ---------------------------------------------------------------------------
// The five shapes (TEST-956…962)
// ---------------------------------------------------------------------------

describe("the five thread shapes", () => {
  it("TEST-956 — an anchored thread names the quote and the WHOLE enclosing section", async () => {
    const result = await pack("th_anchored");
    if (result.shape !== "anchored") throw new Error(`expected anchored, got ${result.shape}`);

    const body = bodyOf("doc_parent");
    const offset = body.indexOf(ANCHOR_EXACT);
    const section = headingSections(body).find(
      (candidate) => offset >= candidate.start && offset < candidate.end,
    );
    expect(section).toBeDefined();

    expect(result.parent.quote).toBe(ANCHOR_EXACT);
    // The definition, compared byte for byte against the file on disk.
    expect(result.parent.section).toBe(body.slice(section?.start ?? 0, section?.end ?? 0));
    expect(result.parent.section.startsWith("## Escrow")).toBe(true);
    expect(result.parent.section).toContain("A second paragraph inside the escrow section");
    expect(result.parent.section).not.toContain("Fees are billed quarterly");
    expect(result.parent.truncated).toBe(false);
    expect(result.parent.id).toBe("doc_parent");
    expect(result.parent.title).toBe("Mortgage options");
    expect(result.parent.headingPath).toBe(`Mortgage${HEADING_PATH_SEPARATOR}Escrow`);
  });

  it("TEST-960 — a whole-document thread gets the title and the opening content", async () => {
    const result = await pack("th_whole");
    if (result.shape !== "whole-document") throw new Error(`got ${result.shape}`);

    const body = bodyOf("doc_parent");
    const preamble = headingSections(body)[0];
    expect(result.parent).toEqual({
      id: "doc_parent",
      title: "Mortgage options",
      opening: body.slice(preamble?.start ?? 0, preamble?.end ?? 0),
      truncated: false,
    });
    expect(result.parent.opening).toContain("Preamble sentence that opens the parent document.");
    // Not `body_excerpt`, which would run 280 raw characters past the preamble.
    expect(result.parent.opening).not.toContain("# Mortgage");
  });

  it("TEST-960 — a document with no preamble opens at its first section", async () => {
    ws.thread({ id: "th_gap", title: "On the plan", parent: "doc_gapped" });
    ws.reproject();

    const result = await pack("th_gap");
    if (result.shape !== "whole-document") throw new Error(`got ${result.shape}`);
    expect(result.parent.opening.startsWith("# Scope")).toBe(true);
    expect(result.parent.opening).toContain("The scope covers the kitchen only.");
    expect(result.parent.opening).not.toContain("## Budget");
  });

  it("TEST-961 — a standalone thread's pack has no parent block at all", async () => {
    const result = await pack("th_solo");

    expect(result.shape).toBe("standalone");
    expect("parent" in result).toBe(false);
    expect("deletedParent" in result).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["excerpts", "semanticIndex", "shape", "threadId"]);
  });

  it("TEST-958/959 — an anchor that no longer resolves verbatim reads as orphaned", async () => {
    ws.doc({
      id: "doc_moved",
      title: "Moved passage",
      body: "The passage was rewritten and no longer says what it did.\n",
      anchors: { anc_two: { exact: "a sentence that is no longer present" } },
    });
    ws.thread({
      id: "th_orphan",
      title: "On the moved passage",
      parent: "doc_moved",
      anchor: "anc_two",
    });
    ws.reproject();

    // The projection agrees: exact-only resolution left the offset NULL.
    const row = ws.db
      .prepare("SELECT resolved_offset FROM anchors WHERE doc_id = ? AND anchor_id = ?")
      .get("doc_moved", "anc_two") as { resolved_offset: number | null };
    expect(row.resolved_offset).toBeNull();

    const result = await pack("th_orphan");
    if (result.shape !== "orphaned-anchor") throw new Error(`got ${result.shape}`);
    expect(result.parent).toEqual({
      id: "doc_moved",
      title: "Moved passage",
      quote: "a sentence that is no longer present",
      truncated: false,
    });
    expect("section" in result.parent).toBe(false);
    expect("headingPath" in result.parent).toBe(false);
  });

  it("TEST-958 — a near-miss selector is NOT rescued by a fuzzy ladder", async () => {
    // One character different from a passage that *is* in the body: a fuzzy rung
    // would happily attach this, and attaching it is the misattachment
    // SERVER-002 was fixed to prevent.
    ws.doc({
      id: "doc_near",
      title: "Near miss",
      body: "The escrow reserve is recalculated annually under fixed terms.\n",
      anchors: {
        anc_three: { exact: "The escrow reserve is recalculated annually under fixed termz" },
      },
    });
    ws.thread({ id: "th_near", title: "Near", parent: "doc_near", anchor: "anc_three" });
    ws.reproject();

    expect((await pack("th_near")).shape).toBe("orphaned-anchor");
  });

  it("TEST-962 — a thread whose parent was deleted answers with the parent-deleted shape", async () => {
    const result = await pack("th_gone");

    if (result.shape !== "parent-deleted") throw new Error(`got ${result.shape}`);
    expect(result.deletedParent).toBe("doc_deleted");
    expect("parent" in result).toBe(false);
    expect(result.threadId).toBe("th_gone");
  });

  it("an anchor the parent's frontmatter no longer carries is orphaned, not anchored", async () => {
    ws.doc({ id: "doc_bare", title: "No anchors", body: "Plain body.\n" });
    ws.thread({ id: "th_bare", title: "Dangling", parent: "doc_bare", anchor: "anc_gone" });
    ws.reproject();

    const result = await pack("th_bare");
    if (result.shape !== "orphaned-anchor") throw new Error(`got ${result.shape}`);
    // §6 keeps the quote; it cannot invent one that was never recorded.
    expect(result.parent.quote).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The parent-side bound (TEST-957, Open Conflict 1)
// ---------------------------------------------------------------------------

describe("the parent-side bound", () => {
  const ANCHOR_LINE = "The anchor phrase lives here for certain.";

  it("TEST-957 — a section larger than one chunk comes back whole, not chunk-shaped", async () => {
    const body = `# Head\n\nOpening.\n\n## Long\n\n${ANCHOR_LINE}\n\n${paragraphs(45, "Escrow")}\n`;
    expect(body.length).toBeGreaterThan(CHUNK_CHAR_BUDGET);
    expect(body.length).toBeLessThan(CONTEXT_MAX_SECTION_CHARS);
    ws.doc({
      id: "doc_long",
      title: "Long section",
      body,
      anchors: { anc_l: { exact: ANCHOR_LINE } },
    });
    ws.thread({ id: "th_long", title: "On the long section", parent: "doc_long", anchor: "anc_l" });
    ws.reproject();

    // The chunker really did split it — otherwise this test proves nothing.
    const chunks = ws.db
      .prepare("SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?")
      .get("doc_long") as { n: number };
    expect(chunks.n).toBeGreaterThan(1);

    const result = await pack("th_long");
    if (result.shape !== "anchored") throw new Error(`got ${result.shape}`);
    const fileBody = bodyOf("doc_long");
    const offset = fileBody.indexOf(ANCHOR_LINE);
    const section = headingSections(fileBody).find(
      (candidate) => offset >= candidate.start && offset < candidate.end,
    );
    expect(result.parent.section).toBe(fileBody.slice(section?.start ?? 0, section?.end ?? 0));
    expect(result.parent.section.length).toBeGreaterThan(CHUNK_CHAR_BUDGET);
    // The failure signature `CONTEXT_MAX_SECTION_CHARS` was chosen away from.
    expect(result.parent.section.length).not.toBe(CHUNK_CHAR_BUDGET);
    expect(result.parent.truncated).toBe(false);
  });

  it("TEST-957 — a section past the cap is truncated around the anchor and says so", async () => {
    const filler = paragraphs(60, "Escrow");
    const body = `## Long\n\n${filler}\n\n${ANCHOR_LINE}\n\n${filler}\n`;
    expect(body.length).toBeGreaterThan(CONTEXT_MAX_SECTION_CHARS);
    ws.doc({
      id: "doc_huge",
      title: "Huge section",
      body,
      anchors: { anc_h: { exact: ANCHOR_LINE } },
    });
    ws.thread({ id: "th_huge", title: "On the huge section", parent: "doc_huge", anchor: "anc_h" });
    ws.reproject();

    const result = await pack("th_huge");
    if (result.shape !== "anchored") throw new Error(`got ${result.shape}`);
    expect(result.parent.section.length).toBe(CONTEXT_MAX_SECTION_CHARS);
    expect(result.parent.truncated).toBe(true);
    // Anchored on the anchor: the quote and both its neighbourhoods survive.
    const at = result.parent.section.indexOf(ANCHOR_LINE);
    expect(at).toBeGreaterThan(CONTEXT_MAX_SECTION_CHARS / 4);
    expect(at).toBeLessThan((CONTEXT_MAX_SECTION_CHARS * 3) / 4);
  });

  it("truncates the quote to its own cap and flags the parent block", async () => {
    const quote = `Q${"o".repeat(CONTEXT_MAX_QUOTE_CHARS + 40)}Z`;
    ws.doc({
      id: "doc_quote",
      title: "Long quote",
      body: `Before.\n\n${quote}\n\nAfter.\n`,
      anchors: { anc_q: { exact: quote } },
    });
    ws.thread({ id: "th_quote", title: "On the long quote", parent: "doc_quote", anchor: "anc_q" });
    ws.reproject();

    const result = await pack("th_quote");
    if (result.shape !== "anchored") throw new Error(`got ${result.shape}`);
    expect(result.parent.quote.length).toBe(CONTEXT_MAX_QUOTE_CHARS);
    expect(result.parent.quote).toBe(quote.slice(0, CONTEXT_MAX_QUOTE_CHARS));
    expect(result.parent.truncated).toBe(true);
  });

  it("bounds a whole-document opening at the same cap, on a line boundary", async () => {
    ws.doc({
      id: "doc_pre",
      title: "Long preamble",
      body: `${paragraphs(120, "Opening")}\n\n# Later\n\nTail.\n`,
    });
    ws.thread({ id: "th_pre", title: "On the preamble", parent: "doc_pre" });
    ws.reproject();

    const result = await pack("th_pre");
    if (result.shape !== "whole-document") throw new Error(`got ${result.shape}`);
    expect(result.parent.opening.length).toBeLessThanOrEqual(CONTEXT_MAX_SECTION_CHARS);
    expect(result.parent.truncated).toBe(true);
    // Cut on a line boundary, so the last unit of prose is whole.
    expect(result.parent.opening.trimEnd().endsWith("pads the section.")).toBe(true);
    expect(result.parent.opening).not.toContain("# Later");
  });
});

// ---------------------------------------------------------------------------
// The related half (TEST-963…971)
// ---------------------------------------------------------------------------

const retrievalOver = (
  workspace: Workspace,
  embed: (text: string) => readonly number[],
  onEmbed?: (text: string) => void,
): SemanticRetrieval =>
  createSemanticRetrieval({
    db: workspace.db,
    settings: { kind: "absent" },
    logger: silentLogger,
    resolve: () =>
      Promise.resolve(
        stubResolution(IDENTITY, { embed, ...(onEmbed === undefined ? {} : { onEmbed }) }),
      ),
  });

/** The turn-aligned direction; `[1, 0]` documents are orthogonal to it. */
const TURN_WARD = () => [0, 1];

describe("the related half", () => {
  beforeEach(() => {
    embedDocuments(ws.db, IDENTITY, {
      doc_parent: [1, 0],
      doc_cited: [1, 0],
      doc_twin: [0.1, 0.995],
      doc_both: [0.2, 0.98],
      doc_far: [1, 0],
      doc_arch: [0.15, 0.99],
      doc_gapped: [1, 0],
    });
  });

  it("TEST-963 — ranks against the anchor AND the thread's text", async () => {
    const embedded: string[] = [];
    const semantic = retrievalOver(ws, TURN_WARD, (text) => embedded.push(text));

    const result = await pack("th_anchored", { semantic });

    expect(embedded).toHaveLength(1);
    expect(embedded[0]).toContain(ANCHOR_EXACT);
    expect(embedded[0]).toContain("Does the boiler swap affect it?");
    expect(embedded[0]).toContain("About the escrow reserve");
    // A document that matches only what the turns discuss is reachable…
    expect(excerptIds(result)).toContain("doc_twin");
    // …and one that matches neither the anchor nor the turns is not.
    expect(excerptIds(result)).not.toContain("doc_far");
  });

  it("TEST-967 — relations come from the two graphs, using the frozen enum", async () => {
    const result = await pack("th_anchored", { semantic: retrievalOver(ws, TURN_WARD) });

    expect(relationOf(result, "doc_cited")).toBe("linked");
    expect(relationOf(result, "doc_twin")).toBe("similar");
    expect(
      result.excerpts.every((row) => ["linked", "similar", "both"].includes(row.relation)),
    ).toBe(true);
  });

  it("TEST-967 — `both` is produced by a document that is genuinely both", async () => {
    const result = await pack("th_solo", { semantic: retrievalOver(ws, TURN_WARD) });

    // The standalone thread's own turn cites doc_both, and doc_both is near.
    expect(relationOf(result, "doc_both")).toBe("both");
  });

  it("TEST-966 — a semantically promoted row is addressed by the chunk that matched", async () => {
    const result = await pack("th_anchored", { semantic: retrievalOver(ws, TURN_WARD) });

    const twin = result.excerpts.find((row) => row.id === "doc_twin");
    expect(twin?.headingPath).toBe("Boilers");
    expect(twin?.excerpt).toContain("The boiler swap is scheduled before the cold snap.");
  });

  it("TEST-966 — a links-only row falls back to §9.2's floor, the document's title", async () => {
    const result = await pack("th_anchored");

    expect(result.excerpts.find((row) => row.id === "doc_cited")).toEqual({
      id: "doc_cited",
      headingPath: "Cabinet delivery",
      excerpt: "Cabinets arrive on Tuesday.",
      relation: "linked",
    });
  });

  it("Open Conflict 2 — the links half is the union of the thread's rows and the parent's", async () => {
    ws.thread({
      id: "th_union",
      title: "Union",
      parent: "doc_parent",
      anchor: "anc_one",
      turns: [{ author: "user", ts: "2026-07-30T10:00:00Z", body: "Compare with [[doc_far]]." }],
    });
    ws.reproject();

    // doc_cited comes from the parent's body, doc_far from the thread's own turn.
    expect(excerptIds(await pack("th_union")).sort()).toEqual(["doc_cited", "doc_far"]);
  });

  it("TEST-969 — the pack never contains the thread or its parent", async () => {
    // `[1, 0]` is doc_parent's own direction, so nothing but the exclusion keeps
    // it out of the two packs whose parent it is.
    const semantic = retrievalOver(ws, () => [1, 0]);
    for (const [id, parent] of [
      ["th_anchored", "doc_parent"],
      ["th_whole", "doc_parent"],
      ["th_solo", null],
      ["th_gone", "doc_deleted"],
    ] as const) {
      const ids = excerptIds(await pack(id, { semantic }));
      expect(ids).not.toContain(id);
      if (parent !== null) expect(ids).not.toContain(parent);
    }
    // The control: doc_parent *is* reachable for a thread it does not parent.
    expect(excerptIds(await pack("th_solo", { semantic }))).toContain("doc_parent");
  });

  it("TEST-968 — the archived default holds on both halves, through one fragment", async () => {
    ws.doc({
      id: "doc_archlink",
      title: "Archived and cited",
      status: "archived",
      body: "Cites nothing.",
    });
    ws.doc({
      id: "doc_holder",
      title: "Cites the archived one",
      body: "See [[doc_archlink]] and [[doc_cited]].",
    });
    ws.thread({ id: "th_arch", title: "On archived", parent: "doc_holder" });
    ws.reproject();
    embedDocuments(ws.db, IDENTITY, { doc_arch: [0.15, 0.99] });

    const ids = excerptIds(await pack("th_arch", { semantic: retrievalOver(ws, TURN_WARD) }));

    expect(ids).not.toContain("doc_archlink");
    expect(ids).not.toContain("doc_arch");
    expect(ids).toContain("doc_cited");
  });

  it("TEST-971 — an oversized excerpt is truncated to the cap, not dropped", async () => {
    ws.doc({
      id: "doc_verbose",
      title: "Verbose",
      body: `## Boilers\n\n${paragraphs(6, "Boiler")}\n`,
    });
    ws.reproject();
    embedDocuments(ws.db, IDENTITY, { doc_verbose: [0, 1] });

    const result = await pack("th_anchored", { semantic: retrievalOver(ws, TURN_WARD) });

    const row = result.excerpts.find((entry) => entry.id === "doc_verbose");
    expect(row).toBeDefined();
    expect(row?.excerpt.length).toBeLessThanOrEqual(CONTEXT_MAX_EXCERPT_CHARS);
    expect(row?.excerpt.length).toBeGreaterThan(200);
    expect(row?.excerpt).toContain("Boiler paragraph 0");
  });

  it("TEST-970 — bounds are enforced by rank-then-cut over a corpus past every cap", async () => {
    const vectors: Record<string, readonly number[]> = {};
    for (let index = 0; index < 40; index += 1) {
      const id = `doc_bulk${String(index).padStart(3, "0")}`;
      ws.doc({ id, title: `Bulk ${String(index)}`, body: `Boiler bulk body ${String(index)}.` });
      // Strictly decreasing similarity, so the best-ranked set is known.
      vectors[id] = [index / 200, 1];
    }
    ws.reproject();
    embedDocuments(ws.db, IDENTITY, vectors);

    const result = await pack("th_solo", { semantic: retrievalOver(ws, TURN_WARD) });

    expect(result.excerpts).toHaveLength(CONTEXT_MAX_EXCERPTS);
    for (const row of result.excerpts) {
      expect(row.excerpt.length).toBeLessThanOrEqual(CONTEXT_MAX_EXCERPT_CHARS);
    }
    // Ranked first, cut second: the survivors are the nearest bulk documents,
    // not the ones the scan happened to read first.
    const bulk = excerptIds(result).filter((id) => id.startsWith("doc_bulk"));
    expect(bulk[0]).toBe("doc_bulk000");
    expect(bulk).toEqual([...bulk].sort());
  });

  it("empty when nothing relates, which is an answer rather than an error", async () => {
    ws.doc({ id: "doc_island", title: "Island", body: "Nothing cites this." });
    ws.thread({ id: "th_island", title: "Island thread", parent: "doc_island" });
    ws.reproject();

    expect((await pack("th_island")).excerpts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The degrade word (TEST-973…976)
// ---------------------------------------------------------------------------

describe("the semantic degrade", () => {
  it("TEST-975 — no semantic half at all is links-only and `disabled`", async () => {
    const result = await pack("th_anchored");

    expect(result.semanticIndex).toBe("disabled");
    expect(excerptIds(result)).toEqual(["doc_cited"]);
  });

  it("TEST-974 — a provider that throws degrades the pack, never its status code", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_twin: [0, 1] });
    const semantic = retrievalOver(ws, () => {
      throw new Error("provider exploded");
    });

    const result = await pack("th_anchored", { semantic });

    expect(result.semanticIndex).toBe("disabled");
    expect(excerptIds(result)).toEqual(["doc_cited"]);
  });

  it("TEST-973 — the pack, search and related report the same word for one workspace", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_twin: [0, 1] });
    const semantic = retrievalOver(ws, TURN_WARD);

    const briefing = await pack("th_anchored", { semantic });
    const searched = await searchCorpus(ws.db, SearchQuerySchema.parse({ q: "escrow" }), NOW, {
      semantic,
    });
    const neighbours = await relatedDocs(ws.db, "doc_parent", RelatedQuerySchema.parse({}), {
      semantic,
    });

    expect(briefing.semanticIndex).toBe(searched.semanticIndex);
    expect(briefing.semanticIndex).toBe(neighbours.semanticIndex);
    expect(briefing.semanticIndex).toBe("stale");
  });

  it("a fully-embedded workspace reports `current` on the pack too", async () => {
    const docIds = ws.db.prepare("SELECT DISTINCT doc_id FROM chunks").all() as {
      doc_id: string;
    }[];
    embedDocuments(
      ws.db,
      IDENTITY,
      Object.fromEntries(docIds.map((row) => [row.doc_id, [0, 1] as readonly number[]])),
    );

    expect(
      (await pack("th_anchored", { semantic: retrievalOver(ws, TURN_WARD) })).semanticIndex,
    ).toBe("current");
  });

  it("TEST-976 — the semantic half is read per request, so a late provider is picked up", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_twin: [0, 1] });
    let downloaded = false;
    const semantic = createSemanticRetrieval({
      db: ws.db,
      settings: { kind: "absent" },
      logger: silentLogger,
      cooldownMs: 0,
      resolve: () =>
        Promise.resolve(
          downloaded
            ? stubResolution(IDENTITY, { embed: TURN_WARD })
            : {
                kind: "disabled" as const,
                reason: "model-not-downloaded" as const,
                detail: "still downloading",
              },
        ),
    });

    const first = await pack("th_anchored", { semantic });
    expect(first.semanticIndex).toBe("disabled");
    expect(excerptIds(first)).not.toContain("doc_twin");

    downloaded = true;
    const second = await pack("th_anchored", { semantic });
    expect(excerptIds(second)).toContain("doc_twin");
  });
});

// ---------------------------------------------------------------------------
// Cost (TEST-972)
// ---------------------------------------------------------------------------

describe("the pack's cost", () => {
  /** Counts statements the way `search.ts`'s `loadAddresses` seam is counted. */
  const counting = (db: ProjectionDb, tally: { count: number }): ProjectionDb =>
    new Proxy(db, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            tally.count += 1;
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property, target) as unknown;
      },
    });

  it("TEST-972 — the statement count does not grow with the corpus", async () => {
    const measure = async (bulk: number): Promise<{ statements: number; size: number }> => {
      ws.close();
      ws = createWorkspace("s022-cost");
      seedCorpus(ws);
      for (let index = 0; index < bulk; index += 1) {
        ws.doc({
          id: `doc_n${String(index).padStart(4, "0")}`,
          title: `Note ${String(index)}`,
          body: `Escrow note ${String(index)} mentions [[doc_parent]].`,
        });
      }
      ws.reproject();

      const tally = { count: 0 };
      const probe: ThreadReader = { ...reader(), projection: counting(ws.db, tally) };
      const result = await threadContextPack(probe, "th_anchored");
      return { statements: tally.count, size: JSON.stringify(result).length };
    };

    const small = await measure(40);
    const large = await measure(600);

    expect(large.statements).toBe(small.statements);
    // Fifteen times the corpus, the same briefing: same order of magnitude.
    expect(large.size).toBeLessThan(small.size * 2);
    expect(large.size).toBeGreaterThan(small.size / 2);
  }, 120_000);

  it("reads through the injectable passage loader, once per request", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_twin: [0, 1] });
    let calls = 0;
    const loadPassages: ContextDeps["loadPassages"] = (db, matches, maxChars) => {
      calls += 1;
      expect(maxChars).toBe(CONTEXT_MAX_EXCERPT_CHARS);
      return loadSemanticOnlyHits(db, matches, maxChars);
    };

    await pack("th_anchored", { semantic: retrievalOver(ws, TURN_WARD), loadPassages });
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The route (TEST-953, 962, 976, 979)
// ---------------------------------------------------------------------------

describe("GET /api/threads/{id}/context", () => {
  let server: CorpusServer;
  let keys: unknown[][];

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

  const get = async (path: string): Promise<Response> =>
    server.app.request(path, { headers: AUTH });

  beforeEach(() => {
    keys = [];
    server = createServer(config(ws.config.workspaceRoot), {
      projection: ws.db,
      queueMirror: createProjectionQueueMirror(ws.db),
      invalidate: (invalidated) => keys.push(...invalidated.map((key) => [...key])),
      logger: silentLogger,
      git: createRecordingCommitter(),
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("TEST-981 — serves each live shape with a 200", async () => {
    for (const [id, shape] of [
      ["th_anchored", "anchored"],
      ["th_whole", "whole-document"],
      ["th_solo", "standalone"],
      ["th_gone", "parent-deleted"],
    ] as const) {
      const response = await get(`/api/threads/${id}/context`);
      expect(response.status).toBe(200);
      const parsed = ContextPackSchema.safeParse(await response.json());
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.success && parsed.data.shape).toBe(shape);
    }
  });

  it("TEST-962 — a deleted parent is a 200 about the thread, never a 404", async () => {
    const response = await get("/api/threads/th_gone/context");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { shape: string }).shape).toBe("parent-deleted");
  });

  it("TEST-953 — an unknown id, and a document that is not a thread, are both 404", async () => {
    expect((await get("/api/threads/th_nope/context")).status).toBe(404);

    // A `th_`-prefixed id the projection resolves to a *note*: the id is
    // well-formed, so this is the surface's own rule rather than the schema's.
    ws.doc({ id: "th_fake", title: "Not a thread", body: "A plain note.\n" });
    ws.reproject();
    const notAThread = await get("/api/threads/th_fake/context");
    expect(notAThread.status).toBe(404);
    expect(((await notAThread.json()) as { code: string }).code).toBe("not_found");

    // A malformed id never reaches the handler: the contract's param schema
    // rejects it, which is a 400 rather than a 404.
    expect((await get("/api/threads/doc_parent/context")).status).toBe(400);
  });

  it("refuses without the bearer token", async () => {
    expect((await server.app.request("/api/threads/th_anchored/context")).status).toBe(401);
  });

  it("TEST-979 — writes nothing and invalidates nothing", async () => {
    keys = [];

    const response = await get("/api/threads/th_anchored/context");

    expect(response.status).toBe(200);
    expect(keys).toEqual([]);
  });
});
