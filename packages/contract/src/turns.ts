/**
 * Where one turn ends and the next begins (SPEC.md §6) — the *reading* half of
 * the thread turn format, and only that half.
 *
 * A thread body is a sequence of turns delimited by an H2 heading
 * `## <author> · <ISO instant>`, where the separator is U+00B7 MIDDLE DOT and
 * the instant is written UTC at second precision. A heading inside fenced code
 * is content, not a delimiter: a turn quoting the turn format in a code block
 * must stay one turn, and the skills' own examples depend on that.
 *
 * **Why the recogniser is here and the parser is not** (CONTRACT-044). Three
 * things need to know what a turn heading looks like, and they want three
 * different answers from it:
 *
 *   - `apps/server`'s `core/turns.ts` wants the turns — it slices the body at
 *     these lines, and it also *writes* them (`appendTurn`, `deleteTurn`,
 *     `nextTurnTs`, which enforce §6's timestamp-is-identity invariant).
 *   - the write path refuses a body that would **fabricate** one, since a
 *     person's text carrying a literal `## user · <ts>` line splits their own
 *     message into two turns (`threads/fences.ts`, SERVER-076).
 *   - the composer wants to say so before the round trip, against the field at
 *     fault (§10, UI-091) — and `apps/ui` cannot import `apps/server`.
 *
 * Only the first of those wants a `Turn[]`. So what moved into the contract is
 * the **grammar** — which lines are delimiters, given that fences mask them —
 * and not the parser built on it: turn *mutation* belongs to the sole writer
 * (CLAUDE.md → Architecture Decision 2), and putting `appendTurn` in the package
 * that describes the HTTP API would put the writer in the contract. The server's
 * parser is rebuilt on {@link turnHeadings}, so there is exactly one notion of a
 * heading rather than a parser and a guard that agree today.
 *
 * Offsets are UTF-16 code-unit offsets, as in {@link splitLines}.
 */

import { ACTORS } from "./actor.js";
import { fencedCodeRanges, overlapsRange, splitLines } from "./code.js";
import type { Turn } from "./schemas/thread.js";

/** U+00B7 MIDDLE DOT — the separator §6 fixes, named so it cannot be mistyped for a period. */
export const TURN_SEPARATOR = "·";

/**
 * The canonical written form of an instant: UTC, second precision (SPEC.md §5).
 *
 * It lives beside the heading grammar because that is what makes it load-bearing
 * rather than a formatting preference — a timestamp is a turn's identity (§6)
 * and appears verbatim in the delimiter, so a heading stamped with milliseconds
 * is not a heading at all and the turn it was meant to open silently disappears.
 * `apps/server`'s `core/time.ts` re-exports this rather than spelling it again.
 */
export const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Trailing spaces and tabs are tolerated after the stamp — an editor that strips
 * or adds them must not make turns appear and disappear — but nothing else is.
 */
const TURN_HEADING = new RegExp(
  `^## (${ACTORS.join("|")}) ${TURN_SEPARATOR} (${CANONICAL_INSTANT.source.slice(1, -1)})[ \\t]*$`,
);

/** The author of a turn, which is exactly the set of actors §6 names. */
export type TurnAuthor = Turn["author"];

/** One `## <author> · <ts>` line that really delimits a turn. */
export interface TurnHeading {
  readonly author: TurnAuthor;
  /** The instant exactly as written, which is the turn's identity (§6). */
  readonly ts: string;
  /** Offset of the first character of the heading line. */
  readonly start: number;
  /** Offset just past the heading's line terminator — where the turn's text begins. */
  readonly textStart: number;
  /** 1-based line number of the heading within the scanned body. */
  readonly line: number;
}

const asAuthor = (value: string | undefined): TurnAuthor | null =>
  ACTORS.find((actor) => actor === value) ?? null;

/**
 * Every line of `body` that delimits a turn, in document order — empty for a
 * body that is all preamble, which is what a document with no headings is.
 *
 * Asked of a *thread file*, this is where the turns begin. Asked of one author's
 * own words before they are appended, a non-empty answer is a **fabricated**
 * heading: everything below that line would be filed as a second turn, signed by
 * whoever the line names (`assertNoTurnHeadings`, SERVER-076; UI-091 asks the
 * same question in the composer). Both callers want the same list, so there is
 * one function and no second predicate to disagree with it.
 *
 * The masking is {@link fencedCodeRanges}', the same pass that decides which
 * bytes are code everywhere else, so a heading a reader would not see is a
 * heading nothing here reports either — including inside a fence that was left
 * open, whose mask runs to the end of the body. That is not a bug to route
 * around: it is precisely why an unterminated fence is refused on the write
 * paths (`unterminatedFence`), and a guard built on this scanner is honest about
 * what this corpus's own readers will do with those bytes.
 *
 * Deliberately *not* masked: inline code spans and block quotes. A `## user · …`
 * inside a backtick span is not on a line of its own, so it cannot match; a
 * quoted one (`> ## user · …`) does not match either, because the grammar is
 * anchored at column 0. Both are excluded by the rule rather than by a mask.
 */
export function turnHeadings(body: string): TurnHeading[] {
  const fenced = fencedCodeRanges(body);
  const headings: TurnHeading[] = [];
  let lineNumber = 0;
  for (const line of splitLines(body)) {
    lineNumber += 1;
    const match = TURN_HEADING.exec(line.text);
    const author = asAuthor(match?.[1]);
    const ts = match?.[2];
    if (author === null || ts === undefined) continue;
    if (overlapsRange(fenced, line.start, line.contentEnd)) continue;
    headings.push({ author, ts, start: line.start, textStart: line.end, line: lineNumber });
  }
  return headings;
}
