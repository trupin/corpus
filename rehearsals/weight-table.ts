/**
 * The rehearsal suite's reader of a workspace's tier table (INFRA-034).
 *
 * Several stories assert "the model the launch chose" against **the workspace's
 * own declaration**, never against a hardcoded model name — story 9 renames and
 * extends the table in its own fixture, and an assertion that remembered a name
 * would contradict it. So the scorers read the same declaration the product
 * reads: the table under the orchestrate skill's Delegation section, found by
 * its header cells (SHARED-022 Decision 1; SPEC.md §7).
 *
 * This is deliberately a third reader beside the two the product carries —
 * `parseWeightLevels` in `@corpus/kit` (the composer's, label + key only) and
 * `readWeightLevels` in `scripts/workspace-template.ts` (the build's) — because
 * the scorers also need the **Model** column, which the kit reader drops on
 * purpose ("no model names in the UI" is a signed non-goal). The unit test pins
 * this reader's label/key half against the kit's own parser on the shipped
 * template, so the three cannot quietly disagree about what a workspace
 * declares.
 */

import { fencedCodeRanges, overlapsRange } from "@corpus/contract";

/** One declared level, all three cells a scorer can assert on. */
export interface WeightTableRow {
  /** The **Weight** cell — what a composer displays and a person picks by. */
  readonly label: string;
  /** The **Key** cell — the token a stated weight travels as. */
  readonly key: string;
  /** The **Model** cell, `**` emphasis stripped — e.g. `Opus 5`, `Sonnet`. */
  readonly model: string;
}

/** The header cells that identify the declaration — the kit's, verbatim. */
export const WEIGHT_TABLE_HEADER = ["Weight", "Key", "Model", "What falls here"] as const;

function tableCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isDividerRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

const NO_ROWS: readonly WeightTableRow[] = [];

/**
 * The levels a skill body declares, in document order — lightest first, which
 * is what makes {@link strongestRow} "the last row". Empty on anything that is
 * not exactly the declared shape, for the kit parser's reasons: partial tables
 * are never offered, and a fenced example is not a declaration.
 */
export function readWeightTable(markdown: string): readonly WeightTableRow[] {
  const lines = markdown.split("\n");
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
    if (divider === null || !isDividerRow(divider)) continue;

    const rows: WeightTableRow[] = [];
    for (const row of lines.slice(index + 2)) {
      const cells = tableCells(row);
      if (cells === null) break;
      if (cells.length !== WEIGHT_TABLE_HEADER.length) return NO_ROWS;
      const [label = "", key = "", model = ""] = cells;
      if (label === "" || key === "") return NO_ROWS;
      rows.push({ label, key, model: model.replaceAll("*", "").trim() });
    }
    return rows;
  }

  return NO_ROWS;
}

/**
 * The strongest declared level — the table's last row, because the table is
 * written lightest first. No launch rule reads this any more (AGENT-063 made
 * the weightless launch a judgment); it remains for scorers and fixtures that
 * reason about the table's ends. `null` for a table that declares nothing.
 */
export function strongestRow(rows: readonly WeightTableRow[]): WeightTableRow | null {
  return rows.length === 0 ? null : (rows[rows.length - 1] ?? null);
}

/** The row a stated key resolves to, or `null` — the unhonourable case. */
/**
 * A row that is deliberately **not** the strongest, for a story that must tell
 * "honoured" apart from "the launcher's own judgment picked it" (pr-reviewer,
 * PR #71; AGENT-063). The weightless judgment leans to the stronger end, so
 * seeding the strongest key often makes the two coincide, and then the turn's
 * recorded model proves little — only the log's provenance word does. Returns
 * `null` where the table declares a single level, which is a workspace this
 * story cannot test.
 */
export function nonStrongestRow(rows: readonly WeightTableRow[]): WeightTableRow | null {
  if (rows.length < 2) return null;
  // Lightest first, so anything but the last row is weaker than the default.
  return rows[0] ?? null;
}

export function rowForKey(rows: readonly WeightTableRow[], key: string): WeightTableRow | null {
  return rows.find((row) => row.key === key) ?? null;
}

/**
 * The family token a Model cell reduces to — `Opus 5` → `opus` — which is both
 * the spelling the Task tool takes (the skill's own rule) and a substring of
 * any concrete model id a turn records (`claude-opus-4-1`). Matching on the
 * family is what keeps an assertion valid when a fixture renames its tiers:
 * the cell is read from the workspace's table at seed time, never remembered.
 */
export function modelFamilyOf(modelCell: string): string {
  const cleaned = modelCell.replaceAll("*", "").trim();
  return (cleaned.split(/\s+/)[0] ?? "").toLowerCase();
}

/**
 * Whether a recorded turn model (SPEC.md §10 — what actually ran, verbatim)
 * names the family a Model cell picks. A `null` recorded model never matches:
 * a turn nobody recorded a model for cannot evidence any launch choice.
 */
export function recordedModelMatches(modelCell: string, recorded: string | null): boolean {
  if (recorded === null) return false;
  const family = modelFamilyOf(modelCell);
  return family !== "" && recorded.toLowerCase().includes(family);
}
