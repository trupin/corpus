// `corpus db doctor`'s semantic half: what is drift, what is staleness, and what
// is worth saying without moving a verdict (SPEC.md §14, Retrieval Phase B).
//
// Every fixture starts from a real workspace rebuilt from real files, so the
// clean case is clean because the projector produced it. The drifted cases are
// then written straight into the tables with SQL — deliberately, because the
// projector cannot produce them, which is exactly why `doctor` is the only thing
// that can notice.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeEmbedding } from "../semantic/embeddings.js";
import type { EffectiveModel } from "../semantic/state.js";
import { openProjection, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { doctor, inspectProjection } from "./doctor.js";
import { rebuild } from "./rebuild.js";
import { SEMANTIC_DRIFT_LIMIT } from "./semantic-integrity.js";

const IDENTITY = "local/fixture@4";
const OTHER = "local/other@8";
const VECTOR = Float32Array.from([0.5, 0.5, 0.5, 0.5]);

let root: string;
let config: ProjectionConfig;

const doc = (id: string, body: string): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${id}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\n${body}\n`;

function write(relative: string, content: string): void {
  const abs = join(config.workspaceRoot, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/** A workspace of three multi-section documents, rebuilt from its files. */
function seed(): void {
  for (const id of ["doc_aaa", "doc_bbb", "doc_ccc"]) {
    write(
      `data/docs/${id}.md`,
      doc(id, `## First\n\nA paragraph in ${id}.\n\n## Second\n\nAnother paragraph in ${id}.\n`),
    );
  }
  mkdirSync(join(config.corpusDir, "queue", "pending"), { recursive: true });
  rebuild(config);
}

/** Opens the projection read-write for a fixture edit, then closes it again. */
function mutate(edit: (db: ProjectionDb) => void): void {
  const db = openProjection(config);
  try {
    edit(db);
  } finally {
    db.close();
  }
}

const chunkIds = (): string[] => {
  const db = openProjection(config);
  try {
    return (
      db.prepare("SELECT DISTINCT chunk_id FROM chunks ORDER BY chunk_id").all() as {
        chunk_id: string;
      }[]
    ).map((row) => row.chunk_id);
  } finally {
    db.close();
  }
};

function embedAll(identity = IDENTITY): string[] {
  const ids = chunkIds();
  mutate((db) => {
    for (const chunkId of ids) {
      writeEmbedding(db, { state: "ready", chunkId, identity, vector: VECTOR, updatedMs: 1 });
    }
  });
  return ids;
}

const identity = (value: string): EffectiveModel => ({ kind: "identity", identity: value });
const none = (detail: string): EffectiveModel => ({ kind: "none", detail });

const kinds = (report: ReturnType<typeof doctor>): string[] =>
  report.drift.map((entry) => entry.kind);
