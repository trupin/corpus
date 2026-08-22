// The §6 catch-all: keeping anchors attached through edits Corpus never saw.
//
// A document changed by an outside editor never reached the write path, so its
// `anchors` map still describes the body as it was. SPEC.md §6 says the watcher
// runs the same `reconcileAnchors` the save path runs, with **the last committed
// version (git HEAD) as `oldBody`**, before projecting. There is exactly one
// anchor engine (`src/anchors/`); this module supplies its inputs and persists
// its output, and implements none of its judgment.
//
// Two boundaries are deliberate:
//
// - **No commit.** The reconciled frontmatter is written back through the same
//   `setFrontmatterFields` path every mutation uses, and registered as a
//   self-write so it does not loop. Committing it is SERVER-005's, because git
//   authorship belongs to the write path (§4) — sprint-004 Adjudication 3.
//   Until then `HEAD` only advances when someone commits, so a second
//   out-of-band edit reconciles against an older `oldBody`: still a valid
//   `oldBody → newBody` diff, just a wider one.
// - **Never clobber.** A file whose `anchors` block does not parse as a whole is
//   left exactly as it is. Rewriting it would silently drop the entries that did
//   not parse, which is a worse outcome than an unreconciled anchor.

import { randomBytes } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AnchorIdSchema, TextQuoteSelectorSchema } from "@corpus/contract";
import { z } from "zod";
import { reconcileAnchors, type ReconcileReport } from "../anchors/index.js";
import {
  DocumentParseError,
  parseDocument,
  serializeDocument,
  setFrontmatterFields,
} from "../core/index.js";
import { silentLogger, type Logger } from "../logger.js";
import { readHeadVersion, type ReadHeadVersion } from "./git-head.js";
import type { SelfWriteRegistry } from "./self-writes.js";

/**
 * Strict on purpose, unlike the projection's per-entry reader: the projection
 * only *indexes* what it can read, while this module *rewrites the file*, so one
 * unreadable entry has to abort the whole write rather than disappear from it.
 */
const AnchorsFieldSchema = z.record(AnchorIdSchema, TextQuoteSelectorSchema);

export type OutOfBandOutcome =
  /** Nothing to reconcile — no anchors, no committed version, or an unchanged body. */
  | { readonly kind: "skipped"; readonly reason: string }
  /** Reconciliation ran and every selector still described the body. */
  | { readonly kind: "unchanged"; readonly report: ReconcileReport }
  /** The `anchors` map was rewritten on disk. */
  | { readonly kind: "reconciled"; readonly report: ReconcileReport };

export interface ReconcileOutOfBandOptions {
  readonly workspaceRoot: string;
  readonly absPath: string;
  /** Workspace-relative POSIX path — what `git show HEAD:` is asked for. */
  readonly relativePath: string;
  /** The bytes the watcher already read; re-reading here would race the next edit. */
  readonly content: string;
  readonly selfWrites: SelfWriteRegistry;
  readonly logger?: Logger | undefined;
  readonly readHead?: ReadHeadVersion | undefined;
}

/** Writes `text` atomically, so a reader never sees a half-written document. */
function writeAtomically(absPath: string, text: string, selfWrites: SelfWriteRegistry): void {
  const tmpPath = join(dirname(absPath), `.tmp-${randomBytes(6).toString("hex")}.md`);
  // Registered *before* the rename: the watcher can see the new file the instant
  // it lands, and an entry recorded afterwards would lose that race and send the
  // write-back around the loop again.
  selfWrites.record(absPath, text);
  try {
    writeFileSync(tmpPath, text, "utf8");
    renameSync(tmpPath, absPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // The temp file never existed, or is already gone.
    }
    throw error;
  }
}

/**
 * Reconciles one out-of-band document edit and persists the result. Returns what
 * happened; the caller projects the file afterwards either way.
 */
export function reconcileOutOfBandEdit(options: ReconcileOutOfBandOptions): OutOfBandOutcome {
  const logger = options.logger ?? silentLogger;
  const readHead = options.readHead ?? readHeadVersion;

  let parsed;
  try {
    parsed = parseDocument(options.content, options.relativePath);
  } catch (error) {
    // Unparseable is the projection's problem to report, not ours.
    if (error instanceof DocumentParseError) return { kind: "skipped", reason: "unparseable" };
    throw error;
  }

  const anchorsField: unknown = parsed.data["anchors"];
  if (anchorsField === undefined || anchorsField === null) {
    return { kind: "skipped", reason: "no anchors" };
  }
  const anchors = AnchorsFieldSchema.safeParse(anchorsField);
  if (!anchors.success) {
    logger.info("skipping anchor reconciliation: malformed anchors block", {
      path: options.relativePath,
    });
    return { kind: "skipped", reason: "malformed anchors" };
  }
  if (Object.keys(anchors.data).length === 0) return { kind: "skipped", reason: "no anchors" };

  const head = readHead(options.workspaceRoot, options.relativePath);
  if (head === null) return { kind: "skipped", reason: "no committed version" };

  let committed;
  try {
    committed = parseDocument(head, options.relativePath);
  } catch (error) {
    if (error instanceof DocumentParseError) {
      return { kind: "skipped", reason: "committed version unparseable" };
    }
    throw error;
  }
  if (committed.body === parsed.body) return { kind: "skipped", reason: "body unchanged" };

  const result = reconcileAnchors(committed.body, parsed.body, anchors.data);
  const next = setFrontmatterFields(parsed, { anchors: result.anchors });
  // `setFrontmatterFields` returns its input untouched when nothing changed, so
  // object identity is the honest test for "the file needs rewriting".
  if (next === parsed) return { kind: "unchanged", report: result.report };

  writeAtomically(options.absPath, serializeDocument(next), options.selfWrites);
  logger.info("reconciled anchors after an out-of-band edit", {
    path: options.relativePath,
    remapped: result.report.remapped.length,
    orphaned: result.report.orphaned.length,
    // No commit is named here, and the absence is deliberate. This used to log
    // `commit: "deferred"` above a comment pointing at a `reconcile:` commit
    // SERVER-007 specified and nothing ever built — which is why an out-of-band
    // edit went uncommitted for so long without anyone noticing (SERVER-090).
    // The commit is the *caller's*: `watcher.ts` commits the file this function
    // has just finished rewriting, authored `user`, so the remapped `anchors`
    // block and the person's own edit land together as the one change they are.
  });
  return { kind: "reconciled", report: result.report };
}
