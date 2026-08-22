// `POST /api/docs/{id}/patch` — the **anchored patch** (SPEC.md §9.2, rider
// signed 2026-08-12): an edit that names the text it expects to find instead of
// sending a whole new body.
//
// **This module is a front door, not a write path.** It does exactly two things
// the save path does not already do — find `old` in the body, and splice `new`
// in its place — and then hands the resulting body to `updateDocumentLocked`,
// which is the same function `PUT /api/docs/{id}` calls. Everything §9.2
// promises of "an ordinary write once applied" therefore holds *because it is
// the ordinary write*, not because this file remembered to do it: §11's
// validation before writing, §6's reconciliation with remaps and orphans
// reported, §4's one attributed commit and its window folding, the synchronous
// re-projection, the invalidation keys, the edit-session acknowledgment, and the
// "a save that changes nothing writes nothing" no-op. A second pipeline here
// would have to re-earn each of those and would drift from the first one the day
// after it was written.
//
// ## Why it presents a key when the request carries none
//
// SPEC.md §7 exempts a patch from presenting a key: *it names the text it
// expects to find, which is the same staleness check by another route*. The
// contract enforces that from the other side — `PatchDocRequestSchema` is strict
// and has no `key` field, so a caller cannot send one.
//
// But `updateDocumentLocked` writes a **body**, and a body-replacing write is
// exactly what §7 requires a key for; `assertDocumentKey` refuses one without.
// The resolution is not to weaken that check but to satisfy it honestly: this
// module reads the document, matches `old` against those bytes, and presents
// *that version's* key. It is not a bypass — it is the literal statement §7 asks
// a writer to make, "I am writing against this version", and here it is true by
// construction rather than by the caller's discipline, because the version being
// written against is the one this request just read and matched inside the
// document's own lane.
//
// It also leaves one real safety property in place. The two reads — this one and
// `updateDocumentLocked`'s — are separated only by a synchronous scan, but an
// *external* editor writing the file in that instant would make the presented
// key stale, and §7's refusal fires: the out-of-band edit is reported rather
// than silently overwritten by a body computed from bytes that are gone. That
// refusal is `stale_key`, which this route does not declare — it is still a
// contract `ApiError`, and the alternative (threading the loaded document past
// the check) would trade a correct refusal for a lost edit.
//
// ## Matching is byte-exact, and the scan is the only scan
//
// No trimming, no case folding, no whitespace collapsing, no regular
// expressions: what a caller read in `Doc.body` is what a caller quotes. The
// same left-to-right non-overlapping scan both **counts** matches for a refusal
// and **chooses** the ranges `all` replaces, so the number the server reports and
// the number a caller counts for itself can never disagree.
//
// ## `all` and §6
//
// Reconciliation needs nothing special from a multi-occurrence patch. The
// occurrences are found in the body *as read*, all of them, before anything is
// replaced; the result is one new body handed to one save, so `reconcileAnchors`
// sees a single old→new pair with several changed regions — which is precisely
// what a `PUT` carrying the same N edits produces. There is no per-occurrence
// reconciliation to sequence and no intermediate body any anchor is ever
// resolved against.

import type {
  Actor,
  AnchorReconciliation,
  ConflictError,
  Doc,
  PatchDocRequest,
  PatchRefusalReason,
} from "@corpus/contract";
import { HttpError } from "../errors.js";
import { documentKey } from "./key.js";
import { loadDocument } from "./read.js";
import { updateDocumentLocked } from "./update.js";
import type { DocsWorkspace, DocumentMutex, MutationResult } from "./write.js";

export interface PatchOutcome {
  readonly doc: Doc;
  readonly anchors: AnchorReconciliation;
  readonly result: MutationResult;
  /** Occurrences replaced — `1` unless `all` was set, and never `0`. */
  readonly replaced: number;
}

/**
 * The route's `409`, narrowed by a machine-readable `reason` and quantified by
 * `matches` — extra fields on `{code, message}` rather than a new `ERROR_CODES`
 * member, exactly as `reattachConflict` does, so every consumer that switches on
 * `code` keeps working unchanged.
 */
export function patchConflict(
  reason: PatchRefusalReason,
  matches: number,
  message: string,
): HttpError {
  const body: ConflictError & { readonly reason: PatchRefusalReason; readonly matches: number } = {
    code: "conflict",
    message,
    reason,
    matches,
  };
  return new HttpError(409, body);
}

export const noMatchMessage = (id: string): string =>
  `the text this patch quotes does not occur in the body of ${id}, so nothing was written. ` +
  "Re-read the document: it is not what you last read, or the excerpt was never in the body at " +
  "all — the frontmatter block is not part of it, and its fields are changed by naming them on " +
  "`PUT /api/docs/{id}`. Quote from what the body says now.";

