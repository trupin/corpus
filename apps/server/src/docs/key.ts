// SPEC.md §7's **key**: derived here, checked here, and nowhere else.
//
// > Reading a document gives you its key. Writing it back means presenting that
// > key, and the write is refused if the document has changed since: the key
// > names the version you saw, so a stale one is exactly the statement "I am
// > about to overwrite something I never read".
//
// **The one thing this module must not do is make the check optional.** §7
// replaced the per-document edit lock for a single reason — *a lock is
// forgettable, because forgetting it still lets the write through* — and a server
// that accepts a body-replacing write with no key has rebuilt that lock one layer
// down, where it is harder to see. So a missing key on a keyed write is refused
// exactly as a stale one is: `packages/contract`'s `.refine()` answers it before
// any handler runs, and {@link assertDocumentKey} answers it again for the
// callers that never cross the HTTP boundary (`docs/patch.ts`, and any future
// in-process verb that replaces a body without going through a route).
//
// The derivation is CONTRACT-049's, recorded at `packages/contract/src/schemas/
// key.ts` with the five constraints it was measured against and everything that
// was rejected. It is not re-argued here — this module implements it.

import { createHash } from "node:crypto";
import {
  MISSING_DOCUMENT_KEY_MESSAGE,
  updateNeedsDocumentKey,
  type Doc,
  type UpdateDocRequest,
} from "@corpus/contract";
import { badRequest, staleKey } from "../errors.js";

/**
 * The key naming the version whose stored bytes are `stored`: the lowercase
 * hexadecimal SHA-256 digest of the document file exactly as it sits on disk —
 * the frontmatter block and the body together, un-normalised and
 * un-re-serialised.
 *
 * **The input is always a file's own bytes, never a request's copy of them and
 * never a re-serialization of the parsed model.** That is what makes an
 * out-of-band edit invalidate a key with nothing having to notice: the watcher,
 * the projection and the commit history are all uninvolved, because the file is
 * the only input. It is also why `LoadedDocument.text` — the bytes read in *this*
 * request — is the only thing ever passed here.
 *
 * Hashing the decoded string rather than the raw `Buffer` is deliberate and
 * costs nothing: `loadDocument` already holds the file as UTF-8 text to answer
 * with it, re-encoding is exactly the round trip that produced it, and reading
 * the file a second time as bytes would put an extra read on the hottest path
 * for a digest of the same octets.
 */
export function documentKey(stored: string): string {
  return createHash("sha256").update(stored, "utf8").digest("hex");
}

/**
 * §7's check, in the one place it can be honest: **inside the document's write
 * lane, against the bytes this request just read off disk.**
 *
 * Reading, comparing and writing have to sit in one critical section or the
 * check is decorative — a comparison against a file another writer replaces
 * before the write lands refuses nothing. `updateDocumentLocked` holds the lane
 * and loads the file itself, so `stored` here is the same `text` the save is
 * about to overwrite.
 *
 * Three outcomes, and the middle one is the point:
 *
 * - **No key, and none needed** — the write names its own delta (a tag, a
 *   status, `reviewed`, a view key), which merges with whatever else happened.
 *   Nothing is checked because nothing can be silently destroyed.
 * - **No key, and one needed** — a `400` naming `body.key`, the same refusal the
 *   contract's refinement produces at the boundary. Required means required.
 * - **A key, whatever the write changes** — always compared. §7 makes presenting
 *   a key mean *"I am writing against this version"*, so a stale one is refused
 *   even on a delta write; a caller that always sends back what it read
 *   therefore needs no rule about which fields are which.
 *
 * `current` is a thunk because a refusal carries the whole document and the
 * happy path must not pay to build one.
 */
export function assertDocumentKey(
  id: string,
  stored: string,
  patch: UpdateDocRequest,
  current: () => Doc,
): void {
  const presented = patch.key;
  if (presented === undefined) {
    if (!updateNeedsDocumentKey(patch)) return;
    throw badRequest("request failed validation", [
      { path: "body.key", message: MISSING_DOCUMENT_KEY_MESSAGE },
    ]);
  }
  if (presented === documentKey(stored)) return;
  throw staleKey(
    `the write to ${id} was made against a version this document no longer is: it changed since ` +
      "you read it, so the write was refused rather than overwriting something you never saw. " +
      "Nothing was written — `doc` is the document as it now stands, `doc.key` is the fresh key, " +
      "and the content you tried to save is yours to reconcile and resend.",
    current(),
  );
}
