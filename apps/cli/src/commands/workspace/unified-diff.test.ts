import { describe, expect, it } from "vitest";
import { DIFF_CONTEXT_LINES, splitLines, unifiedDiff } from "./unified-diff.js";

/**
 * The diff is the payload of `corpus workspace diff`, and its reader is an agent
 * deciding how to merge a skill. So what is asserted here is the part a reader
 * acts on: the `@@` line numbers, which side each prefix belongs to, and the
 * cases where "no difference" and "difference not shown" would look the same.
 *
 * The output is checked against the real unified-diff format rather than against
 * whatever this implementation happens to produce — the numbers below are what
 * `git diff --unified=3` prints for the same inputs.
 */

const LABELS = { from: "workspace/x.md", to: "tool/x.md" } as const;

/** The diff body without its `---`/`+++` header, as lines. */
function hunks(from: string, to: string, context?: number): readonly string[] {
  const text = unifiedDiff(from, to, LABELS, context).text;
  return text.replace(/\n$/, "").split("\n").slice(2);
}

function lines(...items: readonly string[]): string {
  return `${items.join("\n")}\n`;
}

describe("unifiedDiff", () => {
  it("says nothing at all when the two sides are byte-identical", () => {
    const same = lines("alpha", "beta");
    expect(unifiedDiff(same, same, LABELS)).toEqual({
      text: "",
      added: 0,
      removed: 0,
      coarse: false,
    });
  });

  it("labels the two sides in the header, in the order the prefixes follow", () => {
    const text = unifiedDiff(lines("alpha"), lines("beta"), LABELS).text;
    expect(text.split("\n").slice(0, 2)).toEqual(["--- workspace/x.md", "+++ tool/x.md"]);
    expect(text).toContain("-alpha");
    expect(text).toContain("+beta");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("numbers a hunk the way git does, with context on both sides", () => {
    const from = lines("1", "2", "3", "4", "5", "here", "7", "8", "9", "10");
    const to = lines("1", "2", "3", "4", "5", "there", "7", "8", "9", "10");

    expect(hunks(from, to)).toEqual([
      "@@ -3,7 +3,7 @@",
      " 3",
      " 4",
      " 5",
      "-here",
      "+there",
      " 7",
      " 8",
      " 9",
    ]);
    expect(unifiedDiff(from, to, LABELS)).toMatchObject({ added: 1, removed: 1, coarse: false });
  });

  it("clamps the context at the start and end of the file", () => {
    const from = lines("one", "two");
    const to = lines("ONE", "two");
    expect(hunks(from, to)).toEqual(["@@ -1,2 +1,2 @@", "-one", "+ONE", " two"]);
  });

  it("splits distant changes into separate hunks and merges near ones", () => {
    const before = Array.from({ length: 20 }, (_unused, index) => `line ${String(index)}`);
    const far = [...before];
    far[0] = "changed head";
    far[19] = "changed tail";

    const separate = hunks(lines(...before), lines(...far));
    expect(separate.filter((line) => line.startsWith("@@"))).toEqual([
      "@@ -1,4 +1,4 @@",
      "@@ -17,4 +17,4 @@",
    ]);

    const near = [...before];
    near[8] = "changed";
    near[12] = "also changed";
    expect(hunks(lines(...before), lines(...near)).filter((line) => line.startsWith("@@"))).toEqual(
      ["@@ -6,11 +6,11 @@"],
    );
  });

  it("shows a whole file as added when one side is empty", () => {
    const result = unifiedDiff("", lines("alpha", "beta"), LABELS);
    expect(result.text.split("\n").slice(2, -1)).toEqual(["@@ -0,0 +1,2 @@", "+alpha", "+beta"]);
    expect(result).toMatchObject({ added: 2, removed: 0 });
  });

  it("shows a whole file as removed when the other side is empty", () => {
    const result = unifiedDiff(lines("alpha"), "", LABELS);
    expect(result.text.split("\n").slice(2, -1)).toEqual(["@@ -1,1 +0,0 @@", "-alpha"]);
    expect(result).toMatchObject({ added: 0, removed: 1 });
  });

  it("marks a missing trailing newline, on whichever side lacks it", () => {
    expect(hunks("alpha\nbeta", "alpha\ngamma")).toEqual([
      "@@ -1,2 +1,2 @@",
      " alpha",
      "-beta",
      "\\ No newline at end of file",
      "+gamma",
      "\\ No newline at end of file",
    ]);
  });

  it("never reports two differing files as identical, even when only the last newline differs", () => {
    // Two files whose lines are equal but whose bytes are not. Reporting nothing
    // here would be the one unrecoverable answer: a sha that says "conflict" and
    // a diff that says "no difference".
    const result = unifiedDiff("alpha\n", "alpha", LABELS);
    expect(result.text).not.toBe("");
    expect(result.text.split("\n").slice(2, -1)).toEqual([
      "@@ -1,1 +1,1 @@",
      "-alpha",
      "+alpha",
      "\\ No newline at end of file",
    ]);
  });

  it("honours a wider context window", () => {
    const from = lines("1", "2", "3", "4", "5", "6", "7");
    const to = lines("1", "2", "3", "X", "5", "6", "7");
    expect(hunks(from, to, 1)).toEqual(["@@ -3,3 +3,3 @@", " 3", "-4", "+X", " 5"]);
    expect(hunks(from, to, DIFF_CONTEXT_LINES)).toEqual([
      "@@ -1,7 +1,7 @@",
      " 1",
      " 2",
      " 3",
      "-4",
      "+X",
      " 5",
      " 6",
      " 7",
    ]);
  });

  it("keeps a rewritten block together rather than interleaving it", () => {
    const from = lines("keep", "old one", "old two", "keep too");
    const to = lines("keep", "new one", "new two", "keep too");
    expect(hunks(from, to)).toEqual([
      "@@ -1,4 +1,4 @@",
      " keep",
      "-old one",
      "-old two",
      "+new one",
      "+new two",
      " keep too",
    ]);
  });

  it("falls back to a whole-file replacement past the compare budget, and says so", () => {
    // Far past `MAX_COMPARE_CELLS`, so the quadratic compare is never attempted:
    // the answer is still complete, only its pairing is coarse.
    const from = lines(...Array.from({ length: 4000 }, (_u, index) => `a ${String(index)}`));
    const to = lines(...Array.from({ length: 4000 }, (_u, index) => `b ${String(index)}`));

    const result = unifiedDiff(from, to, LABELS);
    expect(result.coarse).toBe(true);
    expect(result.added).toBe(4000);
    expect(result.removed).toBe(4000);
    expect(result.text).toContain("-a 0");
    expect(result.text).toContain("+b 3999");
  });

  it("stays exact for files that are large but similar", () => {
    const before = Array.from({ length: 4000 }, (_u, index) => `line ${String(index)}`);
    const after = [...before];
    after[2000] = "one changed line";

    const result = unifiedDiff(lines(...before), lines(...after), LABELS);
    // The shared head and tail are stripped before the quadratic part, so a
    // one-line edit in a 4000-line file is one small hunk, not a rewrite.
    expect(result).toMatchObject({ added: 1, removed: 1, coarse: false });
    expect(result.text.split("\n").filter((line) => line.startsWith("@@"))).toEqual([
      "@@ -1998,7 +1998,7 @@",
    ]);
  });
});

describe("splitLines", () => {
  it("has no lines at all for an empty file", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("keeps the terminator on every line that has one", () => {
    expect(splitLines("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
    expect(splitLines("\n")).toEqual(["\n"]);
  });
});
