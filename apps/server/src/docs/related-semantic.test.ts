// `GET /api/docs/{id}/related`'s second graph (SERVER-045): the documents that
// *read* like this one without citing it, and the `both` label for the ones
// that do each.
//
// Distances are hand-set, for the reason `search/hybrid.test.ts` records: a
// relatedness test that asked a model which document is nearer would re-assert
// the model every run. `related.test.ts` beside this file is the reference-graph
// half, unchanged, plus the Phase A byte-stability snapshot.

import { RelatedDocsSchema, RelatedQuerySchema, type RelatedDoc } from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { createSemanticRetrieval, type SemanticRetrieval } from "../semantic/index.js";
import { embedChunks, embedDocuments, stubResolution } from "../semantic/vector-fixture.js";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { relatedDocs } from "./related.js";

const IDENTITY = "stub/fixture@2";

let ws: Workspace;

const retrievalOver = (workspace: Workspace): SemanticRetrieval =>
  createSemanticRetrieval({
    db: workspace.db,
    settings: { kind: "absent" },
    logger: silentLogger,
    resolve: () => Promise.resolve(stubResolution(IDENTITY, { embed: () => [1, 0] })),
  });

const related = async (
  id: string,
  params: Readonly<Record<string, string>> = {},
  semantic?: SemanticRetrieval,
): Promise<{ related: RelatedDoc[]; semanticIndex: string | undefined }> => {
  const results = await relatedDocs(ws.db, id, RelatedQuerySchema.parse(params), { semantic });
  expect(RelatedDocsSchema.parse(results)).toEqual(results);
  return { related: [...results.related], semanticIndex: results.semanticIndex };
};

const relationOf = (rows: readonly RelatedDoc[], id: string): string | undefined =>
  rows.find((row) => row.id === id)?.relation;

// ---------------------------------------------------------------------------
//   doc_home   — the document every query expands from
//   doc_cited  — linked only (doc_home → doc_cited), semantically distant
//   doc_twin   — similar only: no link, near vector, no shared keyword
//   doc_both   — linked *and* near
//   doc_far    — neither
//   doc_arch   — archived, and near
// ---------------------------------------------------------------------------

beforeEach(() => {
  ws = createWorkspace("related-semantic");
  ws.doc({
    id: "doc_home",
    title: "Quarterly revenue growth slowed",
    body: "Quarterly revenue growth slowed against the prior period. See [[doc_cited]] and [[doc_both]].",
  });
  ws.doc({ id: "doc_cited", title: "Kitchen renovation", body: "Cabinets arrive on Tuesday." });
  ws.doc({
    id: "doc_twin",
    title: "Sales fell off",
    body: "Sales fell off over the last three months across every region.",
  });
  ws.doc({ id: "doc_both", title: "Trading update", body: "The trading update was published." });
  ws.doc({ id: "doc_far", title: "Bicycle maintenance", body: "Chain lubrication schedule." });
  ws.doc({
    id: "doc_arch",
    title: "Archived earnings memo",
    status: "archived",
    body: "Earnings memo, archived.",
  });
  ws.reproject();

  embedDocuments(ws.db, IDENTITY, {
    doc_home: [1, 0],
    doc_twin: [0.99, 0.141],
    doc_both: [0.96, 0.28],
    doc_arch: [0.98, 0.199],
    doc_cited: [0, 1],
    doc_far: [0, 1],
  });
});

afterEach(() => {
  ws.close();
});

