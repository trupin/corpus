// SERVER-166 — the read half of SPEC.md §9.4's cost ledger.
//
// The fixtures here seed the ledger directly rather than going through the
// route, because the arithmetic is what is on trial: byte totals are chosen by
// hand so every published figure can be checked against a number written in the
// test rather than against another run of the same code.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateTokens } from "@corpus/contract";
import { HttpError } from "../errors.js";
import { openProjection, type ProjectionDb } from "../projection/index.js";
import { META_TELEMETRY_SINCE } from "../projection/schema.js";
import { BUCKET_MS, documentCost } from "./series.js";

const DAY = BUCKET_MS;
/** Midnight UTC on 2026-09-06 — every fixture instant is an offset from here. */
const TODAY = Date.parse("2026-09-06T00:00:00Z");
const NOON = TODAY + 12 * 3_600_000;

let root: string;
let db: ProjectionDb;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s025-series-"));
  db = openProjection({ workspaceRoot: join(root, "ws"), corpusDir: join(root, "ws", ".corpus") });
  seedDocument("doc_aaaaaaaa", "data/docs/a.md", 1234);
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** A projected document and the per-file size row the reference line reads. */
function seedDocument(id: string, path: string, size: number | null): void {
  db.prepare(
    "INSERT INTO documents " +
      "(id, type, title, path, status, last_actor, tags_json, created, updated, evergreen, " +
      " body_excerpt, extra_json) " +
      "VALUES (?, 'note', 'A', ?, 'active', 'user', '[]', '2026-01-01T00:00:00Z', " +
      " '2026-01-01T00:00:00Z', 0, '', '{}')",
  ).run(id, path);
  if (size !== null) {
    db.prepare(
      "INSERT INTO file_hashes (path, hash, size, mtime_ms) VALUES (?, 'deadbeef', ?, 0)",
    ).run(path, size);
  }
}

/** Every non-test TypeScript file under `apps/server/src`, for the sweep below. */
function serverSources(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(full);
    }
  };
  walk(dirname(dirname(fileURLToPath(import.meta.url))));
  return found;
}

function seedRow(
  atMs: number,
  command: string,
  wroteBytes: number,
  readBytes: number,
  subject: string | null,
): void {
  db.prepare(
    "INSERT INTO telemetry (at_ms, command, wrote_bytes, read_bytes, subject) VALUES (?, ?, ?, ?, ?)",
  ).run(atMs, command, wroteBytes, readBytes, subject);
}

