/**
 * The weight levels a workspace declares, read from its own orchestrate skill
 * (SPEC.md §7 and §10, rider SHARED-022 signed 2026-08-06; AGENT-015).
 *
 * ## There is exactly one declaration, and it is not here
 *
 * SHARED-022's Decision 1: "the offered choices are **read from the skill's own
 * table**, not hardcoded into the UI. So editing the table changes both the
 * routing *and* the picker, and the two can never disagree — which a UI-side
 * enum would guarantee they eventually do."
 *
 * That is not a preference. §2.4 lets a workspace take template changes on its
 * own schedule and never overwrites an edited skill, so a workspace's table can
 * legitimately differ from the shipped one — indefinitely and on purpose. A list
 * in this file would therefore be wrong **per workspace**, in a way no single
 * release fixes, and the composer would be offering levels the router does not
 * implement. So this module holds a *parser* and no vocabulary at all: the
 * strings below are the table's **column headings**, never its rows.
 *
 * ## The declared shape
 *
 * The declaration is the tier table under `## Delegation` in the orchestrate
 * skill — the same table the dispatcher reads, with no fence around it and no
 * second representation, so nothing can disagree with the prose beside it:
 *
 * ```text
 * | Weight               | Key      | Model     | What falls here |
 * | -------------------- | -------- | --------- | --------------- |
 * | Small and mechanical | light    | **Haiku** | …               |
 * ```
 *
 * It is found by its **header cells** — {@link WEIGHT_TABLE_HEADER}, trimmed, in
 * order, spelled exactly — and never by a raw line: `assets/workspace/` is in
 * `.prettierignore`, so the column padding is hand-maintained and unstable while
 * the words are the interface.
 *
 * **A fenced example is not the declaration.** The reader skips anything inside
 * a code fence, using the contract's own {@link fencedCodeRanges} — the repo's
 * one fence scanner, shared rather than re-derived so "is this inside code" has
 * a single grammar. The block above this sentence is exactly the case: this
 * module's *documentation* of the format is a fenced table with the header
 * spelled right, and a reader that took the first header in document order would
 * read a workspace's worked example as its declaration the day a skill document
 * grew one. Nothing in the shipped skill fences its table today, and that is a
 * property of the current text rather than a guarantee.
 *
 * Every row beneath the divider is one level, **in document order, lightest
 * first**, which is the order a composer offers them in.
 *
 * ## Two of the four columns must never reach a composer
 *
 * A level carries a {@link WeightLevel.label} (the **Weight** cell — what a
 * person reads and picks by) and a {@link WeightLevel.key} (the **Key** cell —
 * the token that travels on the request's `weight` field). **Model** and **What
 * falls here** are the agent's, and "no model names in the UI" is a signed
 * non-goal, so they are dropped here rather than carried and filtered later: a
 * component cannot render a field its type does not have.
 *
 * Displaying the label and sending the key is the split that makes a rewording
 * safe — a choice made yesterday still resolves today, because the key survives
 * someone rewriting the sentence a person picked by.
 *
 * ## Fail clean, never fail partial
 *
 * Anything that is not exactly the shape above yields an **empty list**: no
 * header row spelled that way, no divider under it, a row with the wrong number
 * of cells, or a row whose Weight or Key cell is blank. An empty list means **no
 * control at all** — never a fallback list, which would be the second source
 * this design exists to remove, and never a partial one, which would offer some
 * of a table the reader has already failed to understand.
 *
 * That is a shipping state rather than an edge case: a workspace whose skill
 * predates AGENT-015 declares nothing, and its composer must behave exactly as
 * it does today.
 *
 * `readWeightLevels()` in `scripts/workspace-template.ts` is the repo's own
 * reader of the same declaration — the build's check that the template still
 * declares one. It is deliberately not imported here (repo tooling is not
 * shipped code); the two target the same shape, and this module's tests pin it
 * against the real template body.
 */

import { fencedCodeRanges, overlapsRange } from "@corpus/contract";

/** One level a workspace's guidance declares. */
export interface WeightLevel {
  /**
   * The **Weight** cell — the name a composer displays and a person picks by.
   * Rewording it in the skill reworders the composer, with no code change.
   */
  readonly label: string;
  /**
   * The **Key** cell — the token that rides on the request's `weight` field.
   * Stable across a relabelling, which is what keeps a standing choice
   * resolvable after the guidance is edited.
   */
  readonly key: string;
}

/**
 * The header cells that identify the declaration, in order and spelled exactly.
 *
 * Matching *cells* rather than the raw line is the whole point: the table's
 * padding is hand-maintained (the template tree is prettier-ignored) and so is
 * not stable, while the four words are the interface the skill states in prose.
 */
export const WEIGHT_TABLE_HEADER = ["Weight", "Key", "Model", "What falls here"] as const;

/** A markdown table row's trimmed cells, or `null` when the line is not one. */
function tableCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/** `---`, `:--`, `--:`, `:-:` — GFM's divider, in any alignment. */
function isDividerRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** The empty answer, shared so every failure path returns the same object. */
const NO_LEVELS: readonly WeightLevel[] = [];

/**
 * Enumerate the levels a skill body declares, lightest first.
 *
 * Returns an empty list for anything that is not exactly the declared shape —
 * see the module docblock for why that is the correct outcome rather than a
 * fault, and why there is no fallback.
 */
export function parseWeightLevels(markdown: string): readonly WeightLevel[] {
  const lines = markdown.split("\n");
  // Offsets, so a line can be asked whether it sits in a code fence. An
  // unterminated fence runs to the end of the text, which `fencedCodeRanges`
  // already models — a document that opens a fence and never closes it declares
  // nothing, rather than declaring whatever follows the fence.
  const fenced = fencedCodeRanges(markdown);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  for (const [index, line] of lines.entries()) {
    const start = starts[index] ?? 0;
    if (overlapsRange(fenced, start, start + line.length + 1)) continue;
    const header = tableCells(line);
    if (header === null) continue;
    if (header.length !== WEIGHT_TABLE_HEADER.length) continue;
    if (!header.every((cell, position) => cell === WEIGHT_TABLE_HEADER[position])) continue;

    const divider = tableCells(lines[index + 1] ?? "");
    // A header spelled right with no divider under it is not a table at all —
    // keep looking rather than reading the prose beneath it as rows.
    if (divider === null || !isDividerRow(divider)) continue;

    const levels: WeightLevel[] = [];
    for (const row of lines.slice(index + 2)) {
      const cells = tableCells(row);
      // The first line that is not a row ends the table, which is how a
      // paragraph after it stays a paragraph.
      if (cells === null) break;
      // A malformed row is not skipped: a reader that dropped it would offer
      // *some* of a table it has already failed to understand.
      if (cells.length !== WEIGHT_TABLE_HEADER.length) return NO_LEVELS;
      const [label = "", key = ""] = cells;
      if (label === "" || key === "") return NO_LEVELS;
      levels.push({ label, key });
    }
    return levels;
  }

  return NO_LEVELS;
}
