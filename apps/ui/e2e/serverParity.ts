/**
 * The server's own rules, for the browser stub — imported where the repo has a
 * package that owns them, ported and pinned by
 * `scripts/stub-server-parity.test.ts` where it does not.
 *
 * `stubCorpus.ts` answers `/api` from inside the page, so every rule the real
 * server applies *to data it hands back* has to exist there too. Two of them are
 * not cosmetic, because a spec that asserts against a wrong copy is asserting
 * the copy:
 *
 * - **Anchor resolution** (SPEC.md §6). The stub used to implement rung 2 alone
 *   — a unique `exact` — so a framed selector for a *duplicated* phrase, the
 *   exact case §6's prefix/suffix framing exists to serve, resolved against the
 *   real server and came back `orphaned` from the stub (UI-051's finding,
 *   UI-056). Still a port: the original is
 *   `apps/server/src/anchors/resolve.ts`, `apps/ui` may not import
 *   `apps/server` — sibling applications, not a dependency edge (CLAUDE.md →
 *   Repository Structure) — and there is no package both already depend on that
 *   anchor resolution belongs in.
 * - **The thread turn format** (SPEC.md §6). A thread file is a sequence of
 *   `## <author> · <ts>` H2 headings; the turns `GET /api/threads/{id}` reports
 *   are slices of that file, which is what lets an anchor's offsets fall inside
 *   a turn at all. **No longer a port.** CONTRACT-044 moved the heading grammar
 *   and the code scanner that masks it into `@corpus/contract`, so
 *   {@link parseThreadTurns} asks {@link turnHeadings} which lines are
 *   delimiters — the identical function `apps/server`'s own parser asks
 *   (`core/turns.ts`) — and the fence scanner, the line splitter and the heading
 *   regex that used to be transcribed here are gone with it. What is left local
 *   is the slicing and the blank-line trimming that turn a heading list into
 *   turns, which is still the server's and is still what `TURN_PARITY_BODIES`
 *   pins (UI-091).
 *
 * **What the pin is for.** It is not a comment asking to be believed:
 * `scripts/stub-server-parity.test.ts` runs {@link ANCHOR_PARITY_CASES} and
 * {@link TURN_PARITY_BODIES} through **both** implementations and fails if
 * either side moves. Every rule it covers that becomes shared code shrinks what
 * it has to guard; a rule that is imported needs no fixture at all, which is why
 * neither the fence scanner nor the heading grammar has one.
 *
 * **Exact-only, on purpose.** Reads resolve with rungs 1–2 and orphan otherwise;
 * the fuzzy third rung belongs to reconciliation alone, and SERVER-055's attempt
 * to put it on a read path was reverted as unworkable (the passage most similar
 * to a deleted list item is its surviving sibling). A selector that does not
 * resolve verbatim **orphans** here, exactly as it does on the server — a
 * visible orphan beats a silent misattachment.
 *
 * Beyond `@corpus/contract` this module stays dependency-free: it is compiled
 * into the repo tooling's type program by the parity test, and it has no
 * business needing DOM types, Playwright, or anything else.
 */

import { TURN_SEPARATOR, turnHeadings, type Turn } from "@corpus/contract";

/** A §6 text-quote selector, in the shape a request or a frontmatter entry has. */
export interface StubSelector {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Half-open `[start, end)` in UTF-16 code units — what `slice` uses. */
export interface StubRange {
  readonly start: number;
  readonly end: number;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** True when `offset` falls between the two halves of a surrogate pair. */
function splitsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  return isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset));
}

/** Snap a range outward to code-point boundaries, never truncating a character. */
function snapRange(text: string, range: StubRange): StubRange {
  let { start, end } = range;
  if (splitsSurrogatePair(text, start)) start -= 1;
  if (splitsSurrogatePair(text, end)) end += 1;
  return { start, end };
}

/**
 * Rungs 1–2 of SPEC.md §6's ladder — the exactness tier, which is the whole
 * ladder every *read* path runs:
 *
 * 1. `prefix + exact + suffix`, first occurrence. Skipped for a selector with no
 *    context at all, where it would degenerate into a first-occurrence guess and
 *    defeat rung 2's uniqueness requirement.
 * 2. `exact` alone, when it occurs exactly once (overlapping occurrences count).
 *
 * Anything else is `null` — orphaned.
 */
export function resolveAnchorExact(body: string, selector: StubSelector): StubRange | null {
  const { exact } = selector;
  if (exact.length === 0 || body.length === 0) return null;
  const prefix = selector.prefix ?? "";
  const suffix = selector.suffix ?? "";

  if (prefix.length > 0 || suffix.length > 0) {
    const index = body.indexOf(prefix + exact + suffix);
    if (index !== -1) {
      const start = index + prefix.length;
      return snapRange(body, { start, end: start + exact.length });
    }
  }

  const first = body.indexOf(exact);
  if (first !== -1 && body.indexOf(exact, first + 1) === -1) {
    return snapRange(body, { start: first, end: first + exact.length });
  }

  return null;
}

