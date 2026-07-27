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
// **Attachments are refused, not dropped** (Open Conflict 4). The multipart form
// is parsed — a text-only multipart turn is fully supported — but a request
// carrying `files` gets a `400` naming SERVER-010, because storing bytes nothing
// can serve, or accepting them and discarding them silently, are both worse than
// saying so.

import type { Actor, AppendTurnBody, ThreadSummary, Turn } from "@corpus/contract";
import { isMultipartTurn } from "@corpus/contract";
import {
  appendTurn,
  formatInstant,
  serializeDocument,
  setBody,
  setFrontmatterFields,
} from "../core/index.js";
import {
  runMutation,
  validateBeforeWrite,
  validationError,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { enqueueComment } from "./events.js";
import { parseMentions } from "./mentions.js";
import { decideParticipation } from "./participation.js";
import { loadThread, toThreadSummary } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

/** Named so the refusal is one string, asserted by tests and read by users. */
export const ATTACHMENTS_DEFERRED_MESSAGE =
  "attachments are not accepted yet: ingest and serving land in SERVER-010";

export interface TurnInput {
  readonly text: string;
  /** The §8 tri-state, exactly as it arrived; `undefined` means *omitted*. */
  readonly requestsAgent: boolean | undefined;
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
    return { text: body.body, requestsAgent: body.requestsAgent };
  }
  if (body.files.length > 0) {
    validationError(ATTACHMENTS_DEFERRED_MESSAGE, [
      { path: "files", message: ATTACHMENTS_DEFERRED_MESSAGE },
    ]);
  }
  // The schema's refine already rejects a body with neither text nor files, so
  // this is the same rule stated where the type can see it — an attachment-only
  // turn becomes possible in SERVER-010 and reaches this branch legitimately.
  if (body.text === undefined) {
    validationError("a turn needs text until attachments land (SERVER-010)", [
      { path: "text", message: "A turn needs `text`." },
    ]);
  }
  return { text: body.text, requestsAgent: body.requestsAgent };
}

export async function appendThreadTurn(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  input: TurnInput,
): Promise<TurnAppend> {
  return mutex.run(id, async () => {
    const thread = loadThread(workspace, id);
    const parsed = parseMentions(workspace.projection, input.text);
    const decision = decideParticipation({
      requestsAgent: input.requestsAgent,
      author: actor,
      parsed,
      thread: { agent: thread.agent, status: thread.status },
    });

    const appended = appendTurn(thread.loaded.parsed.body, {
      author: actor,
      text: input.text,
      ts: formatInstant(workspace.now()),
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
  });
}
