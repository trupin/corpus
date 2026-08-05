import { describe, expect, it } from "vitest";
import { DOC_DIFF_MAX_CHARS } from "@corpus/contract";
import { parseShortstat, truncateDiff } from "./diff.js";

describe("parseShortstat", () => {
  it("reads both counts from git's line", () => {
    expect(parseShortstat(" 1 file changed, 5 insertions(+), 2 deletions(-)\n")).toEqual({
      insertions: 5,
      deletions: 2,
    });
  });

  it("reads the singular forms git prints for one line", () => {
    expect(parseShortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)\n")).toEqual({
      insertions: 1,
      deletions: 1,
    });
  });

  it("treats an absent half as zero — git omits the clause entirely", () => {
    expect(parseShortstat(" 1 file changed, 7 insertions(+)\n")).toEqual({
      insertions: 7,
      deletions: 0,
    });
    expect(parseShortstat(" 1 file changed, 3 deletions(-)\n")).toEqual({
      insertions: 0,
      deletions: 3,
    });
  });

  it("reports zero for a range that changed nothing, where git prints no line at all", () => {
    expect(parseShortstat("")).toEqual({ insertions: 0, deletions: 0 });
  });

  it("never reports the file count as a change count", () => {
    // ` 12 files changed` leads the line; a naive first-number parse would read
    // 12 insertions. `DocChangeStats` publishes no `files` because, path-scoped,
    // it is always 1 — so the leading count must not leak into either number.
    expect(parseShortstat(" 12 files changed, 1 insertion(+)\n")).toEqual({
      insertions: 1,
      deletions: 0,
    });
  });
});

/** A unified diff with `hunks` hunks of `linesPerHunk` context lines each. */
function diffWith(hunks: number, linesPerHunk: number): string {
  const parts = [
    "diff --git a/data/docs/n.md b/data/docs/n.md",
    "--- a/data/docs/n.md",
    "+++ b/data/docs/n.md",
  ];
  for (let hunk = 0; hunk < hunks; hunk += 1) {
    parts.push(`@@ -${String(hunk * 10 + 1)},3 +${String(hunk * 10 + 1)},4 @@`);
    for (let line = 0; line < linesPerHunk; line += 1)
      parts.push(`+hunk ${String(hunk)} line ${String(line)}`);
  }
  return `${parts.join("\n")}\n`;
}

describe("truncateDiff", () => {
  it("leaves a diff inside the bound alone", () => {
    const text = diffWith(2, 3);
    expect(truncateDiff(text, DOC_DIFF_MAX_CHARS)).toEqual({
      diff: text,
      truncated: false,
      totalChars: text.length,
    });
  });

  it("reports the bound exactly, not one under it", () => {
    const text = "x".repeat(50);
    expect(truncateDiff(text, 50).truncated).toBe(false);
    expect(truncateDiff(text, 49).truncated).toBe(true);
  });

  it("drops whole hunks from the end, so the answer is still a valid diff", () => {
    const text = diffWith(4, 4);
    const bounded = truncateDiff(text, Math.floor(text.length / 2));

    expect(bounded.truncated).toBe(true);
    expect(bounded.totalChars).toBe(text.length);
    expect(bounded.diff.length).toBeLessThanOrEqual(Math.floor(text.length / 2));
    // The preamble survives and the cut lands *between* hunks: what comes back
    // ends with a complete hunk, never half of one.
    expect(bounded.diff.startsWith("diff --git a/data/docs/n.md")).toBe(true);
    expect(bounded.diff.endsWith("\n")).toBe(true);
    expect(text.startsWith(bounded.diff)).toBe(true);
    const kept = [...bounded.diff.matchAll(/^@@/gm)].length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(4);
    // Every line of the last kept hunk is present: the character after the cut
    // begins a hunk header.
    expect(text.slice(bounded.diff.length).startsWith("@@")).toBe(true);
  });

  it("cuts a single over-sized hunk at a line boundary — the contract's one exception", () => {
    const text = diffWith(1, 400);
    const bounded = truncateDiff(text, 500);

    expect(bounded.truncated).toBe(true);
    expect(bounded.diff.length).toBeLessThanOrEqual(500);
    expect(bounded.diff.endsWith("\n")).toBe(true);
    // Never mid-line: every line that survived is a whole line of the original.
    for (const line of bounded.diff.split("\n").filter((entry) => entry !== "")) {
      expect(text).toContain(`${line}\n`);
    }
  });

  it("falls back to a hard cut when there is no line boundary at all", () => {
    const text = "@".repeat(200);
    const bounded = truncateDiff(text, 50);
    expect(bounded).toEqual({ diff: "@".repeat(50), truncated: true, totalChars: 200 });
  });

  it("never cuts at the *first* hunk header, which would answer with no change at all", () => {
    // A brand-new file arrives from git as one enormous hunk behind a five-line
    // preamble. Cutting at that hunk's header is arithmetically hunk-aligned and
    // returns 166 characters of file headers where 16000 were allowed —
    // measured on a real server, and the reason this rule exists.
    const preamble = [
      "diff --git a/n.md b/n.md",
      "new file mode 100644",
      "index 0000000..1905e09",
      "--- /dev/null",
      "+++ b/n.md",
    ].join("\n");
    const text = `${preamble}\n@@ -0,0 +1,400 @@\n${"+a long paragraph of prose\n".repeat(400)}`;

    const bounded = truncateDiff(text, 4000);
    expect(bounded.truncated).toBe(true);
    expect(bounded.diff.length).toBeGreaterThan(3000);
    expect(bounded.diff.length).toBeLessThanOrEqual(4000);
    expect(bounded.diff).toContain("@@ -0,0 +1,400 @@\n+a long paragraph of prose\n");
    expect(bounded.diff.endsWith("\n")).toBe(true);
  });

  it("treats a document line that starts with @@ as content, not as a hunk header", () => {
    // In a unified diff every content line carries a ` `, `+` or `-` prefix, so
    // a markdown line reading `@@ careful @@` arrives as `+@@ careful @@`.
    const first = ["diff --git a/n.md b/n.md", "@@ -1,2 +1,3 @@", "+@@ careful @@", "+tail"].join(
      "\n",
    );
    const second = ["@@ -20,1 +21,2 @@", "+second hunk", "+more"].join("\n");
    const text = `${first}\n${second}\n`;

    const bounded = truncateDiff(text, text.length - 5);
    expect(bounded.truncated).toBe(true);
    // The cut lands at the *real* second hunk header, not at the content line
    // that merely looks like one.
    expect(bounded.diff).toBe(`${first}\n`);
    expect(bounded.diff).toContain("+@@ careful @@");
  });
});
