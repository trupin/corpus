// The guards that keep a turn's own text from imitating the format that
// delimits turns (SPEC.md §6, §14; SERVER-075, SERVER-076).
//
// Two shapes qualify, and {@link assertAppendableTurnText} is the pair: text
// that leaves a code fence open, and text carrying a line that reads as a turn
// heading. Both are answered by asking `core/`'s own parser what it would do
// with the bytes — never by a regex written here. A private copy of either
// grammar would drift from the reader it is protecting, which is the failure
// this repo has fixed four times.
//
// **Write-time only, on both counts.** Neither guard runs on read, on
// projection, on `PUT /api/docs/{id}`, or in the watcher: a thread whose body
// already carries either shape loads, saves and parses exactly as it always
// did. What is refused is the request that *introduces* the shape, while the
// author is present and the text is still in their composer.
//
// ## The fence half (SERVER-075)
//
// §6 delimits turns with `## <author> · <timestamp>` headings and says a fenced
// block closes only on a line holding nothing but its delimiter run. Those two
// rules meet badly: the code scanner masks headings inside code, and an
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
// it is answered by the contract's single code scanner (`code.ts`, moved there
// by CONTRACT-044) — the same pass that decides which bytes are masked. That is
// deliberate: the guard refuses exactly the texts whose turn headings *this
// corpus's own reader* would stop seeing, so it can neither refuse something
// that would have parsed nor accept something that would not, even where that
// scanner's container approximations diverge from CommonMark (it documents which
// ones and in which direction).
//
// ## The fabricated-heading half (SERVER-076)
//
// The mirror image. A body carrying a bare `## user · <instant>` line does not
// hide turns, it *invents* one: everything the author wrote below that line is
// filed as a second turn, attributed to whoever the line names and stamped with
// whatever it says. Splitting your own message is bad enough; writing one signed
// by the other party is worse, and neither is something a composer offers.
//
// **Why this is P2 where the fence half was P0, and why shipping them apart was
// right.** A swallowed turn is silent — the bytes are on disk, every reader sees
// fewer, and nothing anywhere says so. A fabricated heading appears immediately,
// in the thread, where the person who wrote it is looking. Nothing is lost and
// the damage announces itself, so this guard is allowed to be exactly as heavy
// as the fence guard and no heavier.
//
// **Quoting a heading still works**, and it has to: the skills document the turn
// format, and §11's snippet action exists to paste markdown into a thread. Every
// way of writing the format down survives — inside a fence (the code scanner
// masks it), inside an inline code span or a block quote or under any
// indentation (the line no longer starts with `## `, so the parser's own heading
// pattern does not match). What is refused is only the shape that would *become*
// a delimiter, and the question is put to the turn parser rather than answered
// here.
//
// **Every actor here too**, and for a sharper reason than the fence half's: an
// agent turn that fabricates a `## user · <ts>` heading puts words in the
// person's mouth, in their thread, signed by them. The actor most worth guarding
// is the one an exemption would have excused. Nothing in the workspace template
// is refused by this — its examples of the format sit in fenced blocks, which is
// where the skills tell everyone to put snippets in the first place.

import { parseThreadBody, splitLines, unterminatedFence } from "../core/index.js";
import { badRequest } from "../errors.js";

/**
 * What is being refused, in the words the caller's route uses.
 *
 * `subject` is the noun the message opens with ("this turn", "this answer") and
 * `path` is the request field the text arrived in, so the issue points at
 * something the client can highlight rather than at a field it does not have.
 */
export interface TurnTextSubject {
  readonly subject: string;
  readonly path: string;
}

export const TURN_SUBJECT: TurnTextSubject = { subject: "this turn", path: "body" };
export const CAPTURE_SUBJECT: TurnTextSubject = { subject: "this capture", path: "text" };
export const ANSWER_SUBJECT: TurnTextSubject = { subject: "this answer", path: "body" };

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
export function assertClosedFences(text: string | undefined, where: TurnTextSubject): void {
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

/**
 * Refuse `text` if it carries a line the thread reader would take for a turn
 * heading (SPEC.md §6; SERVER-076).
 *
 * The predicate is not "does this text mention the turn format" — it is "would
 * the turn parser find a delimiter in it", and it is asked by handing the text
 * to {@link parseThreadBody} itself. A body with no heading parses to zero
 * turns; one heading and the text below it becomes a turn of its own. That is
 * the whole test, and it is the reason quoting works without a single exemption
 * being written here: fenced headings are masked by the code scanner, and a
 * heading behind a `>` marker, inside backticks or under indentation is not
 * line-initial, so the parser's pattern never sees it. Anything this guard
 * accepts is therefore something the reader would file as one turn — and
 * anything it refuses would really have split, however the two grammars grow.
 *
 * The coordinates come from the parse too. `preamble` is by construction the
 * bytes before the first heading, so its length is the heading's offset and its
 * line count is the heading's line number — measured in the author's own text,
 * which is the only string they can go and look at.
 *
 * Absent text (an attachment-only turn, §6) has no line to fabricate one with.
 */
export function assertNoTurnHeadings(text: string | undefined, where: TurnTextSubject): void {
  if (text === undefined) return;
  const { preamble, turns } = parseThreadBody(text);
  const fabricated = turns[0];
  if (fabricated === undefined) return;
  const line = splitLines(preamble).length;
  const source = text.slice(preamble.length).split(/\r?\n/, 1)[0] ?? "";
  throw badRequest(
    `${where.subject} contains a line that reads as a turn heading: line ${line} is ` +
      `\`${source}\`, which §6 makes a turn delimiter — everything below it would be split off ` +
      `into a separate turn signed by ${fabricated.author}. Reword that line, or quote it inside ` +
      "a code fence, an inline code span or a block quote, none of which delimit anything.",
    [{ path: where.path, message: `line ${line} reads as a turn heading` }],
  );
}

/**
 * Both guards, in the order a person can act on.
 *
 * Every surface that appends a turn calls this rather than either half, which is
 * the point of it existing: the reply path having one guard and the form-answer
 * path having two is precisely how SERVER-076 came to be a separate issue, and a
 * fifth door added later gets both by writing one line.
 *
 * The fence goes first, and not arbitrarily. An unterminated fence masks
 * everything after it, so a heading below one is invisible to the parser and the
 * heading guard would say nothing about a text that has two faults. Reporting
 * the fence is reporting the one that has to be fixed before the other can even
 * be seen; the resubmitted text is then judged again, by which point the heading
 * is either inside the now-closed fence — content, and accepted — or outside it
 * and refused on its own terms.
 */
export function assertAppendableTurnText(text: string | undefined, where: TurnTextSubject): void {
  assertClosedFences(text, where);
  assertNoTurnHeadings(text, where);
}
