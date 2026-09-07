// SERVER-166 — retention for SPEC.md §9.4's cost ledger.
//
// The window and its placement are both decisions, so both are pinned: the
// boundary is asserted at the exact millisecond, and the trigger is asserted to
// be neither of the ledger's own two endpoints.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { openProjection, type ProjectionDb } from "../projection/index.js";
import {
  pruneTelemetry,
  startTelemetryRetention,
  TELEMETRY_PRUNE_INTERVAL_MS,
  TELEMETRY_RETENTION_DAYS,
  TELEMETRY_RETENTION_MS,
} from "./retention.js";

const NOW = Date.parse("2026-09-06T12:00:00Z");

let root: string;
let db: ProjectionDb;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s025-retention-"));
  db = openProjection({ workspaceRoot: join(root, "ws"), corpusDir: join(root, "ws", ".corpus") });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const seed = (atMs: number, subject: string | null = "doc_aaaaaaaa"): void => {
  db.prepare(
    "INSERT INTO telemetry (at_ms, command, wrote_bytes, read_bytes, subject) VALUES (?, ?, ?, ?, ?)",
  ).run(atMs, "doc show", 4, 4, subject);
};

const survivors = (): number[] =>
  (db.prepare("SELECT at_ms FROM telemetry ORDER BY at_ms").all() as { at_ms: number }[]).map(
    (row) => row.at_ms,
  );

describe("telemetry retention", () => {
  it("records the window as ninety days of raw rows", () => {
    // The decision, in one place: raw rows only, bucketed on read, no aggregate
    // table (sprint-025 O3). A change here is a change to what the panel can
    // show, so it is a change somebody has to make on purpose.
    expect(TELEMETRY_RETENTION_DAYS).toBe(90);
    expect(TELEMETRY_RETENTION_MS).toBe(90 * 86_400_000);
    expect(TELEMETRY_PRUNE_INTERVAL_MS).toBe(86_400_000);
  });

  it("TEST-1192: deletes rows past the window and leaves newer ones untouched", () => {
    const oldest = NOW - TELEMETRY_RETENTION_MS - 1;
    const boundary = NOW - TELEMETRY_RETENTION_MS;
    const recent = NOW - 3_600_000;
    seed(oldest);
    seed(boundary);
    seed(recent);
    seed(NOW - TELEMETRY_RETENTION_MS - 86_400_000, null);

    expect(pruneTelemetry(db, NOW)).toBe(2);
    // The boundary itself survives: the window is `at_ms < now - window`, so a
    // row exactly ninety days old is still inside it.
    expect(survivors()).toEqual([boundary, recent]);
  });

  it("deletes null-subject rows on the same rule as any other", () => {
    // They belong to no document's series, and they age the same way.
    seed(NOW - TELEMETRY_RETENTION_MS - 1, null);
    seed(NOW, null);
    expect(pruneTelemetry(db, NOW)).toBe(1);
    expect(survivors()).toEqual([NOW]);
  });

  it("answers zero on an empty ledger, and on one where nothing is old enough", () => {
    expect(pruneTelemetry(db, NOW)).toBe(0);
    seed(NOW);
    expect(pruneTelemetry(db, NOW)).toBe(0);
    expect(survivors()).toEqual([NOW]);
  });

  it("prunes once at start, then on the daily timer, and stops when disposed", () => {
    seed(NOW - TELEMETRY_RETENTION_MS - 1);
    const stop = startTelemetryRetention({ db, logger: silentLogger, now: () => NOW });
    try {
      // The start-time sweep is what makes a restart the moment the oldest rows
      // go: they have been sitting longest by definition.
      expect(survivors()).toEqual([]);
    } finally {
      stop();
    }
  });

  it("keeps its timer off the process's exit path", () => {
    // `unref`'d, so a server whose only remaining handle is this timer still
    // exits — and disposed at shutdown, which is the half a `unref` cannot do
    // for an already-closed database.
    const stop = startTelemetryRetention({ db, logger: silentLogger, now: () => NOW });
    stop();
    // Calling the disposer twice is harmless, as every disposer here must be.
    expect(() => {
      stop();
    }).not.toThrow();
  });
});
