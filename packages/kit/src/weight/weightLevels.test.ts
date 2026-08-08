import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWeightLevels, WEIGHT_TABLE_HEADER } from "./weightLevels.js";

/**
 * The parser, against the declared shape and against everything that is not it.
 *
 * The suite is written the way the feature is argued: the levels are **never**
 * spelled as an expectation of what a workspace declares, only as an expectation
 * of what a *given* declaration parses to. The one test that names the shipped
 * labels reads them out of the shipped file, so renaming a level in the template
 * moves the assertion with it — which is the whole claim ("editing the table
 * changes what the composer offers, with no code change") under test rather than
 * asserted in prose.
 */

const SHIPPED_SKILL = fileURLToPath(
  new URL("../../../../assets/workspace/claude/skills/orchestrate/SKILL.md", import.meta.url),
);

/** A declaration in the shape AGENT-015 produces, with the padding varied. */
const DECLARED = [
  "Prose above it.",
  "",
  "| Weight | Key | Model | What falls here |",
  "| --- | --- | --- | --- |",
  "| Small and mechanical | light | **Haiku** | The request prescribes the change exactly. |",
  "| Standard   | standard | **Sonnet** | Most comment work. |",
  "| Heavy or judgment-laden | heavy | **Opus 5** | Cross-document restructuring. |",
  "",
  "Prose below it.",
].join("\n");

describe("the declaration's shape", () => {
  it("is found by its four header cells, in order and spelled exactly", () => {
    expect([...WEIGHT_TABLE_HEADER]).toEqual(["Weight", "Key", "Model", "What falls here"]);
  });

  it("reads every row below the divider, in document order — lightest first", () => {
    expect(parseWeightLevels(DECLARED)).toEqual([
      { label: "Small and mechanical", key: "light" },
      { label: "Standard", key: "standard" },
      { label: "Heavy or judgment-laden", key: "heavy" },
    ]);
  });

  it("carries the Weight cell and the Key cell, and nothing else", () => {
    // "No model names in the UI" is a signed non-goal, kept by the type: a level
    // has no field a component could render a model out of.
    for (const level of parseWeightLevels(DECLARED)) {
      expect(Object.keys(level).sort()).toEqual(["key", "label"]);
    }
    expect(JSON.stringify(parseWeightLevels(DECLARED))).not.toContain("Haiku");
    expect(JSON.stringify(parseWeightLevels(DECLARED))).not.toContain("Opus");
  });

  it("does not depend on the column padding, which is hand-maintained", () => {
    const padded = DECLARED.replace(
      "| Weight | Key | Model | What falls here |",
      "|   Weight    |  Key   |    Model     |   What falls here    |",
    );
    expect(parseWeightLevels(padded)).toEqual(parseWeightLevels(DECLARED));
  });

  it("accepts any alignment on the divider row", () => {
    const aligned = DECLARED.replace("| --- | --- | --- | --- |", "| :--- | :---: | ---: | --- |");
    expect(parseWeightLevels(aligned)).toHaveLength(3);
  });

  it("ends the table at the first line that is not a row", () => {
    expect(parseWeightLevels(DECLARED).map((level) => level.key)).not.toContain("Prose below it.");
  });
});

/**
 * The claim the whole design exists to make true: the offered set follows the
 * document, with no code change anywhere.
 */
describe("editing the table", () => {
  it("renames a level by renaming its Weight cell — the Key is untouched", () => {
    const renamed = DECLARED.replace("Standard   ", "Ordinary   ");
    expect(parseWeightLevels(renamed)).toEqual([
      { label: "Small and mechanical", key: "light" },
      { label: "Ordinary", key: "standard" },
      { label: "Heavy or judgment-laden", key: "heavy" },
    ]);
  });

  it("adds a fourth level by adding a fourth row", () => {
    const four = DECLARED.replace(
      "\n\nProse below it.",
      "\n| Exhaustive | exhaustive | **Opus 5** | Whole-corpus work. |\n\nProse below it.",
    );
    expect(parseWeightLevels(four).map((level) => level.key)).toEqual([
      "light",
      "standard",
      "heavy",
      "exhaustive",
    ]);
  });

  it("removes a level by removing its row", () => {
    const two = DECLARED.split("\n")
      .filter((line) => !line.startsWith("| Small and mechanical"))
      .join("\n");
    expect(parseWeightLevels(two).map((level) => level.key)).toEqual(["standard", "heavy"]);
  });
});

