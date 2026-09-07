// SERVER-166 — the ingestion half of SPEC.md §9.4's cost ledger.
//
// Two things are being pinned here, and only one of them is about rows. The
// other is a *cost* claim: §9.4 says a report costs the command nothing, which
// on this side of the wire means the write path reads nothing. That is asserted
// against the statements the code prepares and runs, not inferred from a
// stopwatch (sprint-025 R11) — a timing assertion would pass on a machine that
// happened to be fast while a `SELECT` sat on the path.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InvocationReport, InvocationReportRequest } from "@corpus/contract";
import { openProjection, type ProjectionDb } from "../projection/index.js";
import { META_TELEMETRY_SINCE } from "../projection/schema.js";
import { recordInvocations } from "./record.js";

const NOW = Date.parse("2026-09-06T12:00:00Z");

let root: string;
let db: ProjectionDb;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s025-record-"));
  db = openProjection({ workspaceRoot: join(root, "ws"), corpusDir: join(root, "ws", ".corpus") });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const report = (overrides: Partial<InvocationReport> = {}): InvocationReport => ({
  command: "thread show",
  wroteBytes: 24,
  readBytes: 412,
  subjects: [],
  at: "2026-09-06T11:59:00Z",
  ...overrides,
});

interface Row {
  readonly at_ms: number;
  readonly command: string;
  readonly wrote_bytes: number;
  readonly read_bytes: number;
  readonly subject: string | null;
}

const rows = (): Row[] =>
  db.prepare("SELECT * FROM telemetry ORDER BY rowid").all() as unknown as Row[];

/**
 * A handle that records every statement the code under test prepares, and
 * refuses every read a prepared statement can perform.
 *
 * This is the shape of the assertion rather than a convenience: "ingestion reads
 * nothing" is a property of the code path, so the test makes reading
 * *impossible* and then watches the path succeed. A spy that merely counted
 * would pass a version of `record.ts` that read something and ignored it.
 */
function watchStatements(target: ProjectionDb): {
  readonly sql: string[];
  readonly db: ProjectionDb;
} {
  const sql: string[] = [];
  const refuse = (name: string): never => {
    throw new Error(`ingestion must not read: statement.${name}() was called`);
  };
  const wrapped: ProjectionDb = {
    ...target,
    get sqlite() {
      return target.sqlite;
    },
    prepare(statementSql) {
      sql.push(statementSql.trim());
      const statement = target.prepare(statementSql);
      return new Proxy(statement, {
        get(source, property, receiver) {
          if (property === "get" || property === "all" || property === "iterate") {
            return () => refuse(String(property));
          }
          const value: unknown = Reflect.get(source, property, receiver);
          if (typeof value !== "function") return value;
          const bound: unknown = (value as (...args: unknown[]) => unknown).bind(source);
          return bound;
        },
      });
    },
    transaction: (fn) => target.transaction(fn),
    reopenAround: (replaceFile) => target.reopenAround(replaceFile),
    close: () => {
      target.close();
    },
  };
  return { sql, db: wrapped };
}

