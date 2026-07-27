// Performance smoke: the projection's stated budgets (SERVER-004) with
// generous CI margins. The real numbers live in the issue's E2E log — these
// assertions exist to catch an order-of-magnitude regression, not to police a
// shared runner's jitter.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openProjection, type ProjectionConfig } from "./db.js";
import { doctor } from "./doctor.js";
import { projectDocument } from "./project-document.js";
import { rebuild } from "./rebuild.js";

/** Target: < 2 s for 2000 documents. */
const REBUILD_BUDGET_MS = 20_000;
/** Target: < 200 ms warm for 1000 documents. */
const DOCTOR_BUDGET_MS = 2_000;
/** Target: < 5 ms for one document. */
const INCREMENTAL_BUDGET_MS = 50;

let root: string;
let config: ProjectionConfig;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-perf-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  mkdirSync(join(ws, "data", "threads"), { recursive: true });
  config = { workspaceRoot: ws, corpusDir: join(ws, ".corpus") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function generate(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const id = `doc_gen${String(index).padStart(6, "0")}`;
    const folder = join(config.workspaceRoot, "data", "docs", `f${String(index % 25)}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `${id}.md`),
      `---\nid: ${id}\ntype: note\ntitle: Generated ${index}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\ntags: [generated]\nanchors:\n  anc_a${index}:\n    exact: "paragraph ${index} of the corpus"\n---\n\nThis is paragraph ${index} of the corpus, which references [[doc_gen000000]].\n`,
      "utf8",
    );
    if (index % 10 === 0) {
      const threadId = `th_gen${String(index).padStart(6, "0")}`;
      writeFileSync(
        join(config.workspaceRoot, "data", "threads", `${threadId}.md`),
        `---\nid: ${threadId}\ntype: thread\ntitle: T${index}\nparent: ${id}\n---\n\n## user · 2026-07-03T09:00:00Z\n\nSee [[${id}]].\n`,
        "utf8",
      );
    }
  }
}

describe("projection performance", () => {
  it("rebuilds 2000 documents inside the budget", () => {
    generate(2000);
    const startedAt = Date.now();
    const report = rebuild(config);
    const elapsed = Date.now() - startedAt;
    console.log(`rebuild: ${report.documents} documents in ${elapsed} ms`);
    expect(report.documents).toBe(2200);
    expect(elapsed).toBeLessThan(REBUILD_BUDGET_MS);
  }, 120_000);

  it("runs doctor over 1000 documents inside the budget, hashing nothing", () => {
    generate(1000);
    rebuild(config);
    // Warm: a second run is what a pre-commit hook actually pays for.
    doctor(config);

    const startedAt = Date.now();
    const report = doctor(config);
    const elapsed = Date.now() - startedAt;
    console.log(
      `doctor: ${report.stats.files} files in ${elapsed} ms, ${report.stats.hashed} hashed`,
    );
    expect(report.ok).toBe(true);
    expect(report.stats.hashed).toBe(0);
    expect(elapsed).toBeLessThan(DOCTOR_BUDGET_MS);
  }, 120_000);

  it("projects one document into a populated database inside the budget", () => {
    generate(1000);
    const db = openProjection(config);
    try {
      const abs = join(config.workspaceRoot, "data", "docs", "one-more.md");
      writeFileSync(
        abs,
        `---\nid: doc_onemore\ntype: note\ntitle: One more\n---\n\nA short body.\n`,
        "utf8",
      );
      const startedAt = Date.now();
      expect(projectDocument(db, abs).kind).toBe("projected");
      const elapsed = Date.now() - startedAt;
      console.log(`incremental: 1 document in ${elapsed} ms`);
      expect(elapsed).toBeLessThan(INCREMENTAL_BUDGET_MS);
    } finally {
      db.close();
    }
  }, 120_000);
});