/**
 * One turn of a thread, as `GET /api/threads/{id}` reports it — the contract's
 * own `Turn`, not a transcription of it. Restating the shape here is how the
 * stub drifts from the server it stands in for: `model` (CONTRACT-043) arrived
 * on `Turn` and would have been silently missing from every stubbed response.
 */
export type StubTurn = Turn;

/**
 * Strip the blank line a heading is conventionally followed by, and any trailing
 * blank lines, so a turn's text is what its author actually wrote.
 *
 * The one line of `core/turns.ts` still transcribed here, and the reason
 * {@link TURN_PARITY_BODIES} still has fixtures.
 */
const trimTurnText = (raw: string): string =>
  raw.replace(/^\r?\n/, "").replace(/[ \t]*(\r?\n)+$/, "");

/**
 * The turns of a thread file, in document order (SPEC.md §6).
 *
 * Which lines delimit a turn is {@link turnHeadings}' answer, not a regex
 * written here — the same call `apps/server`'s `scanTurnBlocks` makes, so a
 * heading inside fenced code is content in both places rather than in whichever
 * one remembered to mask it. What is left here is the slicing: anything before
 * the first heading is a preamble and belongs to no turn, so a body with no
 * heading at all has **no turns**, which is what the server reports for it and
 * what the stub must report too.
 */
export function parseThreadTurns(body: string): readonly StubTurn[] {
  const headings = turnHeadings(body);
  return headings.map((heading, index) => ({
    author: heading.author,
    ts: heading.ts,
    body: trimTurnText(body.slice(heading.textStart, headings[index + 1]?.start ?? body.length)),
    // Which model wrote a turn is not in the body — it is recorded in the thread
    // document's frontmatter (CONTRACT-043) — so a parser given a body alone
    // names none, exactly as `apps/server`'s does.
    model: null,
  }));
}

/** One turn's source text, heading included, without a trailing blank line. */
export function renderTurn(turn: StubTurn): string {
  return `## ${turn.author} ${TURN_SEPARATOR} ${turn.ts}\n${turn.body === "" ? "" : `${turn.body}\n`}`;
}

/**
 * An instant in the form a turn heading accepts — seconds, `Z`, no
 * milliseconds. The stub stamps `updated` with millisecond precision, which is
 * legal on the wire and illegal in a heading, and a heading the parser rejects
 * is a turn that silently disappears.
 */
