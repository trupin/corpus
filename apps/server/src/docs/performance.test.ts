// Performance smoke for the collection query (SERVER-011, sprint-004 TEST-56):
// 2000 real documents, real projection, real SQL. Budgets carry a generous CI
// margin — the real numbers live in the issue's E2E log, and these assertions
// exist to catch an order-of-magnitude regression, not to police jitter.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocsQuerySchema } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { queryDocs } from "./query.js";

/** Target: < 100 ms warm for a filtered search over 2000 documents. */
const QUERY_BUDGET_MS = 1_000;
/** Target: < 250 ms warm for the Attention union over the same corpus. */
const NEEDS_BUDGET_MS = 2_500;

const NOW = Date.parse("2026-07-26T12:00:00Z");
const DOCUMENTS = 2000;

let ws: Workspace;

function generate(): void {
  for (let index = 0; index < DOCUMENTS; index += 1) {
    const id = `doc_gen${String(index).padStart(6, "0")}`;
    const folder = index % 3 === 0 ? "finance" : `f${String(index % 25)}`;
    const dir = join(ws.config.workspaceRoot, "data", "docs", folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.md`),
      `---\nid: ${id}\ntype: note\ntitle: Generated ${String(index)}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-0${String((index % 9) + 1)}T00:00:00Z\ntags: [${index % 3 === 0 ? "finance" : "other"}]\nstatus: open\ndue: null\nreviewed: null\nevergreen: false\n---\n\nParagraph ${String(index)} of the corpus mentions amortization and escrow.\n`,
      "utf8",
    );

    // One conversation per ten documents, so the thread joins, the read-state
    // join and the Attention reasons are all measured against real rows.
    if (index % 10 !== 0) continue;
    ws.thread({
      id: `th_gen${String(index).padStart(6, "0")}`,
      parent: id,
      agent: "engaged",
      turns: [
        { author: "user", ts: "2026-07-01T00:00:00Z", body: `Question ${String(index)}?` },
        { author: "agent", ts: "2026-07-02T00:00:00Z", body: `Answer ${String(index)}.` },
      ],
    });
  }
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function time(run: () => void, runs = 5): { min: number; median: number; max: number } {
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    run();
    samples.push(performance.now() - startedAt);
  }
  return { min: Math.min(...samples), median: median(samples), max: Math.max(...samples) };
}

beforeAll(() => {
  ws = createWorkspace("perf");
  generate();
  ws.reproject();
}, 300_000);

afterAll(() => {
  ws.close();
});

describe("collection query performance", () => {
  it("answers a filtered search over 2000 documents inside the budget", () => {
    const query = DocsQuerySchema.parse({
      q: "amortization",
      type: "note",
      tag: "finance",
      folder: "finance",
      sort: "-updated",
      limit: "50",
    });
    // Warm: the first call prepares the statement, which no later request pays.
    expect(queryDocs(ws.db, query, NOW).items).toHaveLength(50);

    const timings = time(() => {
      queryDocs(ws.db, query, NOW);
    });
    console.log(
      `docs query: min ${timings.min.toFixed(1)} ms, median ${timings.median.toFixed(1)} ms, max ${timings.max.toFixed(1)} ms`,
    );
    expect(timings.median).toBeLessThan(QUERY_BUDGET_MS);
  }, 120_000);

  it("answers the Attention union over the same corpus inside the budget", () => {
    const query = DocsQuerySchema.parse({ needs: "me", limit: "50" });
    queryDocs(ws.db, query, NOW);

    const timings = time(() => {
      queryDocs(ws.db, query, NOW);
    });
    console.log(
      `needs=me: min ${timings.min.toFixed(1)} ms, median ${timings.median.toFixed(1)} ms, max ${timings.max.toFixed(1)} ms`,
    );
    expect(timings.median).toBeLessThan(NEEDS_BUDGET_MS);
  }, 120_000);

  it("plans the common filters against indexes rather than a full scan", () => {
    const plan = ws.db.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT d.id FROM documents d LEFT JOIN threads t ON t.id = d.id
          WHERE d.type = 'note' AND d.status <> 'archived' ORDER BY d.updated DESC`,
      )
      .all() as { detail: string }[];
    const detail = plan.map((row) => row.detail).join(" | ");
    console.log(`plan: ${detail}`);
    expect(detail).toContain("documents_type");
    expect(detail).not.toContain("SCAN documents");
  });
});
