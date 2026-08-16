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
// **Nothing refuses a status flip for another writer** (sprint-006
// Adjudication 1): nothing in the parent is touched, and the flip names its own
// delta, so SPEC.md §7 asks it for no key either.

import type { Actor, ThreadStatus, ThreadSummary } from "@corpus/contract";
import { formatInstant, serializeDocument, setFrontmatterFields } from "../core/index.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { AGENTS_KEY, DOCS_KEY, docKey, threadKey } from "../events/index.js";
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
    // SPEC.md §7: "a thread that is **resolved** releases its resident with it,
    // since a settled conversation has nobody to keep resident". One write, one
    // commit: the release is part of resolving rather than a second act, and it
    // rewrites nothing already stamped — events keep the lane they were enqueued
    // with. **Reopening does not bring it back** (§8, as amended): the
    // conversation resumes on the orchestrator's lane, and designating again is
    // a deliberate act, as the first designation was. So the key is cleared on
    // the way to `resolved` and never restored on the way back.
    //
    // Read off the file rather than off `thread.resident`, which is null for a
    // parented thread whatever its frontmatter says (`core/resident.ts`), so a
    // hand-edited key is cleared here too rather than surviving forever.
    const releasing = status === "resolved" && Object.hasOwn(thread.loaded.parsed.data, "resident");
    if (thread.status === status && !releasing) {
      return { thread: toThreadSummary(thread), result: null };
    }

    const text = serializeDocument(
      setFrontmatterFields(thread.loaded.parsed, {
        status,
        updated: formatInstant(workspace.now()),
        ...(releasing ? { resident: undefined } : {}),
      }),
    );
    const warnings = validateBeforeWrite(workspace, thread.loaded.path, text);

    const keys = [DOCS_KEY, docKey(id), threadKey(id)];
    if (thread.parent !== null) keys.push(docKey(thread.parent));
    // A released resident takes a lane off the roster, which is a different
    // query from this thread's (SPEC.md §7 — the roster is a read behind
    // `["agents"]`). Added only when this resolve actually released one.
    if (releasing) keys.push(AGENTS_KEY);

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
