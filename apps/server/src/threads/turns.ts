// `POST /api/threads/{id}/turns` — appending a turn (SPEC.md §6, §8).
//
// **The timestamp is the turn's identity**, so uniqueness and monotonicity are
// invariants of the write, not of the caller: `core/turns.ts`'s `appendTurn`
// bumps a stamp that would not be strictly greater than the last one, and the
// whole append happens inside the thread's write lane so two turns posted in the
// same millisecond queue instead of racing. Five appends in a tight loop
// therefore produce five distinct, increasing stamps rather than five identical
// ones and a corrupt thread.
//
// **No lock guard** (sprint-006 Adjudication 1). Commenting is not editing:
// §7's lock is the edit lock, nothing in the parent is touched by a turn, and
// `appendTurn` declares no `423`.
//
// **A person's turn reopens a resolved thread** (SPEC.md §8, SHARED-019
// Amendment 1). It is one write — the turn and the `status` flip in the same
// bytes, the same commit, the same re-projection — and it happens *before* the
// enqueue question, so §8's ordinary rules then run against an open thread with
// no clause of their own. Which is why nothing here mentions `resolved`:
// `participation.ts` answers it, once, for this path and the form path alike.
//
// **Attachments** (SPEC.md §6, SERVER-010). The multipart form may carry files;
// the bytes land under `.corpus/attachments/<thread-id>/<turn-ts>/` — gitignored
// — and the *committed* turn body gains one relative markdown reference per
// file. A turn may be attachment-only; a turn with neither text nor files is a
// `400` the contract's own schema already refuses.
//
// **Ordering is the atomicity story.** The stamp is chosen first, because it
// names the directory the bytes go in and the body then quotes that directory.
// Bytes are written next, and the markdown last: if the *markdown building*
// fails, the turn directory is removed before the error propagates, because a
// committed reference to a file that does not exist is the one outcome §6 rules
// out. The cleanup window closes at `runMutation` (SERVER-021) — see
// {@link whileUnreferenced}.

import type {
  Actor,
  AppendTurnBody,
  ThreadAgent,
  ThreadStatus,
  ThreadSummary,
  Turn,
  Warning,
} from "@corpus/contract";
import { isMultipartTurn } from "@corpus/contract";
import {
  DEFAULT_ATTACHMENT_LIMITS,
  assertWithinLimits,
  attachmentReferences,
  removeTurnAttachments,
  withAttachmentReferences,
  writeTurnAttachments,
} from "../attachments/index.js";
import {
  appendTurn,
  formatInstant,
  nextTurnTs,
  serializeDocument,
  setBody,
  setFrontmatterFields,
} from "../core/index.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { internalError } from "../errors.js";
import { enqueueComment } from "./events.js";
import { TURN_SUBJECT, assertClosedFences } from "./fences.js";
import { assertWritableForm } from "./forms.js";
import { parseMentions } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toThreadSummary, type LoadedThread } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

export interface TurnInput {
  /** Absent for an attachment-only turn, which §6 makes a first-class case. */
  readonly text: string | undefined;
  /** The §8 tri-state, exactly as it arrived; `undefined` means *omitted*. */
  readonly requestsAgent: boolean | undefined;
  readonly files: readonly File[];
}

export interface TurnAppend {
  readonly thread: ThreadSummary;
  readonly turn: Turn;
  readonly eventId: string | null;
  readonly result: MutationResult;
}

/**
 * The turn a request carries, whichever of the route's two media types it
 * arrived as. Kept separate from the handler so the multipart refusals are
 * exercisable without building a `Request`, and so both forms provably read
 * `requestsAgent` the same way — the JSON form as a boolean, the multipart form
 * through `z.stringbool`, and neither through a `??` that would turn "note only"
 * into "omitted".
 */
export function turnRequestBody(body: AppendTurnBody): TurnInput {
  if (!isMultipartTurn(body)) {
    return { text: body.body, requestsAgent: body.requestsAgent, files: [] };
  }
  // A body with neither `text` nor `files` is refused by the schema's own
  // refine, so both may legitimately be absent here — one of them, never both.
  return { text: body.text, requestsAgent: body.requestsAgent, files: body.files };
}

/** The bytes an append will write, and what §14 noticed about them. */
export interface PreparedTurn {
  readonly appended: { readonly body: string; readonly turn: Turn };
  /** The whole thread file, frontmatter included, ready to be written. */
  readonly text: string;
  readonly warnings: readonly Warning[];
}

