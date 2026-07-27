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
// **Attachments** (SPEC.md §6, SERVER-010). The multipart form may carry files;
// the bytes land under `.corpus/attachments/<thread-id>/<turn-ts>/` — gitignored
// — and the *committed* turn body gains one relative markdown reference per
// file. A turn may be attachment-only; a turn with neither text nor files is a
// `400` the contract's own schema already refuses.
//
// **Ordering is the atomicity story.** The stamp is chosen first, because it
// names the directory the bytes go in and the body then quotes that directory.
// Bytes are written next, and the markdown last: if anything after the bytes
// fails, the turn directory is removed before the error propagates, because a
// committed reference to a file that does not exist is the one outcome §6 rules
// out. A *commit* failure is not that case — §14 says the file mutation stands
// and the failure surfaces as a warning — so the bytes stay with the turn that
// references them.

import type { Actor, AppendTurnBody, ThreadSummary, Turn } from "@corpus/contract";
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
import { parseMentions } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toThreadSummary } from "./read.js";
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

    try {
      const appended = appendTurn(thread.loaded.parsed.body, {
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
      });
      // `updated` is the turn's own stamp rather than the wall clock: they differ
      // exactly when the stamp was bumped for uniqueness, and the useful answer is
      // "when the last turn is dated", which is what every list sorts on.
      const text = serializeDocument(
        setFrontmatterFields(setBody(thread.loaded.parsed, appended.body), {
          updated: appended.turn.ts,
          agent: decision.agent,
        }),
      );
      const warnings = validateBeforeWrite(workspace, thread.loaded.path, text);

      const keys = [DOCS_KEY, docKey(id), threadKey(id)];
      // A thread mutation invalidates "both the thread and its parent"
      // (`query-keys.ts`): the parent's reader draws this thread's chip.
      if (thread.parent !== null) keys.push(docKey(thread.parent));

      const result = await runMutation(workspace, {
        docId: id,
        actor,
        warnings,
        plan: {
          operations: [{ kind: "write", path: thread.loaded.path, content: text }],
          stage: [thread.loaded.path],
          project: [thread.loaded.path],
          unproject: [],
          commit: { subject: `comment: turn on ${id} by ${actor}` },
          keys,
        },
      });

      const eventId = decision.enqueue
        ? await enqueueComment(workspace, {
            threadId: id,
            parentId: thread.parent,
            turnTs: appended.turn.ts,
            parsed,
          })
        : null;

      return {
        thread: toThreadSummary(loadThread(workspace, id)),
        turn: appended.turn,
        eventId,
        result,
      };
    } catch (error) {
      if (stored.length > 0) removeTurnAttachments(workspace.attachmentsRoot, id, ts);
      throw error;
    }
  });
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
