import type { Turn, TurnAuthor } from "@corpus/contract";
import { TURN_SEPARATOR, turnHeadings } from "@corpus/contract";
import { formatInstant, instantToEpochMs, normalizeInstant, nowIso } from "./time.js";

/**
 * The thread turn format (SPEC.md §6). A thread body is a sequence of turns,
 * each delimited by an H2 heading `## <author> · <ISO timestamp>` where the
 * separator is U+00B7 MIDDLE DOT. Timestamps are the turn's **identity**, so
 * uniqueness and monotonicity are invariants of {@link appendTurn} rather than
 * something callers are trusted to get right.
 *
 * Anything before the first heading is a preamble, preserved verbatim.
 *
 * **Which half is here.** Recognising a delimiter is the contract's
 * ({@link turnHeadings}, CONTRACT-044): a write path refuses a body that would
 * fabricate one and the composer wants to say so first, so that rule has readers
 * outside this application. Everything below it — slicing the body into turns,
 * and above all *writing* them, where §6's timestamp-is-identity invariant is
 * enforced — stays with the sole writer. There is one notion of a heading, not a
 * parser and a guard that agree today.
 */

export { TURN_SEPARATOR };
export type { TurnAuthor };

const MILLISECONDS_PER_SECOND = 1000;

/** A turn plus the span of the source body it occupies, heading included. */
type TurnBlock = Turn & { readonly start: number; readonly end: number };

/**
 * The model that wrote a turn is **not in the body** (CONTRACT-043): it lives in
 * the thread document's frontmatter, keyed by turn timestamp, so that nothing a
 * turn's own text can say is able to claim it. This module only ever sees a
 * body, so every turn it produces names no model — which is §10's answer for a
 * turn nobody recorded one for: `null`, never a guess.
 *
 * Joining the frontmatter map to these turns is the read path's job, above this
 * function and below the route (SERVER-074).
 */
const NO_MODEL = null;

export type ThreadBody = {
  /** Content before the first turn heading, verbatim. */
  readonly preamble: string;
  readonly turns: readonly Turn[];
};

/**
 * Strip the single blank line a heading is conventionally followed by, and any
 * trailing blank lines, so a turn's text is what its author actually wrote.
 */
const trimTurnText = (raw: string): string =>
  raw.replace(/^\r?\n/, "").replace(/[ \t]*(\r?\n)+$/, "");

const scanTurnBlocks = (body: string): TurnBlock[] => {
  // Which lines are delimiters — headings inside fenced code among them, since a
  // turn quoting the turn format in a code block must stay a single turn — is
  // the contract's answer. What this adds is the span each one owns.
  const headings = turnHeadings(body);
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? body.length;
    return {
      author: heading.author,
      ts: heading.ts,
      body: trimTurnText(body.slice(heading.textStart, end)),
      model: NO_MODEL,
      start: heading.start,
      end,
    };
  });
};

/** Split a thread body into its preamble and its turns, in document order. */
export const parseThreadBody = (body: string): ThreadBody => {
  const blocks = scanTurnBlocks(body);
  const first = blocks[0];
  return {
    preamble: first === undefined ? body : body.slice(0, first.start),
    turns: blocks.map(({ author, ts, body: text, model }) => ({ author, ts, body: text, model })),
  };
};

/** The turns of a thread body, in document order. */
export const parseTurns = (body: string): Turn[] => [...parseThreadBody(body).turns];

/** Render one turn's source text, heading included, without a trailing blank line. */
const renderTurn = (turn: Turn): string =>
  `## ${turn.author} ${TURN_SEPARATOR} ${turn.ts}\n${turn.body === "" ? "" : `${turn.body}\n`}`;

export type AppendTurnInput = {
  readonly author: TurnAuthor;
  readonly text: string;
  /** Defaults to now; bumped when it would not be strictly greater than the last turn. */
  readonly ts?: string;
};

/**
 * The timestamp the next turn will carry — `requested` when it is strictly
 * greater than every stamp already in the thread, and the bump otherwise.
 *
 * Split out of {@link appendTurn} because attachments need the stamp *before*
 * the body exists: it names the directory the bytes go in, and the body then
 * quotes that directory in its reference lines (SPEC.md §6). Deriving it twice
 * would be two chances to disagree about which turn the bytes belong to.
 */
export const nextTurnTs = (body: string, requestedTs?: string): string => {
  const latestMs = scanTurnBlocks(body).reduce<number>(
    (latest, turn) => Math.max(latest, instantToEpochMs(turn.ts) ?? Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY,
  );
  const requested = requestedTs === undefined ? nowIso() : normalizeInstant(requestedTs);
  if (requested === null) throw new TypeError(`Not an ISO-8601 instant: ${String(requestedTs)}`);
  const requestedMs = instantToEpochMs(requested) ?? Number.NEGATIVE_INFINITY;
  return requestedMs > latestMs ? requested : formatInstant(latestMs + MILLISECONDS_PER_SECOND);
};

/**
 * Append a turn, guaranteeing its timestamp is strictly greater than every
 * timestamp already in the thread. A caller supplying a stale or duplicate `ts`
 * has it bumped rather than rejected: timestamps are identity (§6), and the one
 * writer of this format is the only place that invariant can be enforced.
 */
export const appendTurn = (body: string, input: AppendTurnInput): { body: string; turn: Turn } => {
  const ts = nextTurnTs(body, input.ts);
  const turn: Turn = { author: input.author, ts, body: input.text.trim(), model: NO_MODEL };
  const head = body.replace(/[ \t\r\n]*$/, "");
  return { body: head === "" ? renderTurn(turn) : `${head}\n\n${renderTurn(turn)}`, turn };
};

/**
 * Remove the turn whose timestamp is `ts`, leaving every other byte of the body
 * untouched. Returns the body unchanged when no turn carries that timestamp.
 * Whether removing the last turn deletes the thread is the write path's policy,
 * not this function's (§6).
 */
export const deleteTurn = (body: string, ts: string): { body: string; deleted: Turn | null } => {
  const normalized = normalizeInstant(ts);
  const block = scanTurnBlocks(body).find((candidate) => candidate.ts === normalized);
  if (block === undefined) return { body, deleted: null };
  return {
    body: body.slice(0, block.start) + body.slice(block.end),
    deleted: { author: block.author, ts: block.ts, body: block.body, model: block.model },
  };
};

/** Timestamps written more than once in this thread body — a §11 hard failure. */
export const duplicateTurnTimestamps = (body: string): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const turn of scanTurnBlocks(body)) {
    if (seen.has(turn.ts)) duplicates.add(turn.ts);
    seen.add(turn.ts);
  }
  return [...duplicates];
};