/**
 * Build the thread file a turn append will write — the turn itself, the
 * frontmatter it moves, and §14's verdict on the result.
 *
 * Extracted so the form-answer path (SERVER-016) appends through *this* code
 * rather than a second copy of it. A form answer is a turn like any other: the
 * only things it does differently are which event it enqueues and what its
 * commit says, so those are the only things its verb writes for itself. Two
 * copies of the "append a turn" bytes is how one path stops stamping `updated`,
 * or stops moving `agent`, and nothing notices until a thread's list row goes
 * stale for good.
 *
 * **§8's reopen is part of this write, not a second one.** A person's turn on a
 * resolved thread carries the status flip in the same bytes, the same commit and
 * the same re-projection as the turn — so there is no instant at which the turn
 * exists and the reopen does not, and no way for one to land and the other to
 * fail.
 */
export function buildTurnAppend(
  workspace: ThreadsWorkspace,
  thread: LoadedThread,
  input: {
    readonly author: Actor;
    readonly text: string;
    readonly ts: string;
    /** The thread's `agent` field after this turn, per §8's matrix. */
    readonly agent: ThreadAgent;
    /** The thread's `status` after this turn, per §8's reopen. */
    readonly status: ThreadStatus;
  },
): PreparedTurn {
  const appended = appendTurn(thread.loaded.parsed.body, {
    author: input.author,
    text: input.text,
    ts: input.ts,
  });
  // `updated` is the turn's own stamp rather than the wall clock: they differ
  // exactly when the stamp was bumped for uniqueness, and the useful answer is
  // "when the last turn is dated", which is what every list sorts on.
  const text = serializeDocument(
    setFrontmatterFields(setBody(thread.loaded.parsed, appended.body), {
      updated: appended.turn.ts,
      agent: input.agent,
      // Patched only when it moves. `read.ts` reports an **archived** thread's
      // status as `open` (an archived thread is still an unresolved
      // conversation), so a `status` restated on every reply would quietly
      // unarchive it — this is not the equal-value no-op `setFrontmatterFields`
      // already gives us, it is a lossy write that must never be attempted.
      ...(input.status === thread.status ? {} : { status: input.status }),
    }),
  );
  return { appended, text, warnings: validateBeforeWrite(workspace, thread.loaded.path, text) };
}

/**
 * What a turn's auto-commit says: the act, the thread, the acting party, and
 * whether this turn reopened the thread (SPEC.md §4, §8).
 *
 * The `(reopened)` marker is not decoration. §8's reopen rides in the *turn's*
 * commit rather than in one of its own, so without it `git log` would record a
 * status change with nothing to say about it — while every explicit status
 * change names itself (`status.ts`'s `thread reopen: …`). §4's session folding
 * takes the newer save's subject, so the marker survives a fold into the resolve
 * commit it may be amending.
 *
 * `act` is the caller's for the reason `commitTurnAppend`'s subject is: a reply
 * and a form answer are both turns on the same file, and a reader of `git log`
 * should be able to tell which one happened without opening the diff.
 */
export const turnCommitSubject = (input: {
  readonly act: string;
  readonly threadId: string;
  readonly actor: Actor;
  readonly reopened: boolean;
}): string =>
  `${input.act} on ${input.threadId} by ${input.actor}${input.reopened ? " (reopened)" : ""}`;

/**
 * Write, commit and re-project a prepared turn, and announce it.
 *
 * `subject` is the caller's because it names the *act*: a reply and a form
 * answer are both turns on the same file, and a reader of `git log` should be
 * able to tell which one happened. Everything else — the atomic write, the
 * staged path, the synchronous re-projection, the invalidated keys — is
 * identical by construction rather than by agreement.
 */
export async function commitTurnAppend(
  workspace: ThreadsWorkspace,
  thread: LoadedThread,
  actor: Actor,
  prepared: PreparedTurn,
  subject: string,
): Promise<MutationResult> {
  const keys = [DOCS_KEY, docKey(thread.id), threadKey(thread.id)];
  // A thread mutation invalidates "both the thread and its parent"
  // (`query-keys.ts`): the parent's reader draws this thread's chip.
  if (thread.parent !== null) keys.push(docKey(thread.parent));

  return runMutation(workspace, {
    docId: thread.id,
    actor,
    warnings: prepared.warnings,
    plan: {
      operations: [{ kind: "write", path: thread.loaded.path, content: prepared.text }],
      stage: [thread.loaded.path],
      project: [thread.loaded.path],
      unproject: [],
      commit: { subject },
      keys,
    },
  });
}

