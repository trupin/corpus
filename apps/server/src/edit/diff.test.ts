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

  it("keeps whole hunks while they fit, then cuts inside the one that straddles the bound", () => {
    const text = diffWith(4, 4);
    const max = Math.floor(text.length / 2);
    const bounded = truncateDiff(text, max);

    expect(bounded.truncated).toBe(true);
    expect(bounded.totalChars).toBe(text.length);
    expect(bounded.diff.length).toBeLessThanOrEqual(max);
    // A prefix of git's own output, ending on a line boundary: readable.
    expect(text.startsWith(bounded.diff)).toBe(true);
    expect(bounded.diff.startsWith("diff --git a/data/docs/n.md")).toBe(true);
    expect(bounded.diff.endsWith("\n")).toBe(true);
    // Every hunk before the straddling one is complete, and the straddling one
    // is present rather than dropped — which is what spends the budget.
    expect([...bounded.diff.matchAll(/^@@/gm)].length).toBeGreaterThan(0);
    // The budget is spent to within one line of the bound.
    const nextNewline = text.indexOf("\n", bounded.diff.length);
    expect(nextNewline).toBeGreaterThan(max - 1);
  });

  it("cuts a single over-sized hunk at a line boundary", () => {
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

  it("returns nothing rather than a mid-line prefix when no line boundary fits", () => {
    // SERVER-149. SPEC.md §9.2's rider of 2026-08-05 is unconditional — "The cut
    // is never mid-line, and never mid hunk-header: a truncated diff is always
    // something a reader can read" — and this function used to keep an escape
    // from it, cutting at `max` when `lastIndexOf` found no newline. The route
    // cannot produce such an input (git's own `diff --git` header carries a
    // newline at index 90), so this is the direct cover the case has.
    const text = "@".repeat(200);
    const bounded = truncateDiff(text, 50);

    expect(bounded).toEqual({ diff: "", truncated: true, totalChars: 200 });
    // Nothing mid-line came back, and nothing can read the empty answer as a
    // complete one: `truncated` says it was cut and `totalChars` says by how much.
    expect(bounded.diff).not.toBe(text.slice(0, 50));
    expect(bounded.truncated).toBe(true);
    expect(bounded.totalChars).toBe(text.length);
  });

  it("keeps only whole lines when the first boundary sits past the bound", () => {
    // The same rule one step less extreme: a boundary exists, but not at or
    // before the bound, so it is no more available than none at all.
    const text = `${"@".repeat(200)}\n${"x".repeat(10)}\n`;
    const bounded = truncateDiff(text, 100);

    expect(bounded.diff).toBe("");
    expect(bounded.truncated).toBe(true);
    expect(bounded.totalChars).toBe(text.length);

    // One character past that boundary and the whole first line comes back whole.
    const wider = truncateDiff(text, 201);
    expect(wider.diff).toBe(`${"@".repeat(200)}\n`);
    expect(wider.truncated).toBe(true);
  });

  it("never returns more characters than the bound, even at zero", () => {
    // A leading newline is the one shape that could overrun a zero bound, since
    // `lastIndexOf` clamps a negative search start to index 0.
    const bounded = truncateDiff("\nleading newline\n", 0);
    expect(bounded).toEqual({ diff: "", truncated: true, totalChars: 17 });
  });

  it("never answers with the preamble alone when a large hunk follows it", () => {
    // A brand-new file arrives from git as one enormous hunk behind a five-line
    // preamble. Cutting at that hunk's header is arithmetically hunk-aligned and
    // returns 166 characters of file headers where 16000 were allowed —
    // measured on a real server, and one of the two shapes CONTRACT-032 closes.
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

  it("cuts inside an over-sized hunk rather than keeping only the frontmatter before it", () => {
    // The reported shape (SERVER-058), and the *ordinary* one: a save re-stamps
    // `updated:`, so git emits a tiny frontmatter hunk and then one body hunk
    // carrying the whole change. Measured on a real server before this rule
    // existed: 401 characters of an allowed 16 000 — the timestamp, and none of
    // the change it belongs to.
    const preamble = [
      "diff --git a/data/docs/n.md b/data/docs/n.md",
      "index 1905e09..d0b3a1c 100644",
      "--- a/data/docs/n.md",
      "+++ b/data/docs/n.md",
    ].join("\n");
    const frontmatter = [
      "@@ -3,7 +3,7 @@ id: doc_a1b2c3",
      "-updated: 2026-08-01T09:00:00Z",
      "+updated: 2026-08-04T11:20:00Z",
    ].join("\n");
    const bodyHeader = "@@ -20,3 +20,900 @@";
    const body = `+a rewritten paragraph of prose\n`.repeat(3000);
    const text = `${preamble}\n${frontmatter}\n${bodyHeader}\n${body}`;
    const bodyHunkStart = text.indexOf(bodyHeader);

    const bounded = truncateDiff(text, DOC_DIFF_MAX_CHARS);

    expect(bounded.truncated).toBe(true);
    expect(bounded.totalChars).toBe(text.length);
    // The whole point: the budget is spent, not abandoned at the one early
    // boundary. Under the old rule this was `bodyHunkStart` — 401 characters.
    expect(bodyHunkStart).toBeLessThan(500);
    expect(bounded.diff.length).toBeGreaterThan(DOC_DIFF_MAX_CHARS - 100);
    expect(bounded.diff.length).toBeLessThanOrEqual(DOC_DIFF_MAX_CHARS);
    // The reported failure shape is impossible: the answer carries body change,
    // not a timestamp on its own.
    expect(bounded.diff).toContain("+updated: 2026-08-04T11:20:00Z");
    expect(bounded.diff).toContain(bodyHeader);
    expect(bounded.diff).toContain("+a rewritten paragraph of prose");
    // Still a diff a reader can parse: a prefix of git's own output, every line
    // whole, ending on a line boundary.
    expect(text.startsWith(bounded.diff)).toBe(true);
    expect(bounded.diff.endsWith("\n")).toBe(true);
    for (const line of bounded.diff.split("\n").filter((entry) => entry !== "")) {
      expect(text).toContain(`${line}\n`);
    }
  });

  it("closes the notch: a body hunk just under the bound is no longer dropped whole", () => {
    // CONTRACT-032. This input used to answer with the preamble and nothing
    // else, because the body hunk fitted the bound but not the budget left
    // where it sat — a body hunk within `preamble.length` characters of the cap.
    // Measured on the real route at 401 of 16 000, and at 231 of 16 000 for a
    // diff totalling 21 001. SPEC.md §9.2's rule spends the budget instead.
    const max = 16_000;
    const preamble = [
      "diff --git a/data/docs/n.md b/data/docs/n.md",
      "index 1905e09..d0b3a1c 100644",
      "--- a/data/docs/n.md",
      "+++ b/data/docs/n.md",
      "@@ -3,7 +3,7 @@ id: doc_a1b2c3",
      "-updated: 2026-08-01T09:00:00Z",
      "+updated: 2026-08-04T11:20:00Z",
      "",
    ].join("\n");
    const bodyHeader = "@@ -20,3 +20,300 @@";
    const line = `+a rewritten paragraph of prose that is fifty-nine\n`;
    const body = (chars: number): string =>
      `${bodyHeader}\n${line.repeat(Math.floor((chars - bodyHeader.length - 1) / line.length))}`;
    // Sized so the body hunk is inside the bound while the whole diff is not.
    const bodyHunk = body(max - preamble.length + 50);
    expect(bodyHunk.length).toBeLessThanOrEqual(max);

    const notch = truncateDiff(preamble + bodyHunk, max);
    expect(notch.truncated).toBe(true);
    expect(notch.diff).not.toBe(preamble);
    expect(notch.diff).toContain(bodyHeader);
    expect(notch.diff).toContain("+a rewritten paragraph of prose");
    // Within one line of the bound, rather than within one line of the preamble.
    expect(notch.diff.length).toBeGreaterThan(max - line.length);
    expect(notch.diff.length).toBeLessThanOrEqual(max);
    expect(notch.diff.endsWith("\n")).toBe(true);

    // Either side of the old notch the answer is unchanged. One character
    // smaller and nothing is dropped at all…
    const under = truncateDiff(preamble + body(max - preamble.length), max);
    expect(under.truncated).toBe(false);
    expect(under.diff).toContain(bodyHeader);
    // …and one line larger than the bound the cut lands inside the hunk, as it
    // always did.
    const over = truncateDiff(preamble + body(max + line.length), max);
    expect(over.truncated).toBe(true);
    expect(over.diff.length).toBeGreaterThan(max - line.length);
    expect(over.diff).toContain("+a rewritten paragraph of prose");
  });

  it("spends the budget on a trailing hunk of exactly the bound, rather than dropping it", () => {
    // The old rule turned on `dropped <= max`, so a trailing hunk measuring
    // exactly the bound was dropped whole and the answer was the lead alone.
    // There is no such notch left: the cut is the last line boundary either way.
    const lead = ["diff --git a/n.md b/n.md", "@@ -1,1 +1,2 @@", "+lead"].join("\n");
    const tailHeader = "@@ -9,1 +10,40 @@";
    const line = "+padding line that is thirty-nine\n";
    const tail = `${tailHeader}\n${line.repeat(20)}`;
    const text = `${lead}\n${tail}`;
    const tailStart = text.indexOf(tailHeader);

    const exact = truncateDiff(text, tail.length);
    expect(exact.truncated).toBe(true);
    expect(exact.diff.length).toBeGreaterThan(tailStart);
    expect(exact.diff).toContain(tailHeader);

    // One character less of budget: the same answer to within one line.
    const overrun = truncateDiff(text, tail.length - 1);
    expect(overrun.diff.length).toBeGreaterThan(tailStart);
    expect(overrun.diff).toContain(tailHeader);
    expect(overrun.diff.endsWith("\n")).toBe(true);
  });

  it("cannot mistake a document line starting with @@ for a hunk header", () => {
    // In a unified diff every content line carries a ` `, `+` or `-` prefix, so
    // a markdown line reading `@@ careful @@` arrives as `+@@ careful @@`. Under
    // a line cut the question never arises — kept as a regression pin, because
    // the hazard returns the moment anyone reintroduces a hunk scan here.
    const first = ["diff --git a/n.md b/n.md", "@@ -1,2 +1,3 @@", "+@@ careful @@", "+tail"].join(
      "\n",
    );
    const second = ["@@ -20,1 +21,2 @@", "+second hunk", "+more"].join("\n");
    const text = `${first}\n${second}\n`;

    const bounded = truncateDiff(text, text.length - 5);
    expect(bounded.truncated).toBe(true);
    expect(bounded.diff).toContain("+@@ careful @@");
    expect(bounded.diff).toContain("+tail");
    // Cut at the last line boundary inside the bound, never mid-line.
    expect(bounded.diff.endsWith("\n")).toBe(true);
    expect(text.startsWith(bounded.diff)).toBe(true);
    expect(bounded.diff.length).toBeLessThanOrEqual(text.length - 5);
  });
});
