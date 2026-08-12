// `POST /api/threads/{id}/resolve` and `/reopen` (SPEC.md §6, §8).
//
// One verb with two targets, because they are the same write: `status` flips
// between `open` and `resolved`, the file is committed, the projection catches
// up before the response, and the change is announced.
//
// **Idempotent and quiet.** Resolving an already-resolved thread is a `200` that
// writes nothing, commits nothing and announces nothing — not because a second
// commit would be wrong, but because a UI that retries on reconnect would
// otherwise fill `git log` with empty commits and the SSE stream with frames no
// client can act on. The state the caller asked for is the state that holds,
// which is what idempotent means.
//
// **No lock guard** (sprint-006 Adjudication 1): nothing in the parent is
// touched, and `resolveThread` / `reopenThread` declare no `423`.

import type { Actor, ThreadStatus, ThreadSummary } from "@corpus/contract";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { loadThread, toThreadSummary } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

export interface StatusChange {
  readonly thread: ThreadSummary;
  /** `null` when the thread already had the requested status: nothing was written. */
  readonly result: MutationResult | null;
}

export async function setThreadStatus(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  status: ThreadStatus,
): Promise<StatusChange> {
  return mutex.run(id, async () => {
    const thread = loadThread(workspace, id);
    if (thread.status === status) {
      return { thread: toThreadSummary(thread), result: null };
    }

    const text = serializeDocument(
      setFrontmatterFields(thread.loaded.parsed, {
        status,
        updated: formatInstant(workspace.now()),
      }),
    );
    const warnings = validateBeforeWrite(workspace, thread.loaded.path, text);

    const keys = [DOCS_KEY, docKey(id), threadKey(id)];
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
        commit: {
          subject: `thread ${status === "resolved" ? "resolve" : "reopen"}: ${thread.title} (${id}) by ${actor}`,
          // SPEC.md §4: "a thread resolved or reopened" is a discrete act — a
          // change someone else can act on — so it closes the open window and
          // its subject is what that window's commit keeps (SERVER-092). Only a
          // real change reaches here: an unchanged status returned above.
          act: "names-the-window",
        },
        keys,
      },
    });

    return { thread: toThreadSummary(loadThread(workspace, id)), result };
  });
}
