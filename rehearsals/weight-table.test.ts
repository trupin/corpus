import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWeightLevels } from "@corpus/kit";
import { describe, expect, it } from "vitest";
import {
  modelFamilyOf,
  readWeightTable,
  recordedModelMatches,
  rowForKey,
  strongestRow,
} from "./weight-table.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const SHIPPED_SKILL = readFileSync(
  join(REPO_ROOT, "assets", "workspace", "claude", "skills", "orchestrate", "SKILL.md"),
  "utf8",
);

describe("readWeightTable on the shipped skill", () => {
  const rows = readWeightTable(SHIPPED_SKILL);

  it("finds the three shipped tiers, lightest first", () => {
    expect(rows.map((row) => row.key)).toEqual(["light", "standard", "heavy"]);
    expect(rows.map((row) => row.model)).toEqual(["Haiku", "Sonnet", "Opus 5"]);
  });

  it("agrees with the kit's own parser on label and key", () => {
    // The suite's reader must not drift from the composer's. It reads one more
    // column (Model); the label/key half is the kit's, cell for cell.
    const kit = parseWeightLevels(SHIPPED_SKILL);
    expect(rows.map((row) => ({ label: row.label, key: row.key }))).toEqual(
      kit.map((level) => ({ label: level.label, key: level.key })),
    );
  });

  it("names the strongest tier as the last row", () => {
    expect(strongestRow(rows)?.key).toBe("heavy");
    expect(strongestRow(rows)?.model).toBe("Opus 5");
  });
});

describe("readWeightTable shape rules", () => {
  const header = "| Weight | Key | Model | What falls here |\n| --- | --- | --- | --- |\n";

  it("reads a minimal one-row table", () => {
    const rows = readWeightTable(`${header}| Light | light | **Haiku** | tiny |\n`);
    expect(rows).toEqual([{ label: "Light", key: "light", model: "Haiku" }]);
  });

  it("returns nothing for a table with no rows", () => {
    expect(readWeightTable(header)).toEqual([]);
  });

  it("returns nothing when a row is malformed rather than offering a partial table", () => {
    const rows = readWeightTable(`${header}| only three | cells | here |\n`);
    expect(rows).toEqual([]);
  });

  it("ignores a fenced example table", () => {
    const fenced =
      "```\n| Weight | Key | Model | What falls here |\n| - | - | - | - |\n| X | x | **Y** | z |\n```\n";
    expect(readWeightTable(fenced)).toEqual([]);
  });

  it("follows a renamed label and an added heaviest row", () => {
    const table =
      `${header}` +
      "| Featherweight | light | **Haiku** | tiny |\n" +
      "| Standard | standard | **Sonnet** | most |\n" +
      "| Deliberative | deliberative | **Opus 5** | deep |\n";
    const rows = readWeightTable(table);
    expect(rows.map((row) => row.label)).toEqual(["Featherweight", "Standard", "Deliberative"]);
    expect(strongestRow(rows)?.key).toBe("deliberative");
    expect(rowForKey(rows, "deliberative")?.model).toBe("Opus 5");
  });
});

describe("model family matching", () => {
  it("reduces a Model cell to the family token the Task tool takes", () => {
    expect(modelFamilyOf("Opus 5")).toBe("opus");
    expect(modelFamilyOf("**Sonnet**")).toBe("sonnet");
    expect(modelFamilyOf("Haiku")).toBe("haiku");
  });

  it("matches a recorded turn model by family, never a null one", () => {
    expect(recordedModelMatches("Opus 5", "claude-opus-4-1")).toBe(true);
    expect(recordedModelMatches("Sonnet", "claude-sonnet-4-5")).toBe(true);
    expect(recordedModelMatches("Opus 5", "claude-sonnet-4-5")).toBe(false);
    expect(recordedModelMatches("Opus 5", null)).toBe(false);
  });
});
