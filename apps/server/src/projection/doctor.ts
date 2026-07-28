// Drift detection: does the projection still describe the files (SPEC.md §15
// M1)? Cheap enough to run in a pre-commit hook, so it never re-reads a file
// whose size and mtime are unchanged, and never parses a file that already has
// a row.
//
// `doctor` opens the database **read-only** and mutates nothing. It takes a
// config rather than a live server, so a pre-commit invocation can run
// in-process against a workspace whose server is not running — and WAL read
// concurrency makes it safe while one is.

import { readFileSync } from "node:fs";
import { openProjectionReadonly, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { hashContent, readDocumentIdentity } from "./project-document.js";
import { listQueueEventFiles } from "./project-runtime.js";
import { enumerateDocuments, type EnumeratedFile } from "./roots.js";

export const DRIFT_KINDS = [
  /** A document file exists but the projection has no row for it. */
  "missing_row",
  /** The projection has a row for a path that no longer exists. */
  "orphan_row",
  /** The file's bytes no longer hash to what was projected. */
  "content_mismatch",
  /** A count the projection keeps no per-item detail for disagrees with the files. */
  "count_mismatch",
  /** The file is a document by location but its frontmatter cannot be read. */
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

export type DoctorReport = {
  readonly ok: boolean;
  readonly drift: readonly Drift[];
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

/** Classify a document file that produced no row: unparseable, a duplicate, or genuinely missing. */
function classifyUnprojected(
  file: EnumeratedFile,
  idOwner: ReadonlyMap<string, string>,
): Drift | null {
  let content: string;
  try {
    content = readFileSync(file.absPath, "utf8");
  } catch {
    // Vanished between enumeration and read — a removal in flight, not drift.
    return null;
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
 */
export function doctor(config: ProjectionConfig): DoctorReport {
  const db = openProjectionReadonly(config);
  try {
    return inspectProjection(db);
  } finally {
    db.close();
  }
}
