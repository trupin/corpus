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
// **Nothing refuses a turn for another writer** (sprint-006 Adjudication 1,
// standing after SPEC.md §7 replaced the lock with a key). Commenting is not
// editing: nothing in the parent is touched by a turn, so there is no
// block-replacing write for a key to guard.
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
  Lane,
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
  turnModelsPatch,
} from "../core/index.js";
import {
  runMutation,
  validateBeforeWrite,
  validationError,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { internalError } from "../errors.js";
import { enqueueComment } from "./events.js";
import { TURN_SUBJECT, assertAppendableTurnText } from "./fences.js";
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
  /**
   * The model that wrote this turn (SPEC.md §11), or `undefined` when the writer
   * did not say. Recorded verbatim and interpreted in no way — see
   * {@link assertModelNamesAnAgentTurn}.
   */
  readonly model: string | undefined;
  /**
   * The weight the request states its work should be done at (SPEC.md §7);
   * `undefined` when it states none, which means the orchestrator decides.
   *
   * Unlike {@link model} it is **request-time instruction and is never written
   * into the turn**: `model` records what did write a turn, this records what a
   * request asked the work to be done at, and §7's guarantee that a stated
   * weight is "honoured, not weighed again" is only checkable while the two stay
   * separate values. It rides to the queue event and no further.
   */
  readonly weight: string | undefined;
  /** The queue event this turn serves (SPEC.md §9.2); attribution only — a turn creates no document. */
  readonly job: string | undefined;
  /**
   * The lane this reply is addressed to (SPEC.md §7); `undefined` for the
   * ordinary case, where the lane follows from the conversation it was posted
   * in.
   *
   * A stated one is the **summons**: it routes this message to another
   * conversation's resident and nothing else — what that agent then writes still
   * files into this thread, because the lane and the origin are read off
   * different things. Like {@link weight} it rides to the queue event and no
   * further; nothing about it is written into the turn.
   */
  readonly recipient: Lane | undefined;
  readonly files: readonly File[];
}

/**
 * A model may be stated only about a turn the **agent** wrote (SPEC.md §11,
 * CONTRACT-043).
 *
 * "A turn a person wrote names no model" is not a rendering convention: a server
 * that accepted one would be publishing an attribution nobody made, on the one
 * field of a turn that describes the past rather than asking for something. It
 * is refused rather than dropped, because silently discarding it would tell the
 * caller its report landed.
 *
 * Placed on the verb rather than the handler so it holds on **every** door onto
 * a turn — both media types of `POST /api/threads` and of
 * `POST /api/threads/{id}/turns` — the placement `assertAppendableTurnText` takes
 * for the same reason.
 */
export function assertModelNamesAnAgentTurn(actor: Actor, model: string | undefined): void {
  if (model === undefined || actor === "agent") return;
  validationError("only an agent turn names the model that wrote it", [
    {
      path: "model",
      message: `a turn authored by \`${actor}\` names no model (SPEC.md §11)`,
    },
  ]);
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
 * into "omitted". `weight` crosses both forms as the plain string it already is,
 * and with no `??` for the same reason: absence is an instruction, not a gap to
 * fill.
 */
export function turnRequestBody(body: AppendTurnBody): TurnInput {
  if (!isMultipartTurn(body)) {
    return {
      text: body.body,
      requestsAgent: body.requestsAgent,
      model: body.model,
      weight: body.weight,
      job: body.job,
      recipient: body.recipient,
      files: [],
    };
  }
  // A body with neither `text` nor `files` is refused by the schema's own
  // refine, so both may legitimately be absent here — one of them, never both.
  return {
    text: body.text,
    requestsAgent: body.requestsAgent,
    model: body.model,
    weight: body.weight,
    job: body.job,
    recipient: body.recipient,
    files: body.files,
  };
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
    /**
     * The model that wrote this turn (SPEC.md §11), recorded in the thread's
     * frontmatter beside its `anchors` map. Omitted by every caller that has
     * nothing to report — a person's turn, and a form answer, which the contract
     * gives no way to state one on.
     */
    readonly model?: string | undefined;
  },
): PreparedTurn {
  const written = appendTurn(thread.loaded.parsed.body, {
    author: input.author,
    text: input.text,
    ts: input.ts,
  });
  // `core/turns.ts` only ever sees a body, so every turn it produces names no
  // model; the model is what this write is *recording*, so the wire turn carries
  // it from here rather than from a re-read of the file this write has not made
  // yet. `null` when nothing was stated — §11's nothing, never a default.
  const appended = {
    body: written.body,
    turn: { ...written.turn, model: input.model ?? null },
  };
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
      // The model record, in the same bytes and the same commit as the turn it
      // describes (SPEC.md §6): the turn and its attribution cannot land apart.
      // `keep` is the thread's timestamps before this append — every turn but
      // this one — and the new turn's own entry is decided solely by what the
      // writer stated, so a stale entry sitting on a stamp this append is
      // *reusing* (a last turn deleted out of band, where the cascade never ran)
      // cannot hand this turn a dead turn's model. A thread nobody recorded a
      // model for never grows the key, so this write stays what it always was.
      ...turnModelsPatch(
        thread.loaded.parsed.data,
        thread.turns.map((turn) => turn.ts),
        { ts: appended.turn.ts, model: input.model },
      ),
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
      commit: {
        subject,
        // SPEC.md §4's first act: "a turn posted to a thread". The agent's
        // stewardship for one queue event is then one commit holding every
        // document it touched and saying which thread it answered — which is
        // the fragmentation the whole rider replaces (SERVER-092).
        //
        // **Either party's turn, and the party is deliberately not read here.**
        // §4 said "an agent turn" until the user struck the word on 2026-08-10:
        // every other entry in that list names an act without a party, and a
        // person's comment is the clearest case of §4's own definition — "a
        // change someone else can act on" — since under §8 it is what wakes the
        // agent. A form answer reaches here through the same function
        // (`forms.ts`) and is a person's turn, so it is an act too.
        act: "names-the-window" as const,
      },
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
  // Likewise for a turn that would swallow the turns after it (SERVER-075) or
  // fabricate one below it (SERVER-076). Unlike the form guard below, these are
  // for **every** actor: §6's masking does not care who left the fence open, and
  // an agent turn carrying a `## user · <ts>` line signs a turn in the person's
  // name. Both ask only about *this* turn's text, so a thread already carrying
  // either shape still accepts replies (`fences.ts` states the SERVER-066
  // boundary in full).
  assertAppendableTurnText(input.text, TURN_SUBJECT);
  // Likewise for an attribution nobody made (SPEC.md §11): a person's turn names
  // no model, on any path.
  assertModelNamesAnAgentTurn(actor, input.model);
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
        model: input.model,
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
          weight: input.weight,
          recipient: input.recipient,
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
