// Drift detection: does the projection still describe the files (SPEC.md §12
// M1)? Cheap enough to run in a pre-commit hook, so it never re-reads a file
// whose size and mtime are unchanged, and never parses a file that already has
// a row.
//
// `doctor` opens the database **read-only** and mutates nothing. It takes a
// config rather than a live server, so a pre-commit invocation can run
// in-process against a workspace whose server is not running — and WAL read
// concurrency makes it safe while one is.

import { readFileSync } from "node:fs";
import type { EffectiveModel } from "../semantic/state.js";
import { openProjectionReadonly, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { hashContent, readDocumentIdentity } from "./project-document.js";
import { listQueueEventFiles } from "./project-runtime.js";
import { enumerateDocuments, type EnumeratedFile } from "./roots.js";
import { checkSemanticIndex } from "./semantic-integrity.js";
import { collectUnindexableFiles } from "./unindexable.js";

export const DRIFT_KINDS = [
  /** A document file exists but the projection has no row for it. */
  "missing_row",
  /** The projection has a row for a path that no longer exists. */
  "orphan_row",
  /** The file's bytes no longer hash to what was projected. */
  "content_mismatch",
  /** A count the projection keeps no per-item detail for disagrees with the files. */
  "count_mismatch",
  /** The file is a document by location but neither it nor its frontmatter can be read. */
  "unparseable",
  /** Two files claim one id; only the first by path order is projected. */
  "duplicate_id",
] as const;

export type DriftKind = (typeof DRIFT_KINDS)[number];

export type Drift = {
  readonly kind: DriftKind;
  /** Workspace-relative path the drift concerns, when it concerns one. */
  readonly path?: string;
  readonly detail: string;
};

/**
 * A report-only finding: true, actionable, and not a disagreement with the
 * projection. It never moves {@link DoctorReport.ok} and never changes
 * `corpus db doctor`'s exit code (SERVER-038).
 *
 * `kind` is a **plain string**, matching the wire (`packages/contract`'s
 * `DoctorWarningKindSchema`, an open lowercase snake_case token): a warning
 * carries no verdict, so the only thing a consumer must do with an unrecognised
 * kind is print its `detail`. That openness is what lets a new report-only pass
 * — the unindexable-file walk, and now the semantic index's
 * (`semantic-integrity.ts`) — be a server change rather than a contract release.
 * Each pass still names its own kinds as a narrow constant for its own tests.
 */
export type DoctorWarning = {
  readonly kind: string;
  /** Workspace-relative path, absent on a finding that concerns no single file. */
  readonly path?: string | undefined;
  readonly detail: string;
  /** Short sha of the commit that introduced the file, absent when there is none. */
  readonly commit?: string | undefined;
};

export type DoctorReport = {
  readonly ok: boolean;
  readonly drift: readonly Drift[];
  /**
   * Report-only findings that are not drift, and that never move {@link ok}
   * (SERVER-038). Absent when the caller asked only the drift question:
   * {@link inspectProjection} is the boot catch-up's, and it must stay exactly
   * as cheap as it was.
   */
  readonly warnings?: readonly DoctorWarning[];
  readonly stats: {
    /** Document files found under the roots. */
    readonly files: number;
    readonly documents: number;
    /** Files whose bytes had to be read and hashed — zero on a warm, untouched workspace. */
    readonly hashed: number;
    /** Files that had to be parsed, i.e. those with no row to explain them. */
    readonly parsed: number;
    readonly durationMs: number;
  };
};

type DocumentRow = { readonly id: string; readonly path: string };
type HashRow = {
  readonly path: string;
  readonly hash: string;
  readonly size: number;
  readonly mtime_ms: number;
};

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const causeOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Classify a document file that produced no row: unparseable, a duplicate, or genuinely missing. */
function classifyUnprojected(
  file: EnumeratedFile,
  idOwner: ReadonlyMap<string, string>,
): Drift | null {
  let content: string;
  try {
    content = readFileSync(file.absPath, "utf8");
  } catch (error) {
    // Vanished between enumeration and read — a removal in flight, not drift.
    if (isEnoent(error)) return null;
    // Any other refusal is the reason there is no row, and saying nothing about
    // it would be the worst outcome available: the projection quietly does not
    // describe a document the workspace holds, and the check whose entire job is
    // to notice that reports `ok` (SERVER-064). `doctor` is the recovery loop for
    // the boot that now survives this, so it has to name the file.
    //
    // Classified as `unparseable` rather than `missing_row` on purpose. It is
    // literally true — a file that cannot be read has no readable frontmatter —
    // and, more to the point, the kind is what the boot catch-up keys on
    // (`watcher/catch-up.ts`): `missing_row` means "a repopulate would fix
    // this", and a repopulate cannot fix a file the process cannot read. Calling
    // it that would buy every boot of this workspace a full re-scan and a coarse
    // invalidate, forever, for no repair — exactly the cost SERVER-025 excluded
    // `unparseable` and `duplicate_id` to avoid, and for exactly the same
    // reason: this is a state of the *workspace*, and it survives every rebuild.
    return {
      kind: "unparseable",
      path: file.path,
      detail: `${file.path} is a document under a root but could not be read: ${causeOf(error)}`,
    };
  }

  const identity = readDocumentIdentity(file.root, file.path, content);
  if (identity.kind === "unparseable") {
    return { kind: "unparseable", path: file.path, detail: identity.reason };
  }
  if (identity.kind === "no-id") {
    return { kind: "unparseable", path: file.path, detail: identity.reason };
  }
  const owner = idOwner.get(identity.id);
  if (owner !== undefined && owner !== file.path) {
    return {
      kind: "duplicate_id",
      path: file.path,
      detail: `${file.path} claims id ${identity.id}, already projected from ${owner}`,
    };
  }
  return {
    kind: "missing_row",
    path: file.path,
    detail: `${file.path} is a document under a root but has no \`documents\` row`,
  };
}

function checkDocuments(
  db: ProjectionDb,
  files: readonly EnumeratedFile[],
  drift: Drift[],
): { documents: number; hashed: number; parsed: number } {
  const rows = db.prepare("SELECT id, path FROM documents").all() as DocumentRow[];
  const rowByPath = new Map(rows.map((row) => [row.path, row]));
  const idOwner = new Map(rows.map((row) => [row.id, row.path]));
  const hashes = new Map(
    (db.prepare("SELECT path, hash, size, mtime_ms FROM file_hashes").all() as HashRow[]).map(
      (row) => [row.path, row],
    ),
  );

  let hashed = 0;
  let parsed = 0;
  const present = new Set<string>();

  for (const file of files) {
    present.add(file.path);
    if (!rowByPath.has(file.path)) {
      parsed += 1;
      const entry = classifyUnprojected(file, idOwner);
      if (entry !== null) drift.push(entry);
      continue;
    }

    const known = hashes.get(file.path);
    if (known !== undefined && known.size === file.size && known.mtime_ms === file.mtimeMs) {
      // The cheap pass: unchanged size and mtime means unchanged bytes for every
      // editor that is not deliberately lying, and that is what keeps `doctor`
      // inside a pre-commit hook's budget.
      continue;
    }

    hashed += 1;
    let actual: string;
    try {
      actual = hashContent(readFileSync(file.absPath));
    } catch {
      continue;
    }
    if (known === undefined) {
      drift.push({
        kind: "content_mismatch",
        path: file.path,
        detail: `${file.path} has a row but no recorded content hash`,
      });
      continue;
    }
    if (actual !== known.hash) {
      drift.push({
        kind: "content_mismatch",
        path: file.path,
        detail: `${file.path} changed on disk since it was projected`,
      });
    }
  }

  for (const row of rows) {
    if (present.has(row.path)) continue;
    drift.push({
      kind: "orphan_row",
      path: row.path,
      detail: `${row.path} is projected as ${row.id} but no such file exists under any root`,
    });
  }

  return { documents: rows.length, hashed, parsed };
}

/**
 * The queue mirror is the one table with no per-file bookkeeping, so it is
 * checked by count. Only `evt_*.json` counts as an event (Sprint-003
 * Adjudication 2): every `init`-produced workspace keeps a `.gitkeep` in each
 * status directory, and counting those would make every real workspace report
 * drift forever.
 */
function checkEvents(db: ProjectionDb, drift: Drift[]): void {
  const files = listQueueEventFiles(db.config.corpusDir).length;
  const row = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  if (files !== row.n) {
    drift.push({
      kind: "count_mismatch",
      detail: `.corpus/queue holds ${files} evt_*.json file(s) but the projection has ${row.n} event row(s)`,
    });
  }
}

/**
 * Compare the files against an **already open** projection.
 *
 * The in-process form, for a caller that is holding the server's own handle and
 * would otherwise open a second connection to the database it is already
 * attached to — see the boot catch-up in `watcher/catch-up.ts`. It reads and
 * mutates exactly what {@link doctor} does; the only difference is who owns the
 * connection.
 */
export function inspectProjection(db: ProjectionDb): DoctorReport {
  const startedAt = Date.now();
  const files = enumerateDocuments(db.config.workspaceRoot);
  const drift: Drift[] = [];
  const counts = checkDocuments(db, files, drift);
  checkEvents(db, drift);
  return {
    ok: drift.length === 0,
    drift,
    stats: {
      files: files.length,
      documents: counts.documents,
      hashed: counts.hashed,
      parsed: counts.parsed,
      durationMs: Date.now() - startedAt,
    },
  };
}

/**
 * Compare the projection against the files. Returns a structured report;
 * turning it into output and an exit code belongs to the CLI (CLI-004).
 *
 * This is also where the recovery pass runs (SERVER-038): the files
 * `classifyPath` refuses are invisible to the drift check by construction, so
 * they are collected separately and reported as `warnings`, which never move
 * `ok` and never change the exit code. It runs here rather than inside
 * {@link inspectProjection} because the other caller of that function is the
 * boot catch-up, which asks a narrower question on the boot path and must keep
 * paying only for that one. `durationMs` covers both passes — a stat that
 * excluded half the work would be the wrong number to watch.
 */
export interface DoctorOptions {
  /**
   * What the caller can embed with right now, for the semantic index's identity
   * check (`semantic-integrity.ts`). Defaults to `unknown`, which skips the
   * comparison entirely: `doctor` must stay runnable with no server — a
   * pre-commit hook, a workspace whose server is stopped — and a read-only file
   * check has no standing to resolve a provider or to claim that nothing could.
   */
  readonly effectiveModel?: EffectiveModel | undefined;
}

export function doctor(config: ProjectionConfig, options: DoctorOptions = {}): DoctorReport {
  const startedAt = Date.now();
  const db = openProjectionReadonly(config);
  let report: DoctorReport;
  let semantic: ReturnType<typeof checkSemanticIndex>;
  try {
    report = inspectProjection(db);
    // Inside this connection's lifetime, and deliberately **not** inside
    // `inspectProjection`: the other caller of that function is the boot
    // catch-up, which asks a narrower question on the boot path and must keep
    // paying only for that one (SERVER-025). A semantic pass there would run on
    // every boot, and a chunk finding would trigger a full repopulation.
    semantic = checkSemanticIndex(db, options.effectiveModel ?? { kind: "unknown" });
  } finally {
    db.close();
  }
  const drift = [...report.drift, ...semantic.drift];
  return {
    ...report,
    ok: drift.length === 0,
    drift,
    warnings: [...collectUnindexableFiles(config.workspaceRoot), ...semantic.warnings],
    stats: { ...report.stats, durationMs: Date.now() - startedAt },
  };
}