export const multipleMatchesMessage = (id: string, matches: number): string =>
  `the text this patch quotes occurs ${String(matches)} times in the body of ${id} and the patch ` +
  "did not ask for `all`, so nothing was written. Quote more of the surrounding text until the " +
  "excerpt is unique, or send `all: true` if replacing every occurrence is what you meant.";

/**
 * Where `needle` occurs in `haystack`, **left to right and never overlapping**:
 * after a match, scanning resumes at the end of the text that matched, so `"aa"`
 * is found once in `"aaa"` and twice in `"aaaa"`.
 *
 * The scan runs over the body **as read** and is finished before a single
 * character is replaced, which is what makes a replacement containing `old`
 * inside it — `old: "cat"`, `new: "the cat sat"` — terminate rather than feed
 * itself: no occurrence is ever sought in text this patch produced. It is also
 * why the count in a refusal and the sites an `all` patch touches are the same
 * list rather than two computations that could disagree.
 *
 * `needle` is non-empty by schema (`old` is `.min(1)`), and the loop is written
 * so that it terminates anyway: a scan that can fail to advance is a hang inside
 * a request handler rather than a wrong answer. Two things are needed for that,
 * and neither alone is enough — the stride is floored at one character, *and*
 * a match found behind the cursor ends the scan, because `indexOf` clamps a
 * start position past the end of the string back to its length and would
 * otherwise report that position forever.
 */
export function findOccurrences(haystack: string, needle: string): number[] {
  const offsets: number[] = [];
  const stride = Math.max(needle.length, 1);
  let from = 0;
  for (let at = haystack.indexOf(needle, from); at >= from; at = haystack.indexOf(needle, from)) {
    offsets.push(at);
    from = at + stride;
  }
  return offsets;
}

/**
 * `haystack` with `replacement` spliced over each range starting at one of
 * `offsets` and running `length` characters.
 *
 * Built by concatenating the untouched spans between the ranges, so every
 * character outside the replaced ranges is carried through byte-for-byte — the
 * property the acceptance criteria state as "the rest of the body is
 * byte-identical afterwards".
 */
export function spliceAt(
  haystack: string,
  offsets: readonly number[],
  length: number,
  replacement: string,
): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (const offset of offsets) {
    pieces.push(haystack.slice(cursor, offset), replacement);
    cursor = offset + length;
  }
  pieces.push(haystack.slice(cursor));
  return pieces.join("");
}

export async function patchDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  request: PatchDocRequest,
): Promise<PatchOutcome> {
  return mutex.run(id, () => patchDocumentLocked(workspace, actor, id, request));
}

/**
 * Match and write, **in one critical section**.
 *
 * The lane is what makes the operation mean anything: a body that moved between
 * "`old` occurs exactly here" and "write this", or between two patches racing
 * each other, would put the replacement somewhere the caller never quoted. Both
 * reads and the write happen with this lane held, so the offsets the splice uses
 * describe the bytes the save overwrites.
 */
async function patchDocumentLocked(
  workspace: DocsWorkspace,
  actor: Actor,
  id: string,
  request: PatchDocRequest,
): Promise<PatchOutcome> {
  const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
  // The **body**, never the file's text: `parsed.body` is the markdown below the
  // frontmatter block, so an excerpt quoting frontmatter finds nothing and is
  // refused as a zero-match. There is no route by which a patch rewrites a key
  // it was never shown, and no excerpt can straddle the boundary.
  const found = findOccurrences(loaded.parsed.body, request.old);

  if (found.length === 0) throw patchConflict("no-match", 0, noMatchMessage(id));
  if (found.length > 1 && request.all !== true) {
    throw patchConflict("multiple-matches", found.length, multipleMatchesMessage(id, found.length));
  }

  // `all` lifts uniqueness, never the requirement to match: zero occurrences was
  // already refused above, whichever way it was set.
  const targets = request.all === true ? found : found.slice(0, 1);
  const nextBody = spliceAt(loaded.parsed.body, targets, request.old.length, request.new);

  // `job` travels into the ordinary write path rather than being read here, so
  // a patch files a document exactly as a `PUT` does (first writer wins) and an
  // unresolvable job is refused by the one rule that refuses it — SERVER-110's
  // `422`. A patch that accepted `job` and dropped it would be the silent
  // ignore §9.2 calls out by name.
  const { doc, anchors, result } = await updateDocumentLocked(workspace, actor, id, {
    body: nextBody,
    key: documentKey(loaded.text),
    ...(request.job === undefined ? {} : { job: request.job }),
  });

  // Reported whether or not anything was written: a no-op patch (`new` equal to
  // `old`) covered its occurrences and changed nothing, and the save's own
  // "only a real change" comparison is what decides the second half of that
  // sentence — `result.changed` is `false` and no commit was made.
  return { doc, anchors, result, replaced: targets.length };
}
