import { headingSections, renderHeadingPath } from "@corpus/contract";
import { UsageError } from "../../errors.js";

/**
 * A document's sections, addressed the way `corpus search --json` already
 * addresses a hit — the machinery behind `corpus doc show --headings` and
 * `--section` (CLI-055).
 *
 * ## Why this exists at all
 *
 * `corpus doc patch` prices a bounded edit at the size of the edit, but only if
 * the passage can be quoted without reading the document first, and `--old` is
 * matched byte for byte. Until this file, the CLI offered no way to get those
 * bytes: `doc show` read all or nothing, and `search`'s snippet is ellipsized
 * and newline-collapsed, so a snippet spanning a line break matches **0 times**
 * (measured in the field, 2026-08-21, and reproduced before this was written).
 * The cheapest read in a Corpus workspace was therefore `grep` and `sed`
 * against the file — outside the CLI, which CLAUDE.md Architecture Decision 2
 * says is the agent's whole surface. An invariant that costs 175× to honour is
 * not honoured.
 *
 * ## Byte-exactness is the property, and it is structural here
 *
 * A section is `body.slice(start, end)` and **nothing is done to it** — no
 * trim, no ellipsis, no newline collapsing, no re-wrapping. That is not a
 * discipline this file asks its callers to keep; it is the only operation it
 * performs. The consequence that matters: what `--section` prints is by
 * construction a substring of the same `doc.body` the server matches
 * `POST /api/docs/{id}/patch` against, so a section pasted into `--old` can
 * only fail to match if the document changed in between — which is exactly what
 * a staleness check is for.
 *
 * ## The scan is the contract's, not a second opinion
 *
 * The boundary rule, the ATX grammar, the fence masking and the address join
 * are `@corpus/contract`'s `headingSections` and `renderHeadingPath`
 * (CONTRACT-070) — the same scan the server's chunker, its search addresses and
 * its thread context pack read. Until then this file **copied** them from
 * `apps/server/src/core/headings.ts`, which the CLI cannot import, and a test
 * here compared the two files' source text. What is left below is the CLI's own
 * part and only that: which sections are readable, how one is addressed to a
 * caller, and what happens when a `--section` names none or several.
 */

/** How many heading paths a failed `--section` lists before pointing at `--headings`. */
export const MAX_LISTED_PATHS = 40;

/** One stretch of a body under one heading, and the bytes it covers. */
export interface DocumentSection {
  /** The address `--section` accepts and `corpus search --json` emits. */
  readonly headingPath: string;
  /** `#` count of this section's own heading, or `0` for the text above the first. */
  readonly level: number;
  readonly start: number;
  readonly end: number;
  /** `body.slice(start, end)`, verbatim — the whole point of the flag. */
  readonly text: string;
}

/**
 * Every readable section of `body`, in document order.
 *
 * A section runs from the first character of **its own heading line** to the
 * character before the next heading that closes it, which is the server's
 * definition and the one the thread context pack's `section` field already
 * uses. Including the heading line is deliberate: it is what makes an otherwise
 * duplicated passage unique enough for `--old`, and it makes "replace this
 * section" a single patch.
 *
 * The text above the first heading is a section too, addressed by the
 * document's title. It is dropped when it is blank, which is the only section
 * that ever can be — every other one holds at least its heading line — because
 * a document opening with `# Title` would otherwise offer an empty section
 * whose address collides with that heading's.
 */
export function documentSections(body: string, title: string): readonly DocumentSection[] {
  // The scan's partition covers the body exactly, blank stretches included; a
  // *readable* section is one with something in it. The preamble is the only
  // section that can ever be blank — every other holds at least its own heading
  // line — and dropping it is what stops a document opening on `# Title` from
  // offering an empty section whose address collides with that heading's.
  return headingSections(body)
    .map((section) => ({
      headingPath: renderHeadingPath(section.headings, title),
      level: section.level,
      start: section.start,
      end: section.end,
      text: body.slice(section.start, section.end),
    }))
    .filter((section) => section.text.trim() !== "");
}

/**
 * The one section `--section` names, or a refusal — **never a fallback**.
 *
 * Printing the whole body when a path matches nothing would be the 175× cost
 * arriving silently, and silence is the one failure mode this verb exists to
 * remove. So both ways of not naming exactly one section throw, and each
 * message carries the recovery: the paths that do exist when nothing matched,
 * the `--nth` values when several did.
 */
