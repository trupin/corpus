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