const warningKinds = (report: ReturnType<typeof doctor>): string[] =>
  (report.warnings ?? []).map((entry) => entry.kind);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s021-semantic-doctor-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
  config = { workspaceRoot: ws, corpusDir: join(ws, ".corpus") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("staleness is not drift", () => {
  it("stays clean on a workspace whose only anomaly is a pending backlog", () => {
    seed();

    // TEST-901/904, SPEC.md §14's signed rule: `corpus db rebuild` restores the
    // projection synchronously and *queues* semantic re-indexing, so the moment
    // it returns every chunk is pending. If a backlog were drift, `rebuild &&
    // doctor` could never be clean.
    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(true);
    expect(report.drift).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("stays clean, with a warning, when chunks have permanently failed", () => {
    seed();
    const ids = chunkIds();
    mutate((db) => {
      writeEmbedding(db, {
        state: "failed",
        chunkId: ids[0] ?? "",
        identity: IDENTITY,
        failures: 5,
        updatedMs: 1,
      });
    });

    // Open Conflict 9: a failure is neither drift (files and rows agree) nor
    // ordinary staleness (it will never drain on its own), so it is the
    // report-only surface's business — and never the verdict's.
    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(true);
    expect(warningKinds(report)).toEqual(["semantic_index_failed"]);
    expect(report.warnings?.[0]?.detail).toContain("1 chunk(s) failed to embed");
  });

  it("stays clean on a fully indexed workspace", () => {
    seed();
    embedAll();

    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });
});

describe("identity drift", () => {
  it("fails on an index mixing more than one provider/model identity", () => {
    seed();
    const ids = embedAll();
    mutate((db) => {
      writeEmbedding(db, {
        state: "ready",
        chunkId: ids[0] ?? "",
        identity: OTHER,
        vector: Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]),
        updatedMs: 2,
      });
    });

    // TEST-903. §9.1: results from different models are never mixed, so an index
    // that silently contains two is drift rather than staleness.
    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    expect(kinds(report)).toEqual(["count_mismatch"]);
    expect(report.drift[0]?.detail).toContain(IDENTITY);
    expect(report.drift[0]?.detail).toContain(OTHER);
    expect(report.drift[0]?.path).toBeUndefined();
  });

  it("fails when every vector was produced by a model that is not the effective one", () => {
    seed();
    embedAll(OTHER);

    // SERVER-044's flagged blindness: the counts say `indexed == total` and are
    // honest under their own definitions, while nothing in the index can be
    // compared against a fresh query. Only a caller that knows what this server
    // can embed with — the `db doctor` route — can see it.
    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    expect(kinds(report)).toEqual(["count_mismatch"]);
    expect(report.drift[0]?.detail).toContain(OTHER);
    expect(report.drift[0]?.detail).toContain(IDENTITY);
  });

  it("warns rather than fails when nothing can embed and the vectors are intact", () => {
    seed();
    embedAll(OTHER);

    // The sticky case (SPEC.md §9.1, SERVER-043's `unresolved`): the index was
    // built by a model this machine cannot offer right now, so resolution
    // refuses to adopt anything and every vector stays valid and untouched.
    // Failing here would break §14's standing `rebuild && doctor` invariant
    // permanently — `corpus db rebuild` carries embeddings over by design, so no
    // rebuild could ever clear the verdict.
    const report = doctor(config, {
      effectiveModel: none("the index was built by local/other@8 and no engine offers it"),
    });
    expect(report.ok).toBe(true);
    expect(warningKinds(report)).toEqual(["semantic_index_unusable"]);
    expect(report.warnings?.[0]?.detail).toContain(OTHER);
  });

  it("makes no identity claim at all when the caller could not resolve one", () => {
    seed();
    embedAll(OTHER);

    // The default: `doctor(config)` standalone — a pre-commit hook, a workspace
    // whose server is stopped. A read-only file check has no standing to resolve
    // a provider, and "this check did not run" must not read as a verdict.
    const report = doctor(config);
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("says nothing about identity on a workspace that has never embedded anything", () => {
    seed();

    const report = doctor(config, { effectiveModel: none("no embedded engine is installed") });
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });
});

describe("chunk drift", () => {
  it("fails when a chunk row's content-addressed id no longer matches its text", () => {
    seed();
    mutate((db) => {
      db.prepare(
        "UPDATE chunks SET chunk_id = 'chunk_tampered' WHERE rowid = (SELECT MIN(rowid) FROM chunks)",
      ).run();
    });

    // TEST-902: the id *is* the content hash (document + heading path + text), so
    // a row whose id no longer agrees with the text indexed beside it describes
    // different bytes than the file does.
    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    expect(kinds(report)).toEqual(["content_mismatch"]);
    expect(report.drift[0]?.detail).toContain("chunk_tampered");
    expect(report.drift[0]?.path).toBe("data/docs/doc_aaa.md");
  });

  it("fails when a chunk row's heading path no longer matches its indexed text", () => {
    seed();
    mutate((db) => {
      db.prepare(
        "UPDATE chunks SET heading_path = 'Elsewhere' WHERE rowid = (SELECT MIN(rowid) FROM chunks)",
      ).run();
    });

    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    expect(kinds(report)).toEqual(["content_mismatch"]);
    expect(report.drift[0]?.detail).toContain("Elsewhere");
  });

  it("fails when a chunk is addressed to a document the projection does not have", () => {
    seed();
    mutate((db) => {
      // A document row removed without its chunks — unreachable through the
      // projector, which deletes both in one sequence.
      db.prepare("DELETE FROM documents WHERE id = 'doc_bbb'").run();
    });

    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    // `orphan_row` names the document; `missing_row` names the file that now has
    // no row. Both are true and both are reported.
    expect(kinds(report)).toContain("orphan_row");
    const orphan = report.drift.find((entry) => entry.kind === "orphan_row");
    expect(orphan?.detail).toContain("doc_bbb");
  });

  it("fails on a chunk_search row that no chunks row claims", () => {
    seed();
    mutate((db) => {
      db.prepare("DELETE FROM chunks WHERE rowid = (SELECT MIN(rowid) FROM chunks)").run();
    });

    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    expect(kinds(report)).toEqual(["orphan_row"]);
    expect(report.drift[0]?.detail).toContain("has no chunks row");
  });

  it("truncates rather than listing a whole broken corpus", () => {
    seed();
    mutate((db) => {
      db.prepare("UPDATE chunks SET heading_path = heading_path || ' (edited)'").run();
    });

    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.ok).toBe(false);
    // Every finding is real; the report is bounded so a response body stays a
    // report rather than a dump.
    expect(report.drift.length).toBeLessThanOrEqual(SEMANTIC_DRIFT_LIMIT + 1);
  });
});

describe("the pass stays cheap and stays out of the boot path", () => {
  it("reads no document bytes the existing stat short-circuit would have skipped", () => {
    seed();
    embedAll();

    // TEST-907: `stats.hashed` is doctor's published promise that a warm
    // workspace re-reads nothing. The semantic pass is SQL only, so it cannot
    // move that number.
    const report = doctor(config, { effectiveModel: identity(IDENTITY) });
    expect(report.stats.hashed).toBe(0);
    expect(report.stats.parsed).toBe(0);
  });

  it("leaves `inspectProjection` exactly as narrow as it was", () => {
    seed();
    embedAll(OTHER);
    mutate((db) => {
      db.prepare(
        "UPDATE chunks SET chunk_id = 'chunk_tampered' WHERE rowid = (SELECT MIN(rowid) FROM chunks)",
      ).run();
    });

    // TEST-905: the boot catch-up calls this, once per boot, and a semantic pass
    // there would make every boot pay for one — and would turn a chunk finding
    // into a full repopulation.
    const db = openProjection(config);
    try {
      const report = inspectProjection(db);
      expect(report.warnings).toBeUndefined();
      expect(report.drift).toEqual([]);
      expect(report.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});
