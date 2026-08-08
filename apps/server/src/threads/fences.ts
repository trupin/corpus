// The one guard that keeps a turn from swallowing the turns after it
// (SPEC.md §6, §14; SERVER-075).
//
// §6 delimits turns with `## <author> · <timestamp>` headings and says a fenced
// block closes only on a line holding nothing but its delimiter run. Those two
// rules meet badly: `core/code.ts` masks headings inside code, and an
// unterminated fence's mask runs to the end of the file — so a turn that leaves
// a fence open makes **every turn written after it invisible**. The bytes stay
// on disk; the board, the projection, the context pack and the agent all see one
// turn where there are four. That is data loss with no error and no symptom
// until somebody opens the file.
//
// **Why this refuses where SERVER-066 chose not to, and why that is not a
// contradiction.** SERVER-066 made `corpus doc check` *report* an unterminated
// fence and deliberately kept it **non-blocking**: refusing somebody's save
// because of a fault that was already on disk punishes the wrong write, and the
// person is often not the one who put it there. That decision is untouched here
// — `docs/write.ts` still saves a file whose fence was already open, the watcher
// still accepts an out-of-band edit, and a reply to a thread that *already*
// carries an open fence is still written.
//
// This is the other moment. What is refused is the write that **introduces** the
// fault: the author is present, the text is still in their composer, and the fix
// is one line. Declining to create a new fault is not the same act as blocking a
// save for an old one — the difference is whose mistake it is and whether it can
// still be fixed cheaply. Do not "restore consistency with SERVER-066" by
// deleting this; the two rules are consistent already, and each covers the case
// the other would get wrong.
//
// **Every actor, not just the agent.** The form-grammar guard next door
// (`assertWritableForm`) is agent-only because §6 makes a *form* something an
// agent turn carries, so refusing a person's fence for looking like a question
// would refuse ordinary prose. Nothing about a swallowed turn depends on who
// wrote it, so this guard draws no such line.
//
// **Quoting a fence still works**, which is what §11's snippet action depends
// on: a turn that opens a wider fence and closes it on its own line closes, so
// the scanner reports nothing and the guard says nothing. The predicate here is
// not "does this text contain a fence" but "does this text leave one open", and
// it is answered by `core/code.ts`'s single scanner — the same pass that decides
// which bytes are masked. That is deliberate: the guard refuses exactly the
// texts whose turn headings *this corpus's own reader* would stop seeing, so it
// can neither refuse something that would have parsed nor accept something that
// would not, even where that scanner's container approximations diverge from
// CommonMark (`core/code.ts` documents which ones and in which direction).

import { unterminatedFence } from "../core/index.js";
import { badRequest } from "../errors.js";

/**
 * What is being refused, in the words the caller's route uses.
 *
 * `subject` is the noun the message opens with ("this turn", "this answer") and
 * `path` is the request field the text arrived in, so the issue points at
 * something the client can highlight rather than at a field it does not have.
 */
export interface FenceSubject {
  readonly subject: string;
  readonly path: string;
}

export const TURN_SUBJECT: FenceSubject = { subject: "this turn", path: "body" };
export const CAPTURE_SUBJECT: FenceSubject = { subject: "this capture", path: "text" };
export const ANSWER_SUBJECT: FenceSubject = { subject: "this answer", path: "body" };

/**
 * Refuse `text` if it leaves a code fence open (SPEC.md §6; SERVER-075).
 *
 * `text` is the author's **own** words, never the whole thread body and never
 * the body with the server's attachment reference block appended. Both of those
 * choices are load-bearing:
 *
 *   - Asking about the whole thread body would make one bad turn refuse every
 *     later reply to that thread — SERVER-066's mistake, in the place it was
 *     right to avoid it. A fence somebody else left open is not this writer's to
 *     fix, and they must still be able to speak.
 *   - Asking about the text *with* the reference block appended would report
 *     line numbers in a string the author has never seen. The reference lines
 *     are markdown links and cannot open a fence, so the answer is the same
 *     either way; only the coordinates differ, and only one set of coordinates
 *     is useful in a composer.
 *
 * Absent text (an attachment-only turn, §6) has no fence to leave open and is
 * accepted without a scan.
 *
 * It throws rather than warning, and it throws **before** anything is written —
 * before the document lane, before a byte of an attachment reaches disk — so the
 * author's wording is still in the composer when the message arrives. A refusal
 * that landed after the write would be the worst of both: the fault created and
 * the person told about it.
 */
export function assertClosedFences(text: string | undefined, where: FenceSubject): void {
  if (text === undefined) return;
  const fence = unterminatedFence(text);
  if (fence === null) return;
  // The marker is quoted bare rather than wrapped in backticks the way the rest
  // of this server's messages quote identifiers: a backtick run inside backticks
  // renders as a longer run, and the one thing this message has to get across
  // unambiguously is how many characters the closing line needs.
  throw badRequest(
    `${where.subject} leaves a code fence open: the ${fence.marker} on line ${fence.line} is ` +
      "never closed, so everything after it reads as code and every later turn in the thread " +
      `would become invisible. Close it with a line holding nothing but ${fence.marker}.`,
    [
      {
        path: where.path,
        message: `unterminated ${fence.marker} code fence opened on line ${fence.line}`,
      },
    ],
  );
}