/**
 * Fail clean, never partial and never a fallback. Every case here is a workspace
 * whose composer must offer **no control at all** and behave exactly as it did
 * before this feature existed — including, per §2.4, a workspace whose skill
 * simply predates the declaration.
 */
describe("anything that is not the declared shape", () => {
  it("finds nothing in a skill that predates the declaration", () => {
    expect(parseWeightLevels("## Delegation\n\nDispatch through the Task tool.\n")).toEqual([]);
  });

  it("finds nothing in an empty body", () => {
    expect(parseWeightLevels("")).toEqual([]);
  });

  it.each([
    ["a header cell spelled differently", "| Weight | Key | Model | What falls |"],
    ["a header cell renamed", "| Tier | Key | Model | What falls here |"],
    ["the wrong case", "| weight | key | model | what falls here |"],
    ["the columns reordered", "| Key | Weight | Model | What falls here |"],
    ["a fifth column", "| Weight | Key | Model | What falls here | Why |"],
  ])("finds nothing when the header has %s", (_case, header) => {
    expect(parseWeightLevels(DECLARED.replace(DECLARED.split("\n")[2] ?? "", header))).toEqual([]);
  });

  it("finds nothing when no divider row follows the header", () => {
    expect(parseWeightLevels(DECLARED.replace("| --- | --- | --- | --- |\n", ""))).toEqual([]);
  });

  it("finds nothing at all when one row has the wrong number of cells", () => {
    const broken = DECLARED.replace("| Standard   | standard |", "| Standard   |");
    // Not two levels and the third dropped: a reader that returned a partial set
    // would offer some of a table it has already failed to understand.
    expect(parseWeightLevels(broken)).toEqual([]);
  });

  it.each([
    ["Weight", "|  | standard | **Sonnet** | Most comment work. |"],
    ["Key", "| Standard |  | **Sonnet** | Most comment work. |"],
  ])("finds nothing at all when a row's %s cell is blank", (_cell, row) => {
    const broken = DECLARED.replace(
      "| Standard   | standard | **Sonnet** | Most comment work. |",
      row,
    );
    expect(parseWeightLevels(broken)).toEqual([]);
  });

  it("ignores an unrelated four-column table", () => {
    const other = ["| A | B | C | D |", "| --- | --- | --- | --- |", "| 1 | 2 | 3 | 4 |"].join(
      "\n",
    );
    expect(parseWeightLevels(other)).toEqual([]);
  });

  it("keeps looking past a header with no divider under it", () => {
    const decoy = [
      "| Weight | Key | Model | What falls here |",
      "not a divider",
      "",
      DECLARED,
    ].join("\n");
    expect(parseWeightLevels(decoy)).toHaveLength(3);
  });
});

/**
 * The one place the shipped vocabulary is named, and it is read rather than
 * written: this is what would go red if AGENT-015's table and this parser drifted
 * apart — a level the composer would then have offered and the router would not
 * have implemented.
 */
describe("the shipped orchestrate skill", () => {
  const body = readFileSync(SHIPPED_SKILL, "utf8");

  it("declares a parseable set", () => {
    expect(parseWeightLevels(body).length).toBeGreaterThan(0);
  });

  it("declares exactly the rows its own table holds, lightest first", () => {
    /*
     * The table located independently of the parser under test — by the header's
     * text and the divider under it — so this compares two readings of the file
     * rather than the parser with itself.
     */
    const lines = body.split("\n");
    const header = lines.findIndex(
      (line, index) =>
        WEIGHT_TABLE_HEADER.every((cell) => line.includes(`| ${cell} `)) &&
        /^\s*\|[\s:|-]+\|\s*$/u.test(lines[index + 1] ?? ""),
    );
    expect(header).toBeGreaterThan(-1);

    const rows: string[][] = [];
    for (const line of lines.slice(header + 2)) {
      if (!line.trim().startsWith("|")) break;
      rows.push(
        line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim()),
      );
    }
    expect(rows.length).toBeGreaterThan(0);
    expect(parseWeightLevels(body)).toEqual(rows.map(([label, key]) => ({ label, key })));
  });

  it("declares no level whose key is not one lowercase word", () => {
    for (const level of parseWeightLevels(body)) expect(level.key).toMatch(/^[a-z]+$/u);
  });
});
