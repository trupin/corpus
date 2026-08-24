// Read marks (SPEC.md §7): what `.corpus/seen.json` holds, and the one question
// asked of it.
//
// Marks are **runtime state, not corpus** — the file is gitignored — so nothing
// here writes or commits. It sits apart from `seen.ts` because both a *write*
// (`POST /api/threads/{id}/seen`) and a *read* (`GET /api/threads/{id}`, which
// reports `unread` on the thread itself since CONTRACT-036) need the marks, and
// `seen.ts` already reads threads through `read.ts`. Putting the marks in the
// shaper's own module would have made the two import each other.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ThreadIdSchema } from "@corpus/contract";
import { instantToEpochMs, normalizeInstant } from "../core/index.js";
import { isThreadUnread } from "../docs/index.js";
import type { ProjectionDb } from "../projection/index.js";
import { SEEN_FILE } from "../projection/index.js";

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

/** Where the marks live and what to compare them against. */
export interface MarkReader {
  readonly projection: ProjectionDb;
  /** `.corpus/`, which holds `seen.json`. */
  readonly corpusDir: string;
}

/**
 * **Whether this thread holds a turn nobody has seen** — the answer
 * `Thread.unread`, `DocRow.unread` and `MarkSeenResult.unread` all give
 * (CONTRACT-036).
 *
 * It is `docs/needs.ts`'s own comparison run against this thread's mark, and
 * deliberately not a second one written for the thread route: the contract
 * requires the three to agree *by construction*, so a change to what unread
 * means must reach all of them or none.
 *
 * **The mark is looked up by id, never derived from a list or from the turns in
 * hand.** A standalone thread appears in no `?parent=` listing at all, and a
 * thread past the first page of a busy parent has no row a reader could take the
 * answer from — which is why the field exists. An absent mark is `""`, which the
 * comparison reads as *nothing seen yet*: every turn is then newer, and a thread
 * with no turns still reads `false` because there is nothing to have missed.
 */
export function threadUnread(reader: MarkReader, threadId: string): boolean {
  const mark = readSeenMarks(reader.corpusDir)[threadId] ?? "";
  return isThreadUnread(reader.projection, threadId, mark);
}
