// `DELETE /api/threads/{id}/turns/{ts}` and the §6 cascade.
//
// **User-only.** "Individual turns can be deleted — user-only (like all
// deletion)… the agent never deletes turns." Enforced here, before the thread is
// even read, because the CLI sends `x-corpus-author: agent` on every request and
// a rule that lives only in the client is not a rule.
//
// **The cascade, in one step per level** (§6):
//
//   turn deleted → was it the last one? → the thread goes too → was the thread
//   anchored? → its entry leaves the parent's frontmatter
//
// so "no highlight is ever left pointing at an empty conversation". The thread
// half is `docs/delete.ts`'s `deleteDocumentLocked` — the same code
// `DELETE /api/docs/{id}` runs on a `th_*` id, reached without re-entering a
// mutex this call already holds. One deletion path, therefore one set of rules
// about what a deletion does.
//
// **Timestamps are never renumbered.** Deleting a middle turn leaves every other
// turn's stamp exactly as it was: the stamp is the turn's identity, so
// renumbering would invalidate every link, every seen mark and every event
// payload that names one.

import type { Actor, DeleteTurnResult } from "@corpus/contract";
import { removeTurnAttachments } from "../attachments/index.js";
import {
  formatInstant,
  deleteTurn as removeTurn,
  normalizeInstant,
  serializeDocument,
  setBody,
  setFrontmatterFields,
} from "../core/index.js";
import {
  anchoredThreadParent,
  deleteDocumentLocked,
  runInLanes,
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { forbidden, notFound } from "../errors.js";
import { loadThread, type LoadedThread } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

export const AGENT_TURN_DELETE_MESSAGE =
  "turn deletion is user-only; the agent never deletes turns";

export interface TurnDeletion {
  readonly result: DeleteTurnResult;
  readonly mutation: MutationResult;
}

/** The turn `ts` names, or the contract's 404. */
function requireTurn(thread: LoadedThread, ts: string): { readonly ts: string } {
  const normalized = normalizeInstant(ts);
  const turn =
    normalized === null ? undefined : thread.turns.find((candidate) => candidate.ts === normalized);
  if (turn === undefined) throw notFound(`no turn at ${ts} in thread ${thread.id}`);
  return turn;
}

export async function deleteThreadTurn(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  ts: string,
): Promise<TurnDeletion> {
  if (actor === "agent") throw forbidden(AGENT_TURN_DELETE_MESSAGE);

  const preview = loadThread(workspace, id);
  requireTurn(preview, ts);
  const anchored = anchoredThreadParent(preview.loaded);

  // The parent's lane is held whenever the thread is anchored, not only when the
  // pre-lane read says the cascade will reach it: a turn appended between the
  // read and the lane can turn a middle-turn deletion into a last-turn one, and
  // acquiring a lane inside the mutex would be the deadlock `runInLanes`
  // documents. `[threadId, parentId]` is the fixed order every composite thread
  // mutation takes.
  return runInLanes(mutex, [id, anchored?.parentId], async () => {
    const thread = loadThread(workspace, id);
    const turn = requireTurn(thread, ts);

    // The guard runs on the **parent's** id, and only when this deletion will
    // actually rewrite the parent's frontmatter — i.e. when the turn is the last
    // one and the thread is anchored (sprint-006 Adjudication 1). Deleting a
    // middle turn touches one file and is never refused.
    //
    // Inside the lanes, and against the state read inside them: a lease the
    // other party acquires while this deletion is queued must refuse it
    // (SERVER-022 finding 7), and the turn count that decides whether the parent
    // is written at all is the one this deletion will act on.
    if (anchored !== null && thread.turns.length === 1) {
      await (workspace.assertWritable ?? ((): void => undefined))(anchored.parentId, actor);
    }

    if (thread.turns.length === 1) {
      const outcome = await deleteDocumentLocked(workspace, actor, id);
      return {
        result: {
          deletedTurn: true,
          deletedThread: true,
          removedAnchor: outcome.removedAnchor,
          parentId: thread.parent,
          warnings: [...outcome.mutation.warnings],
        },
        mutation: outcome.mutation,
      };
    }

    const { body } = removeTurn(thread.loaded.parsed.body, turn.ts);
    const text = serializeDocument(
      setFrontmatterFields(setBody(thread.loaded.parsed, body), {
        updated: formatInstant(workspace.now()),
      }),
    );
    const warnings = validateBeforeWrite(workspace, thread.loaded.path, text);

    const keys = [DOCS_KEY, docKey(id), threadKey(id)];
    if (thread.parent !== null) keys.push(docKey(thread.parent));

    const mutation = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations: [{ kind: "write", path: thread.loaded.path, content: text }],
        stage: [thread.loaded.path],
        project: [thread.loaded.path],
        unproject: [],
        commit: { subject: `comment: delete turn ${turn.ts} on ${id} by ${actor}` },
        keys,
      },
    });

    // This turn's bytes only — sibling turns keep theirs. After the mutation,
    // for the reason `deleteDocumentLocked` states: a deletion that failed must
    // not have cost anyone their files. The last-turn branch above reaches
    // `deleteDocumentLocked`, which removes the whole thread's directory.
    removeTurnAttachments(workspace.attachmentsRoot, id, turn.ts);

    return {
      result: {
        deletedTurn: true,
        deletedThread: false,
        removedAnchor: null,
        parentId: thread.parent,
        warnings: [...mutation.warnings],
      },
      mutation,
    };
  });
}