export async function appendThreadTurn(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  input: TurnInput,
): Promise<TurnAppend> {
  // Before the lane, so an over-cap upload never queues behind another turn and
  // never reaches the filesystem.
  assertWithinLimits(input.files, workspace.attachmentLimits ?? DEFAULT_ATTACHMENT_LIMITS);
  // Likewise for a turn that would swallow the turns after it (SERVER-075).
  // Unlike the form guard below this one is for **every** actor, because §6's
  // masking does not care who left the fence open — and it asks only about
  // *this* turn's text, so a thread already carrying an open fence still accepts
  // replies (`fences.ts` states the SERVER-066 boundary in full).
  assertClosedFences(input.text, TURN_SUBJECT);
  // Likewise for a malformed form the *agent* wrote: this is the endpoint it
  // asks through (§6), so this is where it finds out — not the person, later,
  // when they try to answer. It vets neither another actor's turn nor the first
  // turn of a thread created through `POST /api/threads`, both by design, so it
  // is the agent's guard rather than a guarantee about disk; `assertWritableForm`
  // states the boundary and §11's broken-block rendering covers the rest.
  assertWritableForm(actor, input.text);

  return mutex.run(id, async () => {
    const thread = loadThread(workspace, id);
    // Mentions come from what the *author* wrote. The reference block is the
    // server's own markdown and must never route anything.
    const parsed = parseMentions(workspace.projection, input.text ?? "");
    const decision = decideParticipation({
      requestsAgent: input.requestsAgent,
      author: actor,
      parsed,
      thread: { agent: thread.agent, status: thread.status },
    });

    const ts = nextTurnTs(thread.loaded.parsed.body, formatInstant(workspace.now()));
    const stored = await storeTurnFiles(workspace, id, ts, input.files);

    // Everything that *builds* the reference, and nothing that writes it.
    const prepared = whileUnreferenced(workspace.attachmentsRoot, id, ts, stored, () =>
      buildTurnAppend(workspace, thread, {
        author: actor,
        text: withAttachmentReferences(
          input.text,
          attachmentReferences(
            id,
            ts,
            stored.map((file) => file.name),
          ),
        ),
        ts,
        agent: decision.agent,
        status: decision.status,
      }),
    );

    // From here on the bytes stay, whatever fails.
    const result = await commitTurnAppend(
      workspace,
      thread,
      actor,
      prepared,
      turnCommitSubject({
        act: "comment: turn",
        threadId: id,
        actor,
        reopened: decision.status !== thread.status,
      }),
    );

    const eventId = decision.enqueue
      ? await enqueueComment(workspace, {
          threadId: id,
          parentId: thread.parent,
          turnTs: prepared.appended.turn.ts,
          parsed,
        })
      : null;

    return {
      thread: toThreadSummary(loadThread(workspace, id)),
      turn: prepared.appended.turn,
      eventId,
      result,
    };
  });
}

/**
 * Runs `build` — the markdown that will quote `stored` — and removes those bytes
 * again if it throws, because nothing references them yet.
 *
 * **The window closes here, not after the write** (SERVER-021). The cleanup used
 * to wrap the whole rest of the append, so a failure *after* `runMutation` had
 * committed the turn — an unwritable `.corpus/queue/` breaking the enqueue, the
 * read-back throwing — deleted the very files the committed turn quotes, which
 * is precisely the state §6 rules out. `runMutation` is therefore outside the
 * guard entirely rather than merely at its edge: it writes, commits, and
 * re-projects behind one call, and a caller that catches its failure cannot tell
 * which of those it got past.
 *
 * The cost is the mirror image, and the cheaper one: a `runMutation` that fails
 * during its *write* phase rolls the markdown back and leaves the bytes with
 * nothing pointing at them. Unreferenced files in a gitignored directory are
 * litter; a committed reference to bytes that are gone is corruption.
 */
export function whileUnreferenced<T>(
  attachmentsRoot: string | undefined,
  threadId: string,
  turnTs: string,
  stored: readonly { readonly name: string }[],
  build: () => T,
): T {
  try {
    return build();
  } catch (error) {
    if (stored.length > 0) removeTurnAttachments(attachmentsRoot, threadId, turnTs);
    throw error;
  }
}

/**
 * The bytes, written before the markdown that references them. Shared with
 * capture so both multipart surfaces store attachments identically.
 */
export async function storeTurnFiles(
  workspace: ThreadsWorkspace,
  threadId: string,
  turnTs: string,
  files: readonly File[],
): Promise<readonly { readonly name: string }[]> {
  if (files.length === 0) return [];
  const attachmentsRoot = workspace.attachmentsRoot;
  if (attachmentsRoot === undefined) {
    // Only reachable on a server built without an attachments root, which
    // `createServer` never does. Failing loudly beats accepting bytes and
    // silently dropping them.
    throw internalError("this server was built without an attachment store");
  }
  return writeTurnAttachments({ attachmentsRoot, threadId, turnTs, files });
}
