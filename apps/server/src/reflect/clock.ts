// SPEC.md §7's reflection clock: `.corpus/reflect.json` (rider 9, 2026-08-22).
//
// **The clock is server state, not corpus.** §7 says so in as many words — "the
// clock … is server state in `.corpus/`" — and §4 says why `.corpus/` is the
// right home: it is derived and local, it is gitignored, and nothing in it is
// anybody's source of truth. What git holds instead is the digest thread each
// reflection posts, whose first turn names the window; this file holds the two
// facts a board bar needs before that thread has been read.
//
// Three fields, and the third is the only one that needs explaining:
//
// - `reflected` — the `created` time of the last reflection whose job reached
//   `processed`. `null` for a corpus never reflected on, which means
//   *everything* is unreflected rather than nothing.
// - `digest` — the standalone thread that reflection posted, so "reflected 2h
//   ago" links to what was said.
// - `awaitingDigest` — the thread a reflection **that has not landed yet** has
//   posted, recorded when the thread is created and promoted to `digest` when
//   that same event is processed. It exists because the two facts arrive at
//   different moments and in that order: the agent writes the digest, then
//   completes its job. Promoting on completion is what keeps `digest` and
//   `reflected` describing one reflection — a job that fails leaves both alone,
//   and the retry that follows names the same window and posts a new thread.
//   At most one reflection is ever pending (`ReflectService.ask` refuses to
//   double one), so this is one entry rather than a map that could grow.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventIdSchema, ThreadIdSchema } from "@corpus/contract";
import { instantToEpochMs, normalizeInstant } from "../core/index.js";
import { writeFileAtomically } from "../docs/index.js";

/** The file, relative to `.corpus/`. Beside `seen.json`, and gitignored with it. */
export const REFLECT_FILE = "reflect.json";

/** A thread a reflection has posted but whose job has not landed yet. */
export interface AwaitingDigest {
  readonly eventId: string;
  readonly threadId: string;
}

export interface ReflectClockState {
  readonly reflected: string | null;
  readonly digest: string | null;
  readonly awaitingDigest: AwaitingDigest | null;
}

/** What a workspace with no file, or an unreadable one, reads as. */
export const EMPTY_REFLECT_STATE: ReflectClockState = {
  reflected: null,
  digest: null,
  awaitingDigest: null,
};

const asThreadId = (value: unknown): string | null =>
  typeof value === "string" && ThreadIdSchema.safeParse(value).success ? value : null;

const asEventId = (value: unknown): string | null =>
  typeof value === "string" && EventIdSchema.safeParse(value).success ? value : null;

function readAwaiting(value: unknown): AwaitingDigest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const eventId = asEventId(record["eventId"]);
  const threadId = asThreadId(record["threadId"]);
  if (eventId === null || threadId === null) return null;
  return { eventId, threadId };
}

/**
 * The clock on disk.
 *
 * **Anything unreadable reads as "never reflected"**, the same call
 * `readSeenMarks` makes about read marks and for the same reason: this is
 * derived comfort, and the worst a lost clock costs is one reflection over a
 * window wider than it needed to be. Refusing to serve a board because a JSON
 * file lost its closing brace would be a far worse answer. Every field is
 * validated on its own, so a corrupt `digest` does not cost the `reflected`
 * beside it.
 */
export function readReflectState(corpusDir: string): ReflectClockState {
  const path = join(corpusDir, REFLECT_FILE);
  if (!existsSync(path)) return EMPTY_REFLECT_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return EMPTY_REFLECT_STATE;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return EMPTY_REFLECT_STATE;
  }
  const record = parsed as Record<string, unknown>;
  return {
    reflected:
      typeof record["reflected"] === "string" ? normalizeInstant(record["reflected"]) : null,
    digest: asThreadId(record["digest"]),
    awaitingDigest: readAwaiting(record["awaitingDigest"]),
  };
}

/** Two-space JSON with a trailing newline, like `seen.json`: an operator reads this file. */
export function serializeReflectState(state: ReflectClockState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function writeReflectState(corpusDir: string, state: ReflectClockState): void {
  writeFileAtomically(join(corpusDir, REFLECT_FILE), serializeReflectState(state));
}

/**
 * Records the thread a reflection posted, against the event that is posting it.
 *
 * Not yet the digest: see `awaitingDigest` above. Overwrites whatever was
 * awaiting, because the last standalone thread a reflection posts is its digest
 * and an earlier one was not.
 */
export function recordAwaitingDigest(
  corpusDir: string,
  eventId: string,
  threadId: string,
): ReflectClockState {
  const current = readReflectState(corpusDir);
  const next: ReflectClockState = { ...current, awaitingDigest: { eventId, threadId } };
  writeReflectState(corpusDir, next);
  return next;
}

/**
 * Moves the clock to a processed reflection's `created`, and promotes that
 * reflection's digest with it.
 *
 * **Forward only.** The criterion is "written … to that event's `created`", and
 * in the ordinary run of things that is always forward: one reflection is
 * pending at a time. It is not always forward once `corpus job retry` exists —
 * a reflection that failed can be retried *after* a later one has been asked
 * for and processed, and processing the old one would then wind the corpus's
 * clock back and re-mark every document changed in between. So an event whose
 * `created` is not later than the clock moves nothing, and says so by returning
 * `false`.
 *
 * The digest is promoted only when the event that is landing is the one that
 * posted the awaiting thread; a reflection that posted none leaves the previous
 * digest in place, since `lastDigest` is "the most recent digest there is"
 * rather than "the digest of the last reflection, or nothing".
 */
export function advanceClock(
  corpusDir: string,
  eventId: string,
  created: string,
): { readonly moved: boolean; readonly state: ReflectClockState } {
  const current = readReflectState(corpusDir);
  const stamp = normalizeInstant(created);
  if (stamp === null) return { moved: false, state: current };
  const currentMs = current.reflected === null ? null : instantToEpochMs(current.reflected);
  const stampMs = instantToEpochMs(stamp);
  if (currentMs !== null && stampMs !== null && stampMs <= currentMs) {
    return { moved: false, state: current };
  }
  const awaiting = current.awaitingDigest;
  const promoted = awaiting !== null && awaiting.eventId === eventId;
  const next: ReflectClockState = {
    reflected: stamp,
    digest: promoted ? awaiting.threadId : current.digest,
    awaitingDigest: promoted ? null : current.awaitingDigest,
  };
  writeReflectState(corpusDir, next);
  return { moved: true, state: next };
}