describe("similar rows", () => {
  it("surfaces a keyword-disjoint neighbour the reference graph cannot reach", async () => {
    // TEST-879's other half: `doc_twin` shares no content word with `doc_home`
    // and no `[[ref]]` either, so only the vectors connect them.
    const lexical = await related("doc_home");
    expect(lexical.related.map((row) => row.id)).not.toContain("doc_twin");

    const hybrid = await related("doc_home", {}, retrievalOver(ws));
    expect(hybrid.related.map((row) => row.id)).toContain("doc_twin");
    expect(relationOf(hybrid.related, "doc_twin")).toBe("similar");
  });

  it("labels a document that is linked *and* similar `both`", async () => {
    // TEST-880: Phase A hardcoded `relation: "linked"`; this is the test that
    // proves the hardcode is gone.
    const rows = (await related("doc_home", {}, retrievalOver(ws))).related;
    expect(relationOf(rows, "doc_both")).toBe("both");
    expect(relationOf(rows, "doc_cited")).toBe("linked");
    expect(relationOf(rows, "doc_twin")).toBe("similar");
    expect(new Set(rows.map((row) => row.relation))).toEqual(
      new Set(["linked", "similar", "both"]),
    );
  });

  it("never makes a document its own neighbour", async () => {
    // TEST-894. `doc_home`'s own chunk is the nearest thing to `doc_home`, so
    // the exclusion has to be structural rather than incidental.
    const rows = (await related("doc_home", {}, retrievalOver(ws))).related;
    expect(rows.map((row) => row.id)).not.toContain("doc_home");

    const widened = (await related("doc_home", { includeArchived: "true" }, retrievalOver(ws)))
      .related;
    expect(widened.map((row) => row.id)).not.toContain("doc_home");
  });

  it("excludes an archived neighbour by default and includes it with the flag", async () => {
    const semantic = retrievalOver(ws);
    expect((await related("doc_home", {}, semantic)).related.map((row) => row.id)).not.toContain(
      "doc_arch",
    );
    const widened = await related("doc_home", { includeArchived: "true" }, semantic);
    expect(widened.related.map((row) => row.id)).toContain("doc_arch");
    expect(relationOf(widened.related, "doc_arch")).toBe("similar");
  });

  it("gives a similar-only row the same one-line excerpt shape as a linked one", async () => {
    const rows = (await related("doc_home", {}, retrievalOver(ws))).related;
    const twin = rows.find((row) => row.id === "doc_twin");
    expect(twin?.title).toBe("Sales fell off");
    expect(twin?.excerpt).toBe("Sales fell off over the last three months across every region.");
    expect(Object.keys(twin ?? {}).sort()).toEqual(["excerpt", "id", "relation", "title"]);
  });

  it("ranks the nearer neighbour first and leaves the unrelated one out", async () => {
    const rows = (await related("doc_home", {}, retrievalOver(ws))).related;
    const order = rows.map((row) => row.id);
    // `doc_far` is neither linked nor near, so it is absent rather than last —
    // `similar` is a claim about a document, and the floor is what keeps it true.
    expect(order).not.toContain("doc_far");
    // Among the similar-only rows, the nearer one comes first.
    expect(order.indexOf("doc_twin")).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic across repeated calls and a fresh service", async () => {
    const first = await related("doc_home", {}, retrievalOver(ws));
    const second = await related("doc_home", {}, retrievalOver(ws));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("caps at the limit however deep it over-fetched", async () => {
    const capped = await related("doc_home", { limit: "2" }, retrievalOver(ws));
    expect(capped.related).toHaveLength(2);
  });
});

describe("the state word", () => {
  it("reports `disabled` with no service and `current` with a caught-up index", async () => {
    expect((await related("doc_home")).semanticIndex).toBe("disabled");
    expect((await related("doc_home", {}, retrievalOver(ws))).semanticIndex).toBe("current");
  });

  it("reports `stale` while a backlog drains, and still contributes what it has", async () => {
    ws.db
      .prepare(
        "DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE doc_id = 'doc_far')",
      )
      .run();
    const scratch = await related("doc_home", {}, retrievalOver(ws));
    expect(scratch.semanticIndex).toBe("stale");
    expect(scratch.related.map((row) => row.id)).toContain("doc_twin");
  });

  it("falls back to the reference graph alone when the index belongs to another model", async () => {
    ws.db.prepare("UPDATE chunk_embeddings SET identity = 'stub/elsewhere@2'").run();
    const rows = await related("doc_home", {}, retrievalOver(ws));
    expect(rows.semanticIndex).toBe("disabled");
    expect(rows.related.map((row) => row.id)).toEqual(["doc_both", "doc_cited"]);
    for (const row of rows.related) expect(row.relation).toBe("linked");
  });

  it("answers the reference graph alone for a document with no vector yet", async () => {
    const scratch = createWorkspace("related-semantic-pending");
    try {
      scratch.doc({ id: "doc_a", title: "A", body: "Points at [[doc_b]]." });
      scratch.doc({ id: "doc_b", title: "B", body: "Target." });
      scratch.reproject();
      // Everything except `doc_a` is indexed: the document being expanded from
      // has no centroid, so there is nothing to compare — but that is staleness,
      // not a degrade, and the linked half is unaffected.
      embedChunks(scratch.db, IDENTITY, (chunk) => (chunk.docId === "doc_a" ? null : [1, 0]));

      const results = await relatedDocs(scratch.db, "doc_a", RelatedQuerySchema.parse({}), {
        semantic: retrievalOver(scratch),
      });
      expect(results.semanticIndex).toBe("stale");
      expect(results.related.map((row) => row.id)).toEqual(["doc_b"]);
      expect(results.related[0]?.relation).toBe("linked");
    } finally {
      scratch.close();
    }
  });
});
