import type { Turn } from "@corpus/contract";
import { ACTORS } from "@corpus/contract";
import { fencedCodeRanges, overlapsRange, splitLines } from "./code.js";
import {
  CANONICAL_INSTANT,
  formatInstant,
  instantToEpochMs,
  normalizeInstant,
  nowIso,
} from "./time.js";

/**
 * The thread turn format (SPEC.md §6). A thread body is a sequence of turns,
 * each delimited by an H2 heading `## <author> · <ISO timestamp>` where the
 * separator is U+00B7 MIDDLE DOT. Timestamps are the turn's **identity**, so
 * uniqueness and monotonicity are invariants of {@link appendTurn} rather than
 * something callers are trusted to get right.
 *
 * Anything before the first heading is a preamble, preserved verbatim.
 */

/** U+00B7 MIDDLE DOT — the separator §6 fixes, named so it cannot be mistyped for a period. */
export const TURN_SEPARATOR = "·";

const TURN_HEADING = new RegExp(
  `^## (${ACTORS.join("|")}) ${TURN_SEPARATOR} (${CANONICAL_INSTANT.source.slice(1, -1)})[ \\t]*$`,
);

const MILLISECONDS_PER_SECOND = 1000;

export type TurnAuthor = Turn["author"];

/** A turn plus the span of the source body it occupies, heading included. */
type TurnBlock = Turn & { readonly start: number; readonly end: number };

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

const asAuthor = (value: string | undefined): TurnAuthor | null =>
  ACTORS.find((actor) => actor === value) ?? null;

const scanTurnBlocks = (body: string): TurnBlock[] => {
  // Headings inside fenced code are content, not delimiters: a turn quoting the
  // turn format in a code block must stay a single turn.
  const fenced = fencedCodeRanges(body);
  const headings: { textStart: number; start: number; author: TurnAuthor; ts: string }[] = [];
  for (const line of splitLines(body)) {
    const match = TURN_HEADING.exec(line.text);
    const author = asAuthor(match?.[1]);
    const ts = match?.[2];
    if (author === null || ts === undefined) continue;
    if (overlapsRange(fenced, line.start, line.contentEnd)) continue;
    headings.push({ start: line.start, textStart: line.end, author, ts });
  }
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? body.length;
    return {
      author: heading.author,
      ts: heading.ts,
      body: trimTurnText(body.slice(heading.textStart, end)),
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
    turns: blocks.map(({ author, ts, body: text }) => ({ author, ts, body: text })),
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
  const turn: Turn = { author: input.author, ts, body: input.text.trim() };
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
    deleted: { author: block.author, ts: block.ts, body: block.body },
  };
};

/** Timestamps written more than once in this thread body — a §14 hard failure. */
export const duplicateTurnTimestamps = (body: string): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const turn of scanTurnBlocks(body)) {
    if (seen.has(turn.ts)) duplicates.add(turn.ts);
    seen.add(turn.ts);
  }
  return [...duplicates];
};