export function selectSection(
  sections: readonly DocumentSection[],
  id: string,
  headingPath: string,
  nth: number | undefined,
): DocumentSection {
  const matches = sections.filter((section) => section.headingPath === headingPath);

  if (matches.length === 0) throw noSuchSection(sections, id, headingPath);
  if (nth === undefined) {
    if (matches.length > 1) throw ambiguousSection(matches, id, headingPath);
    // `matches.length === 1`, but the compiler cannot know it; the throw above
    // is the alternative to a non-null assertion, which the guidelines forbid.
    const [only] = matches;
    if (only === undefined) throw noSuchSection(sections, id, headingPath);
    return only;
  }

  const chosen = matches[nth - 1];
  if (chosen === undefined) throw nthOutOfRange(matches, id, headingPath, nth);
  return chosen;
}

/**
 * Nothing matched, and the message is the recovery.
 *
 * The paths are listed rather than described because listing them is what the
 * caller would spend its next command on, and `--headings` costs the same
 * request this one already made — an error that says "try `--headings`" and
 * nothing else charges a round trip for a list it was holding.
 */
function noSuchSection(
  sections: readonly DocumentSection[],
  id: string,
  headingPath: string,
): UsageError {
  const paths = sections.map((section) => section.headingPath);
  const listed = paths.slice(0, MAX_LISTED_PATHS);
  const overflow = paths.length - listed.length;

  return new UsageError(
    `--section "${headingPath}" names no section of ${id}, and nothing was printed.`,
    {
      hint:
        paths.length === 0
          ? `${id} has no readable sections — its body is empty. \`corpus doc show ${id}\` reads it whole.`
          : "Matching is exact, against the whole path. The separator is “ › ” (U+203A with a " +
            "space each side), and a `headingPath` from `corpus search --json` pastes in " +
            "unchanged. The sections this document does have:",
      // The machine reader's copy — `.error.details.headingPaths` is the same
      // list `--headings --json` would emit, so a `--json` caller recovers
      // without a second request either.
      details: { headingPath, matches: 0, headingPaths: paths },
      detailLines:
        paths.length === 0
          ? []
          : [
              ...listed.map((path) => `    ${path}`),
              ...(overflow > 0
                ? [`    … and ${String(overflow)} more — \`corpus doc show ${id} --headings\``]
                : []),
            ],
    },
  );
}

/**
 * Two sections with the same address, which a heading path cannot tell apart.
 *
 * It happens when a heading is literally repeated under the same parent — a
 * second top-level `## Notes`, or an `# Title` under a document whose title is
 * the same word, which collides with the preamble's title-derived address.
 * Choosing the first would be a silent wrong answer on the one verb whose
 * output is pasted into a write, so it is refused and `--nth` names which,
 * in document order. The alternative was a fresh path syntax with an index in
 * it, which would stop `search --json`'s output pasting in unchanged.
 */
function ambiguousSection(
  matches: readonly DocumentSection[],
  id: string,
  headingPath: string,
): UsageError {
  const count = matches.length;
  return new UsageError(
    `--section "${headingPath}" names ${String(count)} sections of ${id}, so nothing was printed.`,
    {
      hint:
        `A heading path repeats when its heading does. Choose one with --nth 1 … --nth ` +
        `${String(count)}, in document order:`,
      details: { headingPath, matches: count, ranges: matches.map(charRange) },
      detailLines: matches.map(
        (section, index) =>
          `    --nth ${String(index + 1)} · chars ${String(section.start)}–${String(section.end)} · ` +
          `${String(section.text.length)} characters`,
      ),
    },
  );
}

function nthOutOfRange(
  matches: readonly DocumentSection[],
  id: string,
  headingPath: string,
  nth: number,
): UsageError {
  const count = matches.length;
  return new UsageError(
    `--nth ${String(nth)} is out of range: "${headingPath}" names ${String(count)} ` +
      `${count === 1 ? "section" : "sections"} of ${id}, and nothing was printed.`,
    {
      hint: `Pass --nth between 1 and ${String(count)}, counted in document order.`,
      details: { headingPath, matches: count, nth },
      // Nothing for a person: the message and its hint already say the count
      // and the range, and the default rendering would dump those same two
      // numbers again as JSON (`patch.ts`'s precedent). `--json` is untouched.
      detailLines: [],
    },
  );
}

const charRange = (section: DocumentSection): { readonly start: number; readonly end: number } => ({
  start: section.start,
  end: section.end,
});