describe("documentCost — SPEC.md §9.4's series", () => {
  it("answers 404 for an id the projection has never heard of", () => {
    expect(() => documentCost(db, "doc_99999999", 180, NOON)).toThrow(HttpError);
    try {
      documentCost(db, "doc_99999999", 180, NOON);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
    }
  });

  it("answers an unmeasured document with no buckets, never a series of zeros", () => {
    const cost = documentCost(db, "doc_aaaaaaaa", 180, NOON);
    expect(cost).toEqual({
      granularity: "day",
      buckets: [],
      total: 0,
      truncated: false,
      sizeBytes: 1234,
      measuringSince: null,
    });
  });

  it("TEST-1188: is correct against a hand-computed fixture across three buckets", () => {
    // Bucket -2 (2026-09-04): one `doc show` — wrote 10, read 100.
    seedRow(TODAY - 2 * DAY + 3_600_000, "doc show", 10, 100, "doc_aaaaaaaa");
    // Bucket -1 (2026-09-05): two invocations of two different commands, plus a
    // second `doc show`, so `byCommand` has two keys and one of them two rows.
    seedRow(TODAY - DAY + 3_600_000, "doc show", 6, 6, "doc_aaaaaaaa");
    seedRow(TODAY - DAY + 7_200_000, "doc show", 6, 6, "doc_aaaaaaaa");
    seedRow(TODAY - DAY + 9_000_000, "thread reply", 5, 9, "doc_aaaaaaaa");
    // Bucket 0 (today): one invocation that also named another document — the
    // second row belongs to that other document's series, not this one.
    seedRow(TODAY + 3_600_000, "doc show", 400, 4001, "doc_aaaaaaaa");
    seedRow(TODAY + 3_600_000, "doc show", 400, 4001, "doc_bbbbbbbb");
    // A null-subject row: `corpus search` named nothing, so it is in no
    // document's series.
    seedRow(TODAY + 3_600_000, "search", 900, 900, null);

    const cost = documentCost(db, "doc_aaaaaaaa", 180, NOON);
    expect(cost.granularity).toBe("day");
    expect(cost.total).toBe(3);
    expect(cost.truncated).toBe(false);
    expect(cost.buckets).toHaveLength(3);

    // Oldest first, so it reads left to right the way it is drawn.
    expect(cost.buckets[0]).toEqual({
      from: "2026-09-04T00:00:00.000Z",
      to: "2026-09-05T00:00:00.000Z",
      // ceil(10/4) = 3, ceil(100/4) = 25.
      wroteTokens: 3,
      readTokens: 25,
      invocations: 1,
      byCommand: { "doc show": 28 },
    });

    // The middle bucket is where rounding is visible: the two `doc show` rows
    // are summed *before* the estimate — ceil(12/4) = 3 — while `thread reply`
    // rounds on its own: ceil(5/4) = 2, ceil(9/4) = 3.
    expect(cost.buckets[1]).toEqual({
      from: "2026-09-05T00:00:00.000Z",
      to: "2026-09-06T00:00:00.000Z",
      wroteTokens: 3 + 2,
      readTokens: 3 + 3,
      invocations: 3,
      byCommand: { "doc show": 6, "thread reply": 5 },
    });

    expect(cost.buckets[2]).toEqual({
      from: "2026-09-06T00:00:00.000Z",
      to: "2026-09-07T00:00:00.000Z",
      wroteTokens: 100,
      readTokens: 1001,
      // The two-subject invocation counts **once** here, and once in the other
      // document's series. Neither the null-subject row nor the other
      // document's row is in this one.
      invocations: 1,
      byCommand: { "doc show": 1101 },
    });

    // The invariant the contract fixes the grain to protect: every coarser
    // figure is a plain sum of the same whole tokens.
    for (const bucket of cost.buckets) {
      const byCommandTotal = Object.values(bucket.byCommand).reduce((sum, value) => sum + value, 0);
      expect(byCommandTotal).toBe(bucket.wroteTokens + bucket.readTokens);
    }
  });

  it("counts an invocation once in each named document's series", () => {
    seedDocument("doc_bbbbbbbb", "data/docs/b.md", 99);
    seedRow(TODAY + 3_600_000, "doc show", 40, 400, "doc_aaaaaaaa");
    seedRow(TODAY + 3_600_000, "doc show", 40, 400, "doc_bbbbbbbb");

    for (const id of ["doc_aaaaaaaa", "doc_bbbbbbbb"]) {
      const cost = documentCost(db, id, 180, NOON);
      expect([id, cost.buckets[0]?.invocations]).toEqual([id, 1]);
      expect([id, cost.buckets[0]?.readTokens]).toEqual([id, 100]);
    }
  });

  it("keeps the series contiguous, so a quiet day is a zero and not a gap", () => {
    seedRow(TODAY - 3 * DAY, "doc show", 4, 4, "doc_aaaaaaaa");
    seedRow(TODAY, "doc show", 4, 4, "doc_aaaaaaaa");

    const cost = documentCost(db, "doc_aaaaaaaa", 180, NOON);
    expect(cost.buckets).toHaveLength(4);
    expect(cost.buckets.map((bucket) => bucket.invocations)).toEqual([1, 0, 0, 1]);
    // An empty bucket is a real answer, fully shaped.
    expect(cost.buckets[1]).toEqual({
      from: "2026-09-04T00:00:00.000Z",
      to: "2026-09-05T00:00:00.000Z",
      wroteTokens: 0,
      readTokens: 0,
      invocations: 0,
      byCommand: {},
    });
    // Each bucket's `from` is the previous one's `to`.
    for (let index = 1; index < cost.buckets.length; index += 1) {
      expect(cost.buckets[index]?.from).toBe(cost.buckets[index - 1]?.to);
    }
  });

  it("runs the last bucket up to today even when the newest measurement is older", () => {
    seedRow(TODAY - 2 * DAY, "doc show", 4, 4, "doc_aaaaaaaa");
    const cost = documentCost(db, "doc_aaaaaaaa", 180, NOON);
    expect(cost.buckets.at(-1)?.to).toBe("2026-09-07T00:00:00.000Z");
    expect(cost.total).toBe(3);
  });

  it("does not stop before a measurement stamped ahead of the server's clock", () => {
    // A skewed CLI clock must not produce a series that ends before its own
    // newest row.
    seedRow(TODAY, "doc show", 4, 4, "doc_aaaaaaaa");
    seedRow(TODAY + 2 * DAY, "doc show", 4, 4, "doc_aaaaaaaa");
    const cost = documentCost(db, "doc_aaaaaaaa", 180, NOON);
    expect(cost.total).toBe(3);
    expect(cost.buckets.at(-1)?.from).toBe("2026-09-08T00:00:00.000Z");
    expect(cost.buckets.at(-1)?.invocations).toBe(1);
  });

  it("gives a command that spent nothing no key at all, rather than a zero", () => {
    seedRow(TODAY, "queue idle", 0, 0, "doc_aaaaaaaa");
    seedRow(TODAY, "doc show", 4, 4, "doc_aaaaaaaa");

    const bucket = documentCost(db, "doc_aaaaaaaa", 180, NOON).buckets[0];
    expect(bucket?.byCommand).toEqual({ "doc show": 2 });
    // The invocation still happened, and is still counted.
    expect(bucket?.invocations).toBe(2);
  });

  it("TEST-1191: keeps the newest buckets and says so when `limit` cuts", () => {
    for (let day = 0; day < 6; day += 1) {
      seedRow(TODAY - day * DAY, "doc show", 4, 4 * (day + 1), "doc_aaaaaaaa");
    }

    const whole = documentCost(db, "doc_aaaaaaaa", 180, NOON);
    expect([whole.total, whole.buckets.length, whole.truncated]).toEqual([6, 6, false]);

    const cut = documentCost(db, "doc_aaaaaaaa", 2, NOON);
    expect([cut.total, cut.buckets.length, cut.truncated]).toEqual([6, 2, true]);
    // The **newest** two — the oldest are the ones cut.
    expect(cut.buckets.map((bucket) => bucket.from)).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-06T00:00:00.000Z",
    ]);
    expect(cut.buckets).toEqual(whole.buckets.slice(-2));
  });

  it("TEST-1190: reads the size from the projection's per-file column", () => {
    seedRow(TODAY, "doc show", 4, 4, "doc_aaaaaaaa");
    expect(documentCost(db, "doc_aaaaaaaa", 180, NOON).sizeBytes).toBe(1234);

    // The column is the authority: a projection that says 4096 answers 4096,
    // whatever any file on disk says — there is no file on disk here at all.
    db.prepare("UPDATE file_hashes SET size = 4096 WHERE path = ?").run("data/docs/a.md");
    expect(documentCost(db, "doc_aaaaaaaa", 180, NOON).sizeBytes).toBe(4096);
  });

  it("answers 0 bytes, not 404, for a document the projector never hashed", () => {
    seedDocument("doc_cccccccc", "data/docs/c.md", null);
    expect(documentCost(db, "doc_cccccccc", 180, NOON).sizeBytes).toBe(0);
  });

  it("reports the ledger's start, so an empty panel can tell why it is empty", () => {
    expect(documentCost(db, "doc_aaaaaaaa", 180, NOON).measuringSince).toBeNull();

    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      META_TELEMETRY_SINCE,
      "2026-09-01T08:00:00.000Z",
    );
    // A property of the workspace rather than of this document: it is reported
    // even for a document with no measurements of its own.
    expect(documentCost(db, "doc_aaaaaaaa", 180, NOON).measuringSince).toBe(
      "2026-09-01T08:00:00.000Z",
    );
  });

  it("TEST-1189: converts in exactly one file, and nowhere twice", () => {
    // The house estimate is declared once, in `packages/contract`, and this
    // server calls it from one site (sprint-025 R1). A second definition — or a
    // second call site converting at a different grain — would publish a
    // breakdown that does not sum to its own total, which is the one arithmetic
    // error a reader of a panel is guaranteed to notice.
    const sources = serverSources();
    const converting = sources.filter((file) =>
      /\bestimateTokens\(/.test(readFileSync(file, "utf8")),
    );
    expect(converting.map((file) => file.split("/").slice(-2).join("/"))).toEqual([
      "telemetry/series.ts",
    ]);
    // And no local copy of the constant, which is what a second definition would
    // look like before it became a second answer.
    const redeclaring = sources.filter((file) =>
      /BYTES_PER_TOKEN\s*=/.test(readFileSync(file, "utf8")),
    );
    expect(redeclaring).toEqual([]);
  });

  it("TEST-1189: derives tokens with the contract's function and nothing else", () => {
    // Cross-checked against the export rather than against a literal, so a
    // change to the house estimate reaches this series by definition.
    seedRow(TODAY, "doc show", 4001, 6, "doc_aaaaaaaa");
    const bucket = documentCost(db, "doc_aaaaaaaa", 180, NOON).buckets[0];
    expect(bucket?.wroteTokens).toBe(estimateTokens(4001));
    expect(bucket?.readTokens).toBe(estimateTokens(6));
  });
});