export function canonicalInstant(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19)}Z`;
}

/** One fixture: a body, a selector, and the range the **server** resolves it to. */
export interface AnchorParityCase {
  readonly name: string;
  readonly body: string;
  readonly selector: StubSelector;
  /** `null` means orphaned — the answer §6 requires wherever nothing matches verbatim. */
  readonly expected: StubRange | null;
}

const QUARTERS =
  "# Weekly\n\n- Review the Q1 report by Friday\n- Review the Q2 report by Friday\n- Review the Q3 report by Friday\n- Review the Q4 report by Friday\n";

const DUPLICATED_TURN =
  "Let's revisit the rate assumption.\n\nI said revisit the rate assumption because 6.1% looks stale.";

/**
 * The cases the stub and the server must answer identically.
 *
 * Chosen to straddle every edge the ladder has: which rung answers, which
 * occurrence it picks, and — the half that matters most — where the answer is
 * **no answer**. The lookalike shapes are lifted from
 * `apps/server/src/anchors/resolve.test.ts`'s "rung 3 is inadmissible on a read
 * path", because those are the bodies where a resolver that quietly grew a
 * similarity rung would start disagreeing.
 */
export const ANCHOR_PARITY_CASES: readonly AnchorParityCase[] = [
  {
    name: "rung 1: the framed occurrence, not the first bare one",
    body: "The plan floats the rate for a while. We fix the rate today at signing. Later the rate may drift.",
    selector: { exact: "the rate", prefix: "We fix ", suffix: " today" },
    expected: { start: 45, end: 53 },
  },
  {
    name: "rung 1: a duplicated phrase inside one turn, framed — UI-051's case",
    body: DUPLICATED_TURN,
    selector: {
      exact: "revisit the rate assumption",
      prefix: "I said ",
      suffix: " because 6.1% looks stale.",
    },
    expected: { start: 43, end: 70 },
  },
  {
    name: "rung 1: the same phrase framed as its *first* occurrence",
    body: DUPLICATED_TURN,
    selector: {
      exact: "revisit the rate assumption",
      prefix: "Let's ",
      suffix: ".\n\nI said revisit",
    },
    expected: { start: 6, end: 33 },
  },
  {
    name: "rung 1: first occurrence when even the framed needle repeats",
    body: "x A B C y ... x A B C y",
    selector: { exact: "B", prefix: "A ", suffix: " C" },
    expected: { start: 4, end: 5 },
  },
  {
    name: "rung 1: one-sided context at the start of the body",
    body: "needle then the rest",
    selector: { exact: "needle", suffix: " then" },
    expected: { start: 0, end: 6 },
  },
  {
    name: "rung 2: a context-free selector whose exact occurs once",
    body: "Some prose with a unique anchored fragment inside it.",
    selector: { exact: "unique anchored fragment" },
    expected: { start: 18, end: 42 },
  },
  {
    name: "rung 2: reached when the declared context is stale",
    body: "Rewritten intro. The unique anchored fragment survives. Rewritten outro.",
    selector: { exact: "unique anchored fragment", prefix: "gone ", suffix: " also gone" },
    expected: { start: 21, end: 45 },
  },
  {
    name: "orphan: duplicated exact with stale context — never a guess between the two",
    body: "A same words B ... C same words D",
    selector: { exact: "same words", prefix: "X ", suffix: " Y" },
    expected: null,
  },
  {
    name: "orphan: duplicated exact with no context at all",
    body: "A same words B ... C same words D",
    selector: { exact: "same words" },
    expected: null,
  },
  {
    name: "orphan: overlapping occurrences count as ambiguous",
    body: "aaa",
    selector: { exact: "aa" },
    expected: null,
  },
  {
    name: "orphan: a one-character corruption is not a verbatim survival (SERVER-055)",
    body: "Intro. Here the modle we assume a 30-year fixed at 6.1% holds. Outro.",
    selector: { exact: "the model we assume a 30-year fixed at 6.1%" },
    expected: null,
  },
  {
    name: "orphan: a deleted list item, whose siblings a fuzzy rung would hand back",
    body: QUARTERS.replace("- Review the Q2 report by Friday\n", ""),
    selector: {
      exact: "- Review the Q2 report by Friday",
      prefix: "# Weekly\n\n- Review the Q1 report by Friday\n",
      suffix: "\n- Review the Q3 report by Friday",
    },
    expected: null,
  },
  {
    name: "orphan: an edited table row, rather than the untouched row below it",
    body: "| north-1 | alice | green |\n| north-2 | alice | amber |\n| north-3 | alice | green |\n",
    selector: {
      exact: "| north-2 | alice | green |",
      prefix: "| north-1 | alice | green |\n",
      suffix: "\n| north-3 | alice | green |",
    },
    expected: null,
  },
  {
    name: "orphan: an empty body",
    body: "",
    selector: { exact: "needle" },
    expected: null,
  },
  {
    name: "orphan: an empty exact",
    body: "body",
    selector: { exact: "" },
    expected: null,
  },
  {
    name: "unicode: a code-point-aligned range around astral and RTL text",
    body: "עברית before 🎉 the anchored ✍️ text 🚀 after café́ done",
    selector: { exact: "the anchored ✍️ text" },
    expected: { start: 16, end: 36 },
  },
  {
    name: "unicode: a range that would split a surrogate pair snaps outward",
    // A lone high surrogate as `exact` is not something a composer produces; it
    // is the shape that proves the snap is implemented rather than skipped.
    body: "a🎉b",
    selector: { exact: "\ud83c" },
    expected: { start: 1, end: 3 },
  },
];

/**
 * Thread files whose turn split the stub and the server must agree on — the
 * heading form, the trimming, a preamble, an empty turn, a body with no headings
 * at all, and a heading quoted inside fenced code (which is content, not a
 * delimiter).
 *
 * They kept their fixtures through UI-091 and are worth keeping: what they now
 * pin is the **slicing**, not the grammar. Both sides ask
 * {@link turnHeadings} which lines are delimiters, so the heading form and the
 * fence masking can no longer disagree by construction — but `trimTurnText` and
 * the span each heading owns are still transcribed from `core/turns.ts`, and
 * `"an empty turn, and one with trailing blank lines"` is the case that fails
 * the moment one of them drifts.
 */
export const TURN_PARITY_BODIES: readonly { readonly name: string; readonly body: string }[] = [
  {
    name: "a two-turn conversation",
    body: "## user · 2026-07-01T09:00:00Z\nFirst.\n\n## agent · 2026-07-01T09:05:00Z\nSecond.\n",
  },
  {
    name: "a preamble before the first heading",
    body: "Some preamble.\n\n## user · 2026-07-01T09:00:00Z\nOnly turn.\n",
  },
  { name: "no headings at all", body: "Which lenders?" },
  { name: "an empty body", body: "" },
  {
    name: "a heading quoted inside a fence stays content",
    body: "## user · 2026-07-01T09:00:00Z\nLike this:\n\n```md\n## agent · 2026-07-01T09:05:00Z\n```\n",
  },
  {
    name: "an empty turn, and one with trailing blank lines",
    body: "## user · 2026-07-01T09:00:00Z\n\n## agent · 2026-07-01T09:05:00Z\nBody.\n\n\n",
  },
  {
    name: "millisecond precision is not a turn heading",
    body: "## user · 2026-07-01T09:00:00.000Z\nNot a turn.\n",
  },
  {
    name: "a turn whose text repeats a phrase",
    body: `## user · 2026-07-01T09:00:00Z\n${DUPLICATED_TURN}\n`,
  },
];
