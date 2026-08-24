// `POST /api/threads/{id}/seen` — read state (SPEC.md §7).
//
// Read marks are **runtime state, not corpus**: `.corpus/seen.json` is
// gitignored, so this is the one thread mutation that makes **no commit**. It
// still re-projects synchronously and announces, because unread badges have to
// clear everywhere at once and a badge that clears only in the tab that did the
// reading is the bug §7's "broadcast over SSE" exists to prevent.
//
// **Marks only move forward.** A mark older than the one on record is a `200`
// that changes nothing — scrolling back up a thread is not unreading it. The
// response reports the mark now *recorded*, not the one asked for, so a client
// that sent a stale mark learns the real state instead of caching its own guess.
//
// **`unread` is computed, not assumed** (CONTRACT-010, SERVER-021). A mark that
// names an earlier turn leaves later turns unseen and the badge lit, so the
// answer is `docs/needs.ts`'s own unread fragment run against the mark now
// recorded — the very expression `GET /api/docs` puts in every row, over the
// rows this request just re-projected. A client that inferred "read" from a
// `200` would clear a badge the next collection query lights again.
//
// The file is a flat `{threadId: isoInstant}` map, which is exactly what
// `projectSeen` already reads (SERVER-004). Reading it, and asking it whether a
// thread is unread, live in `marks.ts` — `GET /api/threads/{id}` needs the same
// answer since CONTRACT-036, and this module reads threads through `read.ts`.
// One file for the whole workspace means one lane (`SEEN_LANE`): a
// read-modify-write of a shared JSON file is the canonical lost-update, and two
// tabs marking two threads read at once is the ordinary case, not the exotic one.

import { join } from "node:path";
import type { MarkSeenRequest, MarkSeenResult } from "@corpus/contract";
import { normalizeInstant } from "../core/index.js";
import {
  SEEN_LANE,
  isThreadUnread,
  writeFileAtomically,
  type DocumentMutex,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { SEEN_FILE, projectSeen } from "../projection/index.js";
import { movesForward, readSeenMarks } from "./marks.js";
import { loadThread, type LoadedThread } from "./read.js";
import type { ThreadsWorkspace } from "./workspace.js";

/**
 * Two-space JSON with a trailing newline, keys sorted: this file is read by
 * humans debugging read state, and a stable key order keeps successive marks
 * from rewriting lines they did not touch.
 */
const serializeMarks = (marks: Record<string, string>): string => {
  const sorted = Object.fromEntries(
    Object.entries(marks).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
};

/**
 * The read-modify-write itself, synchronous because every part of it is: one
 * small JSON file, one whole-file re-projection, one announcement. It runs under
 * {@link SEEN_LANE}, which is what makes "read the marks, then write them back"
 * safe when two threads are marked read at once.
 */
function recordMark(
  workspace: ThreadsWorkspace,
  thread: LoadedThread,
  requested: string,
): MarkSeenResult {
  const id = thread.id;
  const marks = readSeenMarks(workspace.corpusDir);
  const current = marks[id];
  if (!movesForward(current, requested)) {
    // Answered against the mark now *recorded*, not the one asked for — same
    // rule as `lastSeenTs` beside it.
    const recorded = current ?? requested;
    return {
      threadId: id,
      lastSeenTs: recorded,
      unread: isThreadUnread(workspace.projection, id, recorded),
    };
  }

  const path = join(workspace.corpusDir, SEEN_FILE);
  const content = serializeMarks({ ...marks, [id]: requested });
  // Registered before the bytes land: `.corpus/seen.json` is watched now, and an
  // entry recorded afterwards loses the race and surfaces as a spurious
  // out-of-band re-projection.
  workspace.selfWrites.record(path, content);
  writeFileAtomically(path, content);

  // Read-your-write, §9.1 — the `seen` table is current before the response,
  // with no watcher involvement and no polling.
  projectSeen(workspace.projection, workspace.corpusDir);

  // `docKey(id)` is the thread's own document key — a thread *is* a document
  // (SPEC.md §7), and every other thread mutation announces both spellings
  // (`threads/turns.ts`, `create.ts`, `status.ts`, `cascade.ts`). Mark-seen was
  // the sole outlier; a standalone thread, whose parent key is absent, had no
  // accidental substitute for it (SERVER-022 finding 8). No `["tree"]`: read
  // state moves no folder badge.
  const keys = [DOCS_KEY, docKey(id), threadKey(id)];
  if (thread.parent !== null) keys.push(docKey(thread.parent));
  workspace.bus.invalidate(keys);

  return {
    threadId: id,
    lastSeenTs: requested,
    unread: isThreadUnread(workspace.projection, id, requested),
  };
}

export async function markThreadSeen(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  id: string,
  request: MarkSeenRequest,
): Promise<MarkSeenResult> {
  const thread = loadThread(workspace, id);
  // A bare POST means "I opened it", which is a mark at the last turn. A thread
  // with no turns at all is only reachable by hand-editing, and its `updated` is
  // then the honest answer to "how far have I read".
  const requested =
    request.lastSeenTs === undefined
      ? (thread.turns.at(-1)?.ts ?? thread.updated)
      : (normalizeInstant(request.lastSeenTs) ?? thread.updated);

  return mutex.run(SEEN_LANE, () => Promise.resolve(recordMark(workspace, thread, requested)));
}
