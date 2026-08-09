// Performance smoke for the collection query (SERVER-011, sprint-004 TEST-56):
// 2000 real documents, real projection, real SQL. Budgets carry a generous CI
// margin — the real numbers live in the issue's E2E log, and these assertions
// exist to catch an order-of-magnitude regression, not to police jitter.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocsQuerySchema } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { NEEDS_REASON_SQL, UNANSWERED_FORM_COUNT_SQL } from "./needs.js";
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

  // Wave-3 audit FIX 12. `needs=form` asks every open thread whether any of its
  // turns is an unanswered agent form. `turns_thread_idx` seeks the thread and
  // stops there — it carries neither flag — so the fragment used to fetch every
  // turn row of every open thread and test them one at a time, a cost linear in
  // how long the conversations are rather than in how many questions are open.
  // The corpus above has two-turn threads and cannot show it, so this case
  // builds deep ones.
  describe("needs=form over long conversations", () => {
    /** Target: the seek is over open questions, so depth must not move the clock. */
    const FORM_BUDGET_MS = 500;
    const THREADS = 150;
    const TURNS = 80;

    let deep: Workspace;

    beforeAll(() => {
      deep = createWorkspace("perf-forms");
      deep.doc({ id: "doc_formhost" });
      for (let index = 0; index < THREADS; index += 1) {
        const turns = Array.from({ length: TURNS }, (_, turn) => ({
          author: turn % 2 === 0 ? ("user" as const) : ("agent" as const),
          ts: `2026-07-01T${String(Math.floor(turn / 60)).padStart(2, "0")}:${String(turn % 60).padStart(2, "0")}:00Z`,
          // Only the last turn of every tenth thread is an open question; every
          // other turn is ordinary prose, which is the realistic ratio and the
          // one that makes a full turn scan expensive.
          body:
            turn === TURNS - 1 && index % 10 === 0
              ? 'Here you go.\n\n```form\nprompt: Pick one\noptions:\n  - "a"\n  - "b"\n```\n'
              : `Turn ${String(turn)} of thread ${String(index)}, ordinary prose about escrow.`,
        }));
        deep.thread({
          id: `th_deep${String(index).padStart(6, "0")}`,
          parent: "doc_formhost",
          agent: "requested",
          turns,
        });
      }
      deep.reproject();
    }, 300_000);

    afterAll(() => {
      deep.close();
    });

    it("seeks the open questions instead of scanning every turn of every thread", () => {
      // The real fragment, read from the module the query builds with, so a
      // predicate edited into a shape the partial index cannot serve fails here.
      const plan = deep.db.sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT d.id FROM documents d LEFT JOIN threads t ON t.id = d.id
            WHERE ${NEEDS_REASON_SQL.form}`,
        )
        .all() as { detail: string }[];
      const detail = plan.map((row) => row.detail).join(" | ");
      console.log(`needs=form plan: ${detail}`);
      expect(detail).toContain("turns_unanswered_form");
      expect(detail).not.toContain("SCAN tu");
    });

    // SERVER-084: the fragment is now a `COUNT(*)` the `form` reason reads
    // through `> 0`, and the row selects the count itself. The partial index has
    // to cover it in *that* position too — a row query that scanned every turn
    // of every thread would cost the board what the filter no longer costs.
    it("seeks the same index when the count rides on the row", () => {
      const plan = deep.db.sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT ${UNANSWERED_FORM_COUNT_SQL} AS unanswered_forms
             FROM documents d LEFT JOIN threads t ON t.id = d.id`,
        )
        .all() as { detail: string }[];
      const detail = plan.map((row) => row.detail).join(" | ");
      console.log(`unansweredForms plan: ${detail}`);
      expect(detail).toContain("turns_unanswered_form");
      expect(detail).not.toContain("SCAN tu");
    });

    it("answers needs=form over deep threads inside the budget", () => {
      const query = DocsQuerySchema.parse({ needs: "form", limit: "200" });
      expect(queryDocs(deep.db, query, NOW).items).toHaveLength(THREADS / 10);

      const timings = time(() => {
        queryDocs(deep.db, query, NOW);
      });
      console.log(
        `needs=form (${String(THREADS)}x${String(TURNS)} turns): min ${timings.min.toFixed(1)} ms, median ${timings.median.toFixed(1)} ms, max ${timings.max.toFixed(1)} ms`,
      );
      expect(timings.median).toBeLessThan(FORM_BUDGET_MS);
    }, 120_000);
  });

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
