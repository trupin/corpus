import { UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import type { ParsedFlags } from "../../parse-args.js";
import { oneLine, renderColumns } from "../columns.js";

/**
 * Reading part of a conversation instead of all of it (CLI-076) — the thread
 * side of `corpus doc show --headings` / `--section`, and built on the same
 * shape: read the map, decide, fetch the territory.
 *
 * A thread is the one unbounded read left on SPEC.md §7's reply path. A 19-turn
 * conversation measured 32,375 bytes, every reply paid for all of it, and the
 * cost grows every time somebody speaks — while `corpus thread context`, which
 * the same skill calls one line earlier, is bounded by contract. The cheap way
 * round that today is `sed -n` against `data/threads/`, which goes around the
 * CLI that CLAUDE.md Architecture Decision 2 says is the whole surface.
 *
 * ## What this module owns
 *
 * The **derivation**, and only that: the index rows, the address grammar, and
 * the selection. `show.ts` owns the request and the printing. Nothing here
 * reads the filesystem, and nothing here is stored — every number is computed
 * from the `turns` array the endpoint already returned, so none of it can go
 * stale relative to what the server said.
 *
 * ## The saving is context, not wire (decision 1)
 *
 * The whole thread still crosses the socket. That is a weaker position than
 * `doc show --section` had — a turn is a discrete record with its own identity,
 * not a substring of a body that a later `doc patch --old` has to match
 * character for character, so "a server-side slice would be a second definition
 * of the bytes" does not apply here and a route would genuinely save 32KB of
 * wire. It stays CLI-side anyway, for reasons that are about this issue rather
 * than about `--section`: the read that hurts is the agent's context, a route
 * needs a contract change and a server change before it can deliver anything,
 * and slicing what one response already holds cannot disagree with what that
 * response said. The help says the saving is context and a test pins the
 * request count at one, so nothing here can quietly start claiming otherwise.
 *
 * ## Ordinals and timestamps (decision 2)
 *
 * SPEC.md §6 makes the **timestamp** a turn's identity, and it also lets a
 * person delete a single turn. So an ordinal is a *positional* address that a
 * deletion silently re-points at a different turn, and a timestamp is the
 * address that survives one. The index prints both, `--turn` accepts either,
 * and the help says which is which rather than leaving a caller to find out.
 */

/** How many characters of a turn's first line the index shows before it cuts. */
export const EXCERPT_CHARS = 60;

/** What an excerpt that was cut ends in, so a truncated one can never read as whole text. */
export const EXCERPT_ELLIPSIS = "…";

/** The structural minimum this module needs of a turn; the wire type satisfies it. */
export interface TurnLike {
  readonly author: string;
  readonly ts: string;
  readonly body: string;
}

/** One derived row of the index. Carries no body — that is the point of the index. */
export interface TurnIndexRow {
  /** 1-based position in the thread, oldest first. */
  readonly turn: number;
  readonly author: string;
  readonly ts: string;
  /** The turn's body in UTF-8 bytes, heading line excluded (decision 3). */
  readonly bytes: number;
  /** The first line, cut at {@link EXCERPT_CHARS}, marked when anything was left out. */
  readonly excerpt: string;
  readonly truncated: boolean;
}

/** A turn paired with the ordinal it was addressed by. */
export interface AddressedTurn<T extends TurnLike> {
  readonly turn: number;
  readonly value: T;
}

/**
 * What the caller asked for. Parsed from the flags **before the request**, so a
 * malformed address costs no round trip and cannot be confused with a thread
 * that does not hold what was asked for.
 */
export type TurnAddress =
  | { readonly kind: "turn"; readonly value: string }
  | { readonly kind: "turns"; readonly value: string }
  | { readonly kind: "last"; readonly value: number }
  | { readonly kind: "since"; readonly value: string };

/** The flags that address turns, in the order they are declared on the verb. */
const ADDRESS_FLAG_NAMES = ["turn", "turns", "last", "since"] as const;

/**
 * How many bytes a turn's body occupies in UTF-8 (decision 3).
 *
 * **The body, and nothing around it.** Not the `## author · ts` heading, not the
 * blank line that separates one turn from the next in the file. Two properties
 * follow and both are asserted: the index header's total is exactly the sum of
 * its rows, and a row's count predicts what `--turn <n>` will put on stdout.
 * A count that included framing would predict neither.
 */
export function turnBytes(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

/**
 * The first line of a turn, cut to fit a row, and **marked whenever anything was
 * left out** — including when what was left out is the rest of the turn rather
 * than the rest of the line.
 *
 * The marking is the whole requirement. `corpus search`'s snippet is ellipsized
 * and newline-collapsed and reads like stored text, and a caller that pasted one
 * into `corpus doc patch --old` matched zero times (CLI-055). An index excerpt
 * is never the stored bytes; it says so in the one way a reader cannot miss.
 */
export function turnExcerpt(body: string): { excerpt: string; truncated: boolean } {
  const firstLine = body.split("\n", 1)[0] ?? "";
  const collapsed = oneLine(firstLine);
  const more = collapsed.length < oneLine(body).length;
  if (collapsed.length <= EXCERPT_CHARS) {
    return { excerpt: more ? `${collapsed}${EXCERPT_ELLIPSIS}` : collapsed, truncated: more };
  }
  return {
    excerpt: `${collapsed.slice(0, EXCERPT_CHARS)}${EXCERPT_ELLIPSIS}`,
    truncated: true,
  };
}

/** One row per turn, oldest first — the map `--turn` and friends address into. */
export function turnIndexRows(turns: readonly TurnLike[]): readonly TurnIndexRow[] {
  return turns.map((turn, position) => {
    const { excerpt, truncated } = turnExcerpt(turn.body);
    return {
      turn: position + 1,
      author: turn.author,
      ts: turn.ts,
      bytes: turnBytes(turn.body),
      excerpt,
      truncated,
    };
  });
}

/** The sum of the rows, which is what the header states. */
export function totalTurnBytes(turns: readonly TurnLike[]): number {
  return turns.reduce((sum, turn) => sum + turnBytes(turn.body), 0);
}

/** One padded line per row: ordinal, author, timestamp, byte count, excerpt. */
export function renderTurnIndex(rows: readonly TurnIndexRow[]): readonly string[] {
  return renderColumns(
    rows.map((row) => [
      String(row.turn),
      row.author,
      row.ts,
      `${String(row.bytes)} B`,
      row.excerpt,
    ]),
  );
}

/**
 * The address the flags name, or `undefined` for the whole read.
 *
 * Two address flags together, and an address flag beside `--index`, are usage
 * errors rather than a silently-honoured winner (decision 6). A flag that does
 * nothing is exactly how a caller comes to believe it received a slice when it
 * received the dump — which is the cost this feature exists to remove.
 */
export function turnAddress(flags: ParsedFlags): TurnAddress | undefined {
  const named = ADDRESS_FLAG_NAMES.filter((name) =>
    name === "last" ? flags.number(name) !== undefined : flags.string(name) !== undefined,
  );

  if (named.length > 1) {
    throw new UsageError(
      `${named.map((name) => `--${name}`).join(" and ")} each address a different set of turns.`,
      {
        hint: "Pass one of them. `--index` first is how you decide which. Nothing was requested.",
      },
    );
  }

  if (flags.boolean("index")) {
    if (named.length === 0) return undefined;
    throw new UsageError(`--index and --${named[0] ?? ""} ask for different things.`, {
      hint:
        "--index lists the turns and their sizes; the address flags print the turns themselves. " +
        "Run --index first, then address what is worth reading. Nothing was requested.",
    });
  }

  const which = named[0];
  if (which === undefined) return undefined;
  if (which === "last") {
    const value = flags.number("last") ?? 0;
    if (!Number.isInteger(value) || value < 1) {
      throw new UsageError(
        `--last counts turns from 1, so ${String(value)} is not a number of them.`,
        {
          hint: "Pass --last 3 for the three newest. Nothing was requested.",
        },
      );
    }
    return { kind: "last", value };
  }
  return { kind: which, value: flags.string(which) ?? "" };
}

/**
 * The addressed turns, oldest first, or a usage error naming what went wrong.
 *
 * **No address ever falls back to the whole thread.** Every failure below throws
 * before a byte is printed, which is the property the feature turns on: a silent
 * fallback would hand back the 32KB the caller was avoiding and say nothing.
 */
export function selectTurns<T extends TurnLike>(
  turns: readonly T[],
  address: TurnAddress,
): readonly AddressedTurn<T>[] {
  switch (address.kind) {
    case "turn":
      return [selectOne(turns, address.value)];
    case "turns":
      return selectList(turns, address.value);
    case "last":
      return all(turns).slice(Math.max(0, turns.length - address.value));
    case "since":
      return selectSince(turns, address.value);
  }
}

function all<T extends TurnLike>(turns: readonly T[]): readonly AddressedTurn<T>[] {
  return turns.map((value, position) => ({ turn: position + 1, value }));
}

/**
 * `--turn` takes **either** address (decision 2): a whole number is the ordinal
 * printed by `--index`, anything else is read as an instant and matched against
 * the turn's `ts`, which SPEC.md §6 makes its identity.
 *
 * The instant is compared as a parsed time rather than as a string, so the
 * second-precision form the thread file writes and the millisecond form the API
 * returns both address the same turn. A caller should not have to know which
 * spelling it is holding.
 */
function selectOne<T extends TurnLike>(turns: readonly T[], value: string): AddressedTurn<T> {
  refuseEmpty(turns, "--turn");

  if (/^-?\d+$/.test(value.trim())) {
    const ordinal = Number(value.trim());
    const found = all(turns).find((entry) => entry.turn === ordinal);
    if (found !== undefined) return found;
    throw new UsageError(
      `--turn ${value.trim()} names no turn: this thread has ${plural(turns.length, "turn")}.`,
      { hint: ordinalHint(turns) },
    );
  }

  const wanted = Date.parse(value);
  if (Number.isNaN(wanted)) {
    throw new UsageError(`--turn ${value} is neither a turn number nor a timestamp.`, {
      hint:
        "Pass the ordinal `--index` printed (`--turn 7`), or the ISO instant beside it " +
        "(`--turn 2026-07-28T10:05:00Z`), which is the address that survives a deleted turn.",
    });
  }
  const found = all(turns).find((entry) => Date.parse(entry.value.ts) === wanted);
  if (found !== undefined) return found;
  throw new UsageError(`--turn ${value} names no turn of this thread.`, {
    hint: `Run --index for the timestamps this thread holds. ${ordinalHint(turns)}`,
  });
}

/** `--turns 1,4-6` — ordinals and ranges only, deduplicated and ordered oldest first. */
function selectList<T extends TurnLike>(
  turns: readonly T[],
  value: string,
): readonly AddressedTurn<T>[] {
  refuseEmpty(turns, "--turns");
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) {
    throw new UsageError("--turns names no turn.", {
      hint: `Pass ordinals and ranges: \`--turns 1,4-6\`. ${ordinalHint(turns)}`,
    });
  }

  const wanted = new Set<number>();
  for (const part of parts) {
    // `.match` rather than `.exec`: the hygiene scan forbids the word `exec` in
    // these modules, and a regular expression is not what the rule is about.
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) {
        throw new UsageError(`--turns ${part} runs backwards.`, {
          hint: `Write the range oldest first: \`${String(to)}-${String(from)}\`. Nothing was printed.`,
        });
      }
      for (let ordinal = from; ordinal <= to; ordinal += 1) wanted.add(ordinal);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw new UsageError(`--turns takes ordinals and ranges, and \`${part}\` is neither.`, {
        hint:
          "Write it as `--turns 1,4-6`. A timestamp addresses one turn through `--turn`. " +
          "Nothing was printed.",
      });
    }
    wanted.add(Number(part));
  }

  const missing = [...wanted].filter((ordinal) => ordinal < 1 || ordinal > turns.length);
  if (missing.length > 0) {
    throw new UsageError(
      `--turns names ${plural(missing.length, "turn")} this thread does not have: ` +
        `${missing.map((ordinal) => String(ordinal)).join(", ")}.`,
      { hint: ordinalHint(turns) },
    );
  }

  const ordered = [...wanted].sort((a, b) => a - b);
  const indexed = all(turns);
  return ordered.flatMap((ordinal) => {
    const found = indexed.find((entry) => entry.turn === ordinal);
    return found === undefined ? [] : [found];
  });
}

