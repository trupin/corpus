import { beforeEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { serializeDoc } from "../editor/markdown/serialize.js";
import { rebaseRange } from "./rebase.js";
import { resetSourceTraceCache } from "./sourceTrace.js";

/**
 * One range, in two spellings of one document (UI-062).
 *
 * Every case here is a file the editor would print differently — the shapes a
 * hand-written or agent-written workspace is full of — and the assertion is
 * always the same: the rebased range quotes the **same text**, so a highlight
 * drawn from it covers the words the comment was about.
 */

beforeEach(() => {
  resetSourceTraceCache();
});

/** What the editor would write for this file. */
function canonicalOf(body: string): string {
  return serializeDoc(parseMarkdown(body));
}

/** Rebase the range covering `quote` in `body`, and read it back out of the target. */
function travel(body: string, quote: string): string | null {
  const canonical = canonicalOf(body);
  const start = body.indexOf(quote);
  expect(start).toBeGreaterThanOrEqual(0);
  const rebased = rebaseRange(body, canonical, { start, end: start + quote.length });
  return rebased === null ? null : canonical.slice(rebased.start, rebased.end);
}

describe("rebasing a range between two spellings", () => {
  it("is the identity when the two spellings are the same string", () => {
    const body = "The rate is 6.1% today.\n";
    expect(rebaseRange(body, body, { start: 12, end: 16 })).toEqual({ start: 12, end: 16 });
  });

  /**
   * The reported case. A body that starts with the blank line between the
   * frontmatter fence and the first block — the ordinary shape of a file nobody
   * wrote through the editor — shifts every offset in the document by one.
   */
  it("crosses the blank line a file keeps after its frontmatter", () => {
    const body = "\n# Standup\n\n**Moushmi Verma** on repositioning Fernando under Mesbah.\n";
    expect(canonicalOf(body)).not.toBe(body);
    expect(travel(body, "Moushmi Verma** on repositioning Fernando under Mesbah")).toBe(
      "Moushmi Verma** on repositioning Fernando under Mesbah",
    );
  });

  it("crosses a table the printer pads", () => {
    const body = "| who | area |\n| --- | ---- |\n| Fernando | platform |\n\nAfter the table.\n";
    expect(travel(body, "After the table")).toBe("After the table");
    expect(travel(body, "Fernando")).toBe("Fernando");
  });

  it("crosses a hard break spelled as two trailing spaces", () => {
    const body = "on repositioning  \nFernando under Mesbah.\n";
    expect(travel(body, "Fernando under Mesbah")).toBe("Fernando under Mesbah");
  });

  it("crosses a setext heading", () => {
    const body = "Standup\n=======\n\nThe rate is 6.1% today.\n";
    expect(travel(body, "6.1%")).toBe("6.1%");
  });

  it("crosses an indented code block the printer fences", () => {
    const body = "text\n\n    code line\n\nThe rate is 6.1% today.\n";
    expect(travel(body, "6.1%")).toBe("6.1%");
  });

  it("crosses a shortening and a lengthening construct that cancel out", () => {
    // The pair `offsetsComparable` exists to catch: same total length, every
    // offset between them moved.
    const body = "Title\n=====\n\n    code\n";
    expect(canonicalOf(body).length).toBe(body.length);
    expect(travel(body, "Title")).toBe("Title");
  });

  it("keeps a range that begins inside markup on the words, not the asterisks", () => {
    const body = "\nSaid **Moushmi Verma** on Monday.\n";
    const canonical = canonicalOf(body);
    const start = body.indexOf("Moushmi");
    const rebased = rebaseRange(body, canonical, { start, end: body.indexOf("Monday") + 6 });
    expect(rebased).not.toBeNull();
    expect(canonical.slice(rebased?.start ?? 0, rebased?.end ?? 0)).toBe(
      "Moushmi Verma** on Monday",
    );
  });

  /**
   * **The known widening.** A run is atomic when its markdown and its text differ
   * character for character, and a partial hit inside one quotes the whole run.
   * Escaping puts a run on one side of that line and not the other: a file
   * written by a defensively-escaping printer spells the paragraph `5 \* 3`,
   * which the trace cannot slice, while the canonical text prints a bare `5 * 3`
   * (`escape.ts` leaves an asterisk with spaces on both sides alone, since it can
   * neither open nor close emphasis), which it can.
   *
   * So the round trip is not always exact — it is exact or **wider**. The result
   * still contains the quoted words and is still on the right sentence; it is
   * simply the whole paragraph. Pinned so the next reader knows it is a known
   * widening rather than a bug.
   */
  it("widens to the whole run when one spelling escapes what the other does not", () => {
    const body = "\nThe rate is 6.1% and 5 \\* 3 is fifteen.\n\nA second paragraph.\n";
    const canonical = canonicalOf(body);
    // The escape is the whole difference: same words, two spellings of one of them.
    expect(canonical).toContain("5 * 3");
    expect(body).toContain("5 \\* 3");

    const quoted = travel(body, "fifteen");
    // Not refused, and not misplaced — the word the comment was on is in there.
    expect(quoted).toContain("fifteen");
    // But widened to the run the escape made atomic: the paragraph, not the word.
    expect(quoted).toBe("The rate is 6.1% and 5 * 3 is fifteen.");
    // And no further. The widening stops at the run it overlapped.
    expect(quoted).not.toContain("second paragraph");
  });

  /** The same document, minus the escape: nothing to widen, so nothing widens. */
  it("stays exact in a paragraph neither spelling escapes", () => {
    const body = "\nThe rate is 6.1% and 5 plus 3 is fifteen.\n";
    expect(canonicalOf(body)).not.toBe(body);
    expect(travel(body, "fifteen")).toBe("fifteen");
  });

  /**
   * The licence and nothing weaker. Two documents that do not render the same
   * characters have no shared projection to travel through, and a placement
   * would be a guess about which sentence a comment is on.
   */
  it("refuses when the two spellings render different text", () => {
    expect(
      rebaseRange("The rate is 6.1%.\n", "A different sentence.\n", { start: 12, end: 16 }),
    ).toBeNull();
  });

  it("refuses a range that covers no content at all", () => {
    const body = "\n**bold**\n";
    // `**` alone: syntax, which no run addresses.
    expect(rebaseRange(body, canonicalOf(body), { start: 1, end: 3 })).toBeNull();
  });

  it("refuses an empty range", () => {
    const body = "\nThe rate is 6.1% today.\n";
    expect(rebaseRange(body, canonicalOf(body), { start: 5, end: 5 })).toBeNull();
  });
});

/**
 * **One divergence is not contagious** (UI-099) — and "one" is load-bearing:
 * the describe below it pins what a *second* one still costs.
 *
 * The reported document was a 31KB `note` whose two spellings first parted
 * company at plain offset 23,792 — and every comment in it, including one
 * anchored at ~1,400, drew no highlight at all, because the whole file failed one
 * equality test. The shape that did it is below, reduced to six lines: a second
 * paragraph of an outer list item, after a nested sublist. The printer drops the
 * blank line, so the paragraph re-parses as a lazy continuation of the last
 * nested bullet and the rendered text gains a newline the file does not have.
 *
 * What is asserted here is the boundary in both directions: the passages on
 * either side of the divergence travel, and one that straddles it does not.
 */
describe("a document whose two spellings diverge in one place", () => {
  /** Outer item, nested sublist, then a further paragraph of the outer item. */
  const BODY =
    "- Outer bullet leads in.\n" +
    "  - Nested bullet one.\n" +
    "  - Nested bullet two.\n" +
    "\n" +
    "  A trailing paragraph of the outer item.\n" +
    "- Second outer bullet.\n";

  it("is a body the printer really does respell, and only there", () => {
    const canonical = canonicalOf(BODY);
    expect(canonical).not.toBe(BODY);
    // The whole of the difference: the blank line before the trailing paragraph.
    expect(BODY).toContain("Nested bullet two.\n\n  A trailing");
    expect(canonical).toContain("Nested bullet two.\n  A trailing");
  });

  it("places a passage before the divergence", () => {
    expect(travel(BODY, "Outer bullet leads in")).toBe("Outer bullet leads in");
    expect(travel(BODY, "Nested bullet one")).toBe("Nested bullet one");
  });

  it("places a passage after the divergence, shifted by the one length delta", () => {
    expect(travel(BODY, "Second outer bullet")).toBe("Second outer bullet");
  });

  /**
   * The passage the printer's respelling swallowed is placed too, and takes the
   * module's known widening: merging the paragraph into the bullet above it
   * makes one run whose markdown and text differ (the continuation indent), and
   * a partial hit inside an atomic run quotes the whole run. Wide, on the right
   * sentence, and containing the words — the documented trade, not a
   * misplacement, and still far better than the nothing it drew before.
   */
  it("widens a passage inside the run the respelling merged", () => {
    const quoted = travel(BODY, "trailing paragraph of the outer item");
    expect(quoted).toContain("trailing paragraph of the outer item");
    expect(quoted).toBe("Nested bullet two.\n  A trailing paragraph of the outer item.");
    // And no further: the widening stops at the run it overlapped.
    expect(quoted).not.toContain("Second outer bullet");
  });

  /**
   * The premise really does fail across the seam — the file says the two blocks
   * are separate and the canonical spelling says they are one — so this refuses,
   * exactly as whole-document inequality used to. A visible gap beats a
   * confident lie about which sentence a comment is on.
   */
  it("still refuses a passage that straddles the divergence", () => {
    expect(travel(BODY, "Nested bullet two.\n\n  A trailing paragraph")).toBeNull();
  });

  /**
   * The other half of the guarantee. Passages the whole-document test refused
   * are licensed here — that is the fix — but nothing it *allowed* changes: when
   * the projections agree everywhere the common prefix is the entire string and
   * every range takes the same branch it always did.
   */
  it("is unchanged for a document whose spellings agree throughout", () => {
    const body = "\n# Standup\n\nThe rate is 6.1% today.\n";
    expect(travel(body, "6.1%")).toBe("6.1%");
  });
});

/**
 * **The limit, pinned so it reads as a known bound rather than a fresh bug**
 * (PR #39 review, MINOR 7).
 *
 * "A divergence stops being contagious" is true of *one* divergence and no more.
 * The prefix stops at the **first** place the two projections part company and
 * the suffix reaches back only to the **last**, so a document the printer
 * respells twice still refuses every range between them — the middle is in
 * neither region, and across it the two spellings genuinely disagree about which
 * character is which. Conservative and correct, and worth a test: a 31KB
 * hand-written note plausibly contains the offending construct more than once,
 * and such a document still draws nothing over its whole middle.
 */
describe("a document whose two spellings diverge twice", () => {
  const BODY =
    "- Outer bullet leads in.\n" +
    "  - Nested bullet one.\n" +
    "\n" +
    "  A trailing paragraph of the first item.\n" +
    "- Second outer bullet.\n" +
    "\n" +
    "A paragraph in the middle that both spellings agree about.\n" +
    "\n" +
    "- Another outer bullet.\n" +
    "  - Another nested bullet.\n" +
    "\n" +
    "  A trailing paragraph of the second item.\n" +
    "- Final outer bullet.\n";

  it("really does respell two separate places", () => {
    const canonical = canonicalOf(BODY);
    expect(BODY).toContain("Nested bullet one.\n\n  A trailing");
    expect(canonical).toContain("Nested bullet one.\n  A trailing");
    expect(BODY).toContain("Another nested bullet.\n\n  A trailing");
    expect(canonical).toContain("Another nested bullet.\n  A trailing");
  });

  it("places a passage before the first divergence and after the last", () => {
    expect(travel(BODY, "Outer bullet leads in")).toBe("Outer bullet leads in");
    expect(travel(BODY, "Final outer bullet")).toBe("Final outer bullet");
  });

  /**
   * The bound itself. This paragraph is spelled identically in both — it is only
   * *between* two constructs that are not — and it is refused all the same.
   */
  it("refuses a passage between the two divergences, though its own text agrees", () => {
    expect(BODY).toContain("A paragraph in the middle that both spellings agree about.");
    expect(canonicalOf(BODY)).toContain(
      "A paragraph in the middle that both spellings agree about.",
    );
    expect(travel(BODY, "paragraph in the middle")).toBeNull();
  });
});
