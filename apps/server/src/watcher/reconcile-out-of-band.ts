// The §6 catch-alls: keeping anchors attached through edits Corpus never saw,
// and keeping a digest honest about what it covers through the same edits.
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
//
// The digest half (SPEC.md §6's rider, signed 2026-09-05) is here rather than in
// a pass of its own because it reads the same two bodies and writes the same
// frontmatter: an out-of-band edit that deletes or revises a turn at or before
// the digest's watermark marks the digest stale, in the same rewrite and so in
// the same commit. Nothing here composes, edits or repairs a digest — the rider
// makes that the resident's, and this pass only ever sets one boolean.

import { randomBytes } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AnchorIdSchema, TextQuoteSelectorSchema, type ThreadDigest } from "@corpus/contract";
import { z } from "zod";
import { reconcileAnchors, type ReconcileReport } from "../anchors/index.js";
import { coveredTurnsChanged, stalenessPatch, storedDigest } from "../core/digest.js";
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
  /** The pass ran and found nothing to record: every selector still described the body, and no covered turn changed. */
  | { readonly kind: "unchanged"; readonly report: ReconcileReport }
  /** The frontmatter — the `anchors` map, the digest's `stale` flag, or both — was rewritten on disk. */
  | {
      readonly kind: "reconciled";
      readonly report: ReconcileReport;
      /**
       * Exactly what was written. The caller commits this rather than re-reading
       * the file (SERVER-142): re-reading would race the next edit, and the
       * commit has to hold the remapped `anchors` block and the person's own
       * edit together as the one change they are.
       */
      readonly text: string;
    };

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
 * The report a rewrite that reconciled no anchors carries — every list empty.
 *
 * A digest can go stale on a file that has no anchors at all, so `"reconciled"`
 * is no longer only ever an anchor outcome. Empty sets are exactly what the
 * commit trailer treats as nothing to say (`git/commit.ts`'s `mergeAnchors`), so
 * the caller needs no new branch and no trailer appears.
 */
const NO_ANCHOR_WORK: ReconcileReport = { unchanged: [], remapped: [], orphaned: [] };

/**
 * Is the digest on disk the one the committed version carried — same prose, same
 * coverage?
 *
 * The guard on marking anything stale. An edit that rewrote the body **and** the
 * digest in one save is somebody stating fresh coverage of the text they just
 * wrote, and the rider makes that person the only party allowed to say what a
 * digest covers. Marking their new digest stale against the old body would be
 * the server contradicting the one writer it has.
 */
const digestSurvivedThisEdit = (committed: ThreadDigest | null, current: ThreadDigest): boolean =>
  committed !== null &&
  committed.body === current.body &&
  committed.watermark === current.watermark;

/**
 * Reconciles one out-of-band document edit and persists the result. Returns what
 * happened; the caller projects the file afterwards either way.
 *
 * **Two catch-alls, one rewrite.** The anchors and the digest are read from the
 * same pair of bodies — the committed one and the one on disk — recorded in the
 * same frontmatter, and landed in the caller's single commit alongside the
 * person's own edit. A second pass would mean a second commit, and a moment
 * between them in which the file says something untrue.
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

  // §6's digest, and only one this pass could still change: a thread with none,
  // and one already marked stale, have nothing to record. Read first, because it
  // is what decides whether a file with no anchors is worth asking git about.
  const digest = storedDigest(parsed.data["digest"]);
  const digestLive = digest !== null && !digest.stale;

  const anchorsField: unknown = parsed.data["anchors"];
  const anchors =
    anchorsField === undefined || anchorsField === null
      ? null
      : AnchorsFieldSchema.safeParse(anchorsField);
  if (anchors !== null && !anchors.success) {
    // Refused whole, digest or no digest. The strictness this module opens with
    // is about *rewriting the file*, and the digest half rewrites it too — so an
    // `anchors` block nobody can read stops this pass rather than being carried
    // through a re-serialization it was never checked against.
    logger.info("skipping anchor reconciliation: malformed anchors block", {
      path: options.relativePath,
    });
    return { kind: "skipped", reason: "malformed anchors" };
  }
  const selectors = anchors === null ? {} : anchors.data;
  const hasAnchors = Object.keys(selectors).length > 0;
  if (!hasAnchors && !digestLive) return { kind: "skipped", reason: "no anchors" };

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

  const result = hasAnchors ? reconcileAnchors(committed.body, parsed.body, selectors) : null;
  const stale =
    digest !== null &&
    digestSurvivedThisEdit(storedDigest(committed.data["digest"]), digest) &&
    coveredTurnsChanged(digest, committed.body, parsed.body);

  const next = setFrontmatterFields(parsed, {
    ...(result === null ? {} : { anchors: result.anchors }),
    ...stalenessPatch(digest, stale),
  });
  // `setFrontmatterFields` returns its input untouched when nothing changed, so
  // object identity is the honest test for "the file needs rewriting".
  const report = result?.report ?? NO_ANCHOR_WORK;
  if (next === parsed) return { kind: "unchanged", report };

  const text = serializeDocument(next);
  writeAtomically(options.absPath, text, options.selfWrites);
  logger.info("reconciled an out-of-band edit", {
    path: options.relativePath,
    remapped: report.remapped.length,
    orphaned: report.orphaned.length,
    digestStale: stale,
    // No commit is named here, and the absence is deliberate. This used to log
    // `commit: "deferred"` above a comment pointing at a `reconcile:` commit
    // SERVER-007 specified and nothing ever built — which is why an out-of-band
    // edit went uncommitted for so long without anyone noticing (SERVER-090).
    // The commit is the *caller's*: `watcher.ts` commits the file this function
    // has just finished rewriting, authored `user`, so the remapped `anchors`
    // block, the digest's staleness and the person's own edit land together as
    // the one change they are.
  });
  return { kind: "reconciled", report, text };
}