/**
 * `--since` is **exclusive** (decision 5): the caller holds the timestamp of the
 * last turn it read and is asking what has been said after it, so the turn it
 * already has is not part of the answer.
 *
 * An empty answer is an answer, not a failure. That is the same carve-out
 * `--last 50` of 19 turns gets: a range query that runs past the end of the
 * conversation has an obvious honest result, and a loop asking "anything new?"
 * on every wake would otherwise read its own quiet as an error. What is refused
 * is an address that names something the thread does not hold — an ordinal, or a
 * timestamp that is not a timestamp — and in no case is the whole thread
 * printed instead.
 */
function selectSince<T extends TurnLike>(
  turns: readonly T[],
  value: string,
): readonly AddressedTurn<T>[] {
  const since = Date.parse(value);
  if (Number.isNaN(since)) {
    throw new UsageError(`--since ${value} is not a timestamp.`, {
      hint:
        "Pass an ISO instant, such as `--since 2026-07-28T10:05:00Z` — the `ts` of the last " +
        "turn you read. Nothing was printed.",
    });
  }
  return all(turns).filter((entry) => Date.parse(entry.value.ts) > since);
}

function refuseEmpty(turns: readonly TurnLike[], flag: string): void {
  if (turns.length > 0) return;
  throw new UsageError(`${flag} addresses a turn, and this thread has none.`, {
    hint: "Read it without a flag, or with --index, to see that it is empty.",
  });
}

function ordinalHint(turns: readonly TurnLike[]): string {
  if (turns.length === 0) return "This thread has no turns.";
  return `Turns are numbered 1–${String(turns.length)}, oldest first; --index prints them.`;
}