describe("recordInvocations — SPEC.md §9.4's append", () => {
  it("TEST-1185: writes one row per subject, each carrying the whole invocation", () => {
    recordInvocations(
      db,
      report({ subjects: ["doc_aaaaaaaa", "th_bbbbbbbb"], command: "doc show" }),
      () => NOW,
    );

    const stored = rows();
    expect(stored.map((row) => row.subject)).toEqual(["doc_aaaaaaaa", "th_bbbbbbbb"]);
    // Each document paid the whole command — not a share of it. Same instant,
    // same command, same byte counts on both rows.
    for (const row of stored) {
      expect([row.at_ms, row.command, row.wrote_bytes, row.read_bytes]).toEqual([
        Date.parse("2026-09-06T11:59:00Z"),
        "doc show",
        24,
        412,
      ]);
    }
  });

  it("TEST-1186: keeps an invocation that named nothing, under a null subject", () => {
    // `corpus search` and `corpus doc list` name no document. The measurement is
    // kept so a workspace-wide figure stays answerable later without asking
    // every CLI in the field to report a second time — no route reads these rows
    // today, and that is the point of writing them now.
    recordInvocations(db, report({ command: "search", subjects: [] }), () => NOW);

    expect(rows()).toEqual([
      {
        at_ms: Date.parse("2026-09-06T11:59:00Z"),
        command: "search",
        wrote_bytes: 24,
        read_bytes: 412,
        subject: null,
      },
    ]);
  });

  it("collapses a repeated subject, so a row is an invocation for that document", () => {
    // A verb naming a document positionally *and* in a flag would otherwise
    // count one invocation twice in that document's series.
    recordInvocations(db, report({ subjects: ["doc_aaaaaaaa", "doc_aaaaaaaa"] }), () => NOW);
    expect(rows()).toHaveLength(1);
  });

  it("accepts the batch form and records every invocation in it", () => {
    const request: InvocationReportRequest = {
      invocations: [
        report({ command: "doc show", subjects: ["doc_aaaaaaaa"] }),
        report({ command: "thread reply", subjects: ["th_bbbbbbbb"], at: "2026-09-06T11:59:30Z" }),
      ],
    };
    recordInvocations(db, request, () => NOW);

    expect(rows().map((row) => [row.command, row.subject])).toEqual([
      ["doc show", "doc_aaaaaaaa"],
      ["thread reply", "th_bbbbbbbb"],
    ]);
  });

  it("records nothing at all for an empty batch, the start stamp included", () => {
    recordInvocations(db, { invocations: [] }, () => NOW);
    expect(rows()).toEqual([]);
    // A request that measured nothing must not date the workspace's measuring.
    expect(
      db.prepare("SELECT value FROM meta WHERE key = ?").get(META_TELEMETRY_SINCE),
    ).toBeUndefined();
  });

  it("refuses nothing: a subject naming no document is stored as it arrived", () => {
    // The invocation happened. A document deleted since is not a reason to lose
    // the measurement, and this projection has no documents at all.
    recordInvocations(db, report({ subjects: ["doc_99999999"] }), () => NOW);
    expect(rows().map((row) => row.subject)).toEqual(["doc_99999999"]);
  });

  it("stamps the ledger's start once, and never moves it", () => {
    recordInvocations(db, report({ subjects: ["doc_aaaaaaaa"] }), () => NOW);
    recordInvocations(db, report({ subjects: ["doc_aaaaaaaa"] }), () => NOW + 86_400_000);

    expect(db.prepare("SELECT value FROM meta WHERE key = ?").get(META_TELEMETRY_SINCE)).toEqual({
      value: "2026-09-06T12:00:00.000Z",
    });
  });

  it("TEST-1187: prepares only INSERTs, and performs no read of any kind", () => {
    const watched = watchStatements(db);
    recordInvocations(
      watched.db,
      { invocations: [report({ subjects: ["doc_aaaaaaaa", "doc_bbbbbbbb"] }), report()] },
      () => NOW,
    );

    // Every statement on the path is an append. Not "no SELECT ran" — no SELECT
    // was even prepared, and the statements that were prepared had their read
    // methods taken away.
    expect(watched.sql.every((statement) => statement.startsWith("INSERT"))).toBe(true);
    expect(watched.sql).toHaveLength(2);
    expect(rows()).toHaveLength(3);
  });

  it("TEST-1187: a hundred reports cost a hundred appends and nothing else", () => {
    const watched = watchStatements(db);
    const started = Date.now();
    for (let index = 0; index < 100; index += 1) {
      recordInvocations(watched.db, report({ subjects: ["doc_aaaaaaaa"] }), () => NOW + index);
    }
    const elapsedMs = Date.now() - started;

    expect(rows()).toHaveLength(100);
    expect(watched.sql.every((statement) => statement.startsWith("INSERT"))).toBe(true);
    // Not a performance assertion — a generous ceiling that fails only if the
    // path grew something that walks the ledger. The measured figure is in the
    // issue's log.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
