import type { Actor, ThreadDigest, WriteDigestRequest } from "@corpus/contract";
import { digestToStored } from "../core/digest.js";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { HttpError } from "../errors.js";
import { loadThread, type LoadedThread } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

/**
 * `PUT /api/threads/{id}/digest` and `DELETE /api/threads/{id}/digest` — SPEC.md
 * §6's rider, signed 2026-09-05.
 *
 * *"A thread may carry a digest — one, written by its resident, never by the
 * server."* Every sentence of that is a constraint, and the two this module
 * exists to keep are the two the server could otherwise break by accident:
 *
 * - **Never by the server.** Nothing here composes prose, edits it, shortens it
 *   or repairs it. The only value this module ever puts in `body` is the string
 *   the request carried, and the only thing the staleness path writes is a
 *   boolean beside it.
 * - **Written by its resident.** Enforced through the thread's *state* rather
 *   than the acting party, as CONTRACT-096 decided: a thread with no resident is
 *   refused, and a thread with one has exactly one resident to be.
 *
 * The watermark is the third: the server stamps it, because it is the only party
 * that knows what the newest turn is at the instant of the write.
 */

/** What a write or a clear produces, before the route dresses it for the wire. */
export interface DigestChange {
  readonly threadId: string;
  /** The digest **after** the call — the stored value, or `null` after a clear. */
  readonly digest: ThreadDigest | null;
  /** `null` when nothing was written: a clear with nothing to clear. */
  readonly result: MutationResult | null;
}

/**
 * A write's outcome. It always writes — the three refusals throw — so `result`
 * is never null here, and the route needs no branch its clear counterpart does.
 */
export type DigestWritten = DigestChange & {
  readonly digest: ThreadDigest;
  readonly result: MutationResult;
};

/**
 * The refusal both verbs make: this thread has no resident, and a digest is the
 * resident's (CONTRACT-096 decision 3).
 *
 * `unknown_recipient` rather than a new code, and the component's own words say
 * why it fits: it already publishes *"this workspace holds no such thread, or
 * that thread holds no resident and is therefore not a lane at all"*, whose
 * second clause is this refusal exactly, and whose remedy — designate a resident
 * on that thread — is the remedy here. The message is this route's own, because
 * `errors.ts`'s two existing spellings tell a caller to post without a recipient
 * or to omit a scope, and neither is anything to do with a digest.
 *
 * **The consequence CONTRACT-096 recorded rather than discovered**: resolving a
 * thread releases its resident (§7), so a resolved thread's digest can afterwards
 * be neither rewritten nor removed. The write half is the rider's own — *"it is
 * corrected only by a resident writing it again"* — and the contract extends it
 * to the clear so the surface answers one question about a thread rather than
 * two. It stays honest either way: the stranded digest keeps its watermark, and
 * it still goes stale when a turn it covers is deleted or revised.
 */
function digestNeedsResident(id: string): HttpError {
  return new HttpError(422, {
    code: "unknown_recipient",
    message:
      `\`${id}\` holds no resident, and a digest is the resident's (SPEC.md §6). Nothing was ` +
      "written — designate a resident on that thread first with " +
      `\`POST /api/threads/${id}/resident\`. A thread that was resolved has released its ` +
      "resident, and a digest it already carries stays as it is: still readable, still marked " +
      "stale when a turn it covers changes, and correctable by designating a resident again.",
    recipient: id,
  });
}

/** A `422` about the act, carrying `bad_request` — the write's second refusal. */
function digestRefused(message: string, path: string): HttpError {
  return new HttpError(422, { code: "bad_request", message, issues: [{ path, message }] });
}

export const EMPTY_DIGEST_MESSAGE =
  "a digest may not be blank: an empty write is not a clear, and clearing a digest is " +
  "`DELETE /api/threads/{id}/digest`. Nothing was written.";

export const NO_TURNS_MESSAGE =
  "this thread holds no turns, so there is nothing for a digest to cover and no turn for its " +
  "watermark to name (SPEC.md §6). Nothing was written — a digest accounts for a conversation, " +
  "and this one has not started.";

/** The thread, refused unless it may hold a digest at all. */
function requireResident(thread: LoadedThread): LoadedThread {
  if (thread.resident === null) throw digestNeedsResident(thread.id);
  return thread;
}

/**
 * Every key a digest write or clear makes stale.
 *
 * `["threads", id]` is the digest's own — the contract names this verb in that
 * key's emitters. `["docs"]` and `["docs", id]` come with the `updated` stamp
 * below: a listing row carries `updated`, so a frame that moved it and did not
 * say so would leave the board sorting on a value it no longer holds.
 * `["tree"]` is deliberately absent and `mayChangeTree` left unset, for
 * `resident.ts`'s reason: a digest is only ever written on a thread with a
 * resident, a resident only ever sits on a standalone thread, and a standalone
 * thread belongs to no `data/docs/` folder — so no badge can move.
 */
const digestKeys = (id: string) => [DOCS_KEY, docKey(id), threadKey(id)];

