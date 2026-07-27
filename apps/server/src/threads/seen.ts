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
// `projectSeen` already reads (SERVER-004). One file for the whole workspace
// means one lane (`SEEN_LANE`): a read-modify-write of a shared JSON file is the
// canonical lost-update, and two tabs marking two threads read at once is the
// ordinary case, not the exotic one.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MarkSeenRequest, MarkSeenResult } from "@corpus/contract";
import { ThreadIdSchema } from "@corpus/contract";
import { instantToEpochMs, normalizeInstant } from "../core/index.js";
import {
  SEEN_LANE,
  isThreadUnread,
  writeFileAtomically,
  type DocumentMutex,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { SEEN_FILE, projectSeen } from "../projection/index.js";
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
 * The marks on disk. Anything unreadable or malformed reads as "no marks yet"
 * rather than failing the request: read state is derived comfort, and refusing
 * to record that a thread was read because some *other* entry is corrupt would
 * be a worse answer than dropping the corruption. `projectSeen` makes the same
 * call, so the file and the table agree about what they ignore.
 */
export function readSeenMarks(corpusDir: string): Record<string, string> {
  const path = join(corpusDir, SEEN_FILE);
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const marks: Record<string, string> = {};
  for (const [threadId, value] of Object.entries(parsed)) {
    if (!ThreadIdSchema.safeParse(threadId).success || typeof value !== "string") continue;
    const ts = normalizeInstant(value);
    if (ts !== null) marks[threadId] = ts;
  }
  return marks;
}

/** True when `candidate` is strictly newer than `current` — the forward-only rule. */
export function movesForward(current: string | undefined, candidate: string): boolean {
  if (current === undefined) return true;
  const currentMs = instantToEpochMs(current);
  const candidateMs = instantToEpochMs(candidate);
  if (currentMs === null || candidateMs === null) return true;
  return candidateMs > currentMs;
}

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
