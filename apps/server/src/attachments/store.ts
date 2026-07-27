// Where attachment bytes live, and the only code that puts them there or takes
// them away (SPEC.md §4, §6).
//
// `.corpus/attachments/<thread-id>/<turn-ts>/<filename>` — and `.corpus/` is
// gitignored by `corpus init`, which is the whole mechanism by which bytes stay
// out of history. Nothing here stages, commits, or touches git.

import { mkdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storedNames } from "./names.js";

/** Directory under `.corpus/` that holds every attachment. */
export const ATTACHMENTS_DIRNAME = "attachments";

export function attachmentsRootOf(corpusDir: string): string {
  return join(corpusDir, ATTACHMENTS_DIRNAME);
}

/**
 * A turn's attachment directory.
 *
 * **The turn ts is used verbatim, colons included** (`2026-07-19T10:05:00Z`) —
 * that is the layout SPEC.md §4 fixes, and colons are ordinary filename
 * characters on the POSIX filesystems Corpus targets (macOS, Linux; Node ≥ 22).
 * Windows is not a supported *host*. Do not "fix" this into `10-05-00`: the
 * directory name is the turn's identity, the committed markdown reference
 * spells it out, and changing it silently breaks every reference already on
 * disk.
 */
export function turnAttachmentDir(
  attachmentsRoot: string,
  threadId: string,
  turnTs: string,
): string {
  return join(attachmentsRoot, threadId, turnTs);
}

export function threadAttachmentDir(attachmentsRoot: string, threadId: string): string {
  return join(attachmentsRoot, threadId);
}

/** One stored file: the name it landed under and how big it is. */
export interface StoredAttachment {
  readonly name: string;
  readonly size: number;
}

export interface WriteAttachmentsRequest {
  readonly attachmentsRoot: string;
  readonly threadId: string;
  readonly turnTs: string;
  readonly files: readonly File[];
}

/**
 * Write a turn's uploads, in upload order, returning the names they landed
 * under.
 *
 * **All-or-nothing.** A failure part-way through removes the whole turn
 * directory before propagating, so the caller never has to reason about a
 * half-populated one — the alternative is a committed reference to a file that
 * was never written, which §6 forbids outright.
 *
 * Bytes are read from the `File` parts the multipart parser already
 * materialised, so this does no network work and the ordering guarantee
 * ("timestamp first, bytes, then the markdown") holds without a queue.
 */
export async function writeTurnAttachments(
  request: WriteAttachmentsRequest,
): Promise<StoredAttachment[]> {
  const { attachmentsRoot, threadId, turnTs, files } = request;
  if (files.length === 0) return [];

  const names = storedNames(files.map((file) => file.name));
  const directory = turnAttachmentDir(attachmentsRoot, threadId, turnTs);
  const stored: StoredAttachment[] = [];

  mkdirSync(directory, { recursive: true });
  try {
    for (const [index, file] of files.entries()) {
      const name = names[index];
      if (name === undefined) continue;
      const bytes = Buffer.from(await file.arrayBuffer());
      // `wx`: the name was deduplicated in memory, so an existing file here
      // means something else is writing this turn's directory — better to fail
      // than to overwrite bytes somebody is about to reference.
      writeFileSync(join(directory, name), bytes, { flag: "wx" });
      stored.push({ name, size: bytes.byteLength });
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return stored;
}

/**
 * Remove one turn's bytes. Tolerant of a directory that was never created — a
 * turn with no attachments is the common case, and its deletion must not
 * become an error path.
 */
export function removeTurnAttachments(
  attachmentsRoot: string | undefined,
  threadId: string,
  turnTs: string,
): void {
  if (attachmentsRoot === undefined) return;
  rmSync(turnAttachmentDir(attachmentsRoot, threadId, turnTs), { recursive: true, force: true });
  pruneEmpty(threadAttachmentDir(attachmentsRoot, threadId));
}

/** Remove a whole thread's bytes, for a thread deletion or a last-turn cascade. */
export function removeThreadAttachments(
  attachmentsRoot: string | undefined,
  threadId: string,
): void {
  if (attachmentsRoot === undefined) return;
  rmSync(threadAttachmentDir(attachmentsRoot, threadId), { recursive: true, force: true });
}

/** Drop a thread directory whose last turn directory just went. Never fatal. */
function pruneEmpty(directory: string): void {
  try {
    rmdirSync(directory);
  } catch {
    // ENOTEMPTY (sibling turns remain) and ENOENT (never existed) are both
    // ordinary outcomes; nothing else about a deletion depends on this.
  }
}