/**
 * Write `id`'s digest, stamping the watermark this server sees at this instant.
 *
 * **The watermark is the newest turn's `ts`, taken after the lane opens**, which
 * is the whole reason the request carries no watermark field: between a writer
 * reading the thread and its digest arriving, a turn may land, and a coverage
 * claim made before that turn would silently over-claim it. Reading it inside
 * the document's lane is what makes the stamp true of the file this write is
 * about to produce rather than of one that has moved on.
 *
 * **A write clears `stale`.** The rider makes rewriting the digest the only
 * thing that corrects staleness, so a fresh account of the conversation as it
 * now stands is by construction an account of text that is there.
 *
 * Three refusals and no others. `404` is {@link loadThread}'s. `422`
 * `unknown_recipient` is {@link digestNeedsResident}. `422` `bad_request` is a
 * blank body or a thread with no turns — both refusals about the act, since no
 * body sent to this route makes either land, which is this repository's line
 * between `400` and `422`.
 */
export async function writeDigest(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  request: WriteDigestRequest,
): Promise<DigestWritten> {
  // Before the lane, so a refusable write never queues behind an unrelated save
  // — `resident.ts`'s arrangement, and re-asked inside the lane below because
  // the answer can change while a caller waits.
  requireResident(loadThread(workspace, id));
  if (request.body.trim() === "") throw digestRefused(EMPTY_DIGEST_MESSAGE, "body");

  return mutex.run(id, async (): Promise<DigestWritten> => {
    const thread = requireResident(loadThread(workspace, id));
    const newest = thread.turns.at(-1);
    if (newest === undefined) throw digestRefused(NO_TURNS_MESSAGE, "body");

    const digest: ThreadDigest = {
      body: request.body,
      watermark: newest.ts,
      stale: false,
    };
    const result = await writeDigestField(workspace, thread, actor, digest, {
      subject: `digest write: ${thread.title} (${id}) by ${actor}`,
    });
    return { threadId: id, digest, result };
  });
}

/**
 * Remove `id`'s digest.
 *
 * **Idempotent**, the way releasing an undesignated resident is: a thread with
 * no digest writes nothing, commits nothing and answers `200` with `digest`
 * null. The caller often cannot know, and a clear with nothing to clear is not
 * an error. It still answers with the shape the write does, because a clear that
 * *does* write can raise §11's warnings and a rejected auto-commit has to be
 * visible somewhere.
 *
 * **What is cleared turns on the key, not on whether it parsed.** A `digest:`
 * block a hand edit left ill-shaped reads as no digest everywhere else, but a
 * clear that declined to remove it would leave it on the file forever with no
 * verb able to touch it — `resident.ts`'s release makes the same distinction for
 * the same reason.
 */
export async function clearDigest(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
): Promise<DigestChange> {
  requireResident(loadThread(workspace, id));

  return mutex.run(id, async (): Promise<DigestChange> => {
    const thread = requireResident(loadThread(workspace, id));
    if (!Object.hasOwn(thread.loaded.parsed.data, "digest")) {
      return { threadId: id, digest: null, result: null };
    }

    const result = await writeDigestField(workspace, thread, actor, null, {
      subject: `digest clear: ${thread.title} (${id}) by ${actor}`,
    });
    return { threadId: id, digest: null, result };
  });
}

/**
 * The write both verbs share: one frontmatter field, stamped, validated,
 * committed and announced.
 *
 * `null` **removes** the key rather than writing `digest: null` — the rider
 * makes having no digest an absence and not a third state, and a `null` on disk
 * would be a second spelling of it.
 *
 * **`squash: false`, as `resident.ts` writes its own field** — and the reason was
 * measured rather than assumed. Left to fold, a digest write opens a §4 session
 * window, and the next thing to close that window relabels it *"editing session:
 * 1 document by agent"*: the subject naming the act disappears from `git log`
 * entirely, which was reproduced on a real server before this flag was set. A
 * digest is authored work with a named author, and *"when was this digest
 * written"* has to stay answerable from the history — a save of a document's
 * prose is what §4's editing session is for, and this is not one.
 *
 * It is **not** one of §4's *acts*, so no `act` is declared: the plan opts out of
 * folding and closes nobody's window. A digest write follows an agent turn,
 * which is an act and has already closed its own.
 */
async function writeDigestField(
  workspace: ThreadsWorkspace,
  thread: LoadedThread,
  actor: Actor,
  digest: ThreadDigest | null,
  commit: { readonly subject: string },
): Promise<MutationResult> {
  const text = serializeDocument(
    setFrontmatterFields(thread.loaded.parsed, {
      digest: digest === null ? undefined : digestToStored(digest),
      updated: formatInstant(workspace.now()),
    }),
  );
  const warnings = validateBeforeWrite(workspace, thread.loaded.path, text);

  return runMutation(workspace, {
    docId: thread.id,
    actor,
    warnings,
    plan: {
      operations: [{ kind: "write", path: thread.loaded.path, content: text }],
      stage: [thread.loaded.path],
      project: [thread.loaded.path],
      unproject: [],
      commit: { subject: commit.subject, squash: false },
      keys: digestKeys(thread.id),
    },
  });
}
