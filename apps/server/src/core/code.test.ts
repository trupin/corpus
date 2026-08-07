import { describe, expect, it } from "vitest";
import {
  codeRanges,
  fencedCodeRanges,
  inlineCodeRanges,
  overlapsRange,
  splitLines,
  unterminatedFence,
} from "./code.js";

const slices = (text: string, ranges: readonly { start: number; end: number }[]): string[] =>
  ranges.map((range) => text.slice(range.start, range.end));

describe("splitLines", () => {
  it("reports content and terminator offsets for LF text", () => {
    expect(splitLines("a\nb")).toEqual([
      { text: "a", start: 0, contentEnd: 1, end: 2 },
      { text: "b", start: 2, contentEnd: 3, end: 3 },
    ]);
  });

  it("strips the carriage return from CRLF lines", () => {
    expect(splitLines("a\r\nb").map((line) => line.text)).toEqual(["a", "b"]);
  });

  it("emits a trailing empty line when the text ends with a newline", () => {
    expect(splitLines("a\n").map((line) => line.text)).toEqual(["a", ""]);
  });

  it("handles a leading newline", () => {
    expect(splitLines("\na").map((line) => line.text)).toEqual(["", "a"]);
  });
});

describe("fencedCodeRanges", () => {
  it("covers a backtick fence, fence lines included", () => {
    const text = "before\n```ts\ncode\n```\nafter\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```ts\ncode\n```"]);
  });

  it("covers a tilde fence", () => {
    const text = "~~~\ncode\n~~~\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["~~~\ncode\n~~~"]);
  });

  it("does not close a backtick fence with a tilde fence", () => {
    const text = "```\ncode\n~~~\nstill code\n```\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n~~~\nstill code\n```"]);
  });

  it("requires the closing fence to be at least as long as the opening one", () => {
    const text = "````\n```\nstill code\n````\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["````\n```\nstill code\n````"]);
  });

  it("runs an unterminated fence to the end of the text", () => {
    const text = "```\ncode\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n"]);
  });

  it("allows up to three spaces of indentation before a fence", () => {
    const text = "   ```\ncode\n   ```\n";
    expect(fencedCodeRanges(text)).toHaveLength(1);
  });

  it("ignores a backtick fence whose info string contains a backtick", () => {
    expect(fencedCodeRanges("```a`b\ntext\n")).toEqual([]);
  });

  it("does not close a fence on a line carrying an info string", () => {
    const text = "```\ncode\n``` trailing\n```\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n``` trailing\n```"]);
  });

  it("finds nothing in plain prose", () => {
    expect(fencedCodeRanges("just prose\nover two lines\n")).toEqual([]);
  });
});

/**
 * SERVER-066. The cases that matter are the ones a person actually writes: the
 * reported bug (a closing run on the same line as the content), and the several
 * shapes that *do* close and therefore must stay silent — AGENT-012's widening
 * means an opener's width varies, so "closed with more backticks than it opened
 * with" is a normal document, not a defect.
 */
describe("unterminatedFence", () => {
  it("reports the reported shape: a closing run on the content's own line", () => {
    const text = "Here is the snippet:\n\n```\nconst x = 1;```\n\nmore prose\n";
    expect(unterminatedFence(text)).toEqual({ marker: "```", start: 22, line: 3 });
  });

  it("reports nothing for a fence closed on its own line", () => {
    expect(unterminatedFence("```\nconst x = 1;\n```\n")).toBeNull();
  });

  it("reports nothing when the closing run is wider than the opening one", () => {
    expect(unterminatedFence("```\ncode\n`````\n")).toBeNull();
  });

  it("reports the fence when the closing run is narrower than the opening one", () => {
    expect(unterminatedFence("````\ncode\n```\n")).not.toBeNull();
  });

  it("reports nothing for a closing fence indented up to three spaces", () => {
    expect(unterminatedFence("```\ncode\n   ```\n")).toBeNull();
  });

  it("reports the fence when the closing run is indented four spaces", () => {
    expect(unterminatedFence("```\ncode\n    ```\n")?.line).toBe(1);
  });

  it("does not treat a line that merely starts with backticks mid-sentence as a close", () => {
    // The run is at the line start but carries an info string, which closes
    // nothing — the same rule that makes `` ```ts `` an opener and not a closer.
    expect(unterminatedFence("```\ncode\n``` and then some prose\n")?.line).toBe(1);
  });

  it("reports a tilde fence with its own run", () => {
    expect(unterminatedFence("prose\n~~~~\ncode\n")).toEqual({
      marker: "~~~~",
      start: 6,
      line: 2,
    });
  });

  it("reports nothing for a backtick opener whose info string carries a backtick", () => {
    // CommonMark: that line is not a fence at all, so nothing ever opened.
    expect(unterminatedFence("```a`b\ntext\n")).toBeNull();
  });

  it("reports nothing for plain prose", () => {
    expect(unterminatedFence("just prose\nover two lines\n")).toBeNull();
  });

  it("reports the second fence when an earlier one closed", () => {
    const text = "```\nclosed\n```\nprose\n~~~\nopen\n";
    expect(unterminatedFence(text)).toMatchObject({ marker: "~~~", line: 5 });
  });

  /**
   * The two readings come from one scan, so they cannot disagree: whatever
   * `unterminatedFence` reports is exactly the range `fencedCodeRanges` ran to
   * the end of the text.
   */
  it("agrees with fencedCodeRanges about where the open fence starts", () => {
    const text = "prose\n```\ncode that never ends\n";
    const open = unterminatedFence(text);
    const last = fencedCodeRanges(text).at(-1);
    expect(open?.start).toBe(last?.start);
    expect(last?.end).toBe(text.length);
  });

  it("leaves fencedCodeRanges unchanged when nothing is open", () => {
    const text = "```\ncode\n```\ntrailing\n";
    expect(unterminatedFence(text)).toBeNull();
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\ncode\n```"]);
  });
});

/**
 * SERVER-066 review, finding A: a fence inside a list item or a block quote.
 *
 * The scanner used to see neither the opener (the delimiter run is not at the
 * line start) nor, therefore, the *closer* as anything but a fresh opener — so
 * a perfectly ordinary bulleted code block masked from its last line onward and
 * failed `corpus doc check` at error severity. Every shape below is valid
 * CommonMark that closes; the point of each is `null`.
 */
describe("unterminatedFence inside container blocks", () => {
  it.each([
    ["the reviewer's fixture, body at the margin", "- ```js\ncode\n  ```\n"],
    ["a bulleted item with its body indented under it", "- ```js\n  code\n  ```\n\nAfter.\n"],
    ["a `*` bullet", "* ```js\n  code\n  ```\n"],
    ["a `+` bullet", "+ ```js\n  code\n  ```\n"],
    ["an ordered item", "1. ```js\n   code\n   ```\n"],
    ["an ordered item with `)`", "1) ```js\n   code\n   ```\n"],
    ["a nested item", "- outer\n  - ```js\n    code\n    ```\n"],
    ["a block quote", "> ```js\n> code\n> ```\n"],
    ["a bullet inside a block quote", "> - ```js\n>   code\n>   ```\n"],
    ["a tilde fence in an item", "- ~~~\n  code\n  ~~~\n"],
    ["a closer dedented to the margin", "- ```js\n  code\n```\n"],
    ["a closer indented past the item's content column", "- ```js\n    code\n    ```\n"],
    ["a marker followed by several spaces", "-   ```js\n    code\n    ```\n"],
  ])("reports nothing for a closed fence in %s", (_name, text) => {
    expect(unterminatedFence(text)).toBeNull();
  });

  it("masks the whole item, so a turn heading inside a bulleted snippet stays quoted", () => {
    const text = "- ```\n  ## user · 2026-01-01T00:00:00Z\n  ```\nafter\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual([
      "- ```\n  ## user · 2026-01-01T00:00:00Z\n  ```",
    ]);
  });

  it("still reports a fence an item really did leave open", () => {
    expect(unterminatedFence("- ```js\n  code\n")).toEqual({
      marker: "```",
      start: 0,
      line: 1,
    });
  });

  /**
   * The narrowness of the model, asserted rather than described: inside an open
   * fence there are no *new* containers, only continuations of the ones already
   * entered. A line of code that reads as a bulleted or quoted fence is code.
   */
  it("does not let a bulleted fence line close a block opened at the margin", () => {
    const text = "```\n- ```\n```\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\n- ```\n```"]);
  });

  it("does not let a quoted fence line close a block opened outside a quote", () => {
    const text = "```\n> ```\n```\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual(["```\n> ```\n```"]);
  });

  it("leaves a four-space-indented block alone — that is indented code, not a fence", () => {
    expect(fencedCodeRanges("    ```js\n    code\n    ```\n")).toEqual([]);
    expect(unterminatedFence("    ```js\n    code\n    ```\n")).toBeNull();
  });

  it("does not mistake a thematic break for a bulleted fence", () => {
    expect(unterminatedFence("***\ntext\n")).toBeNull();
    expect(unterminatedFence("- - -\ntext\n")).toBeNull();
  });
});

/**
 * SERVER-066 review round 2: indentation is measured in *columns*, and a tab is
 * how a container's body is most often indented.
 *
 * The first round modelled containers by counting spaces, which saw the opener
 * behind a space-delimited marker and then failed to see a tab-indented closer —
 * so a shape CommonMark closes was reported unterminated, and masked from the
 * marker to the end of the body. That is strictly worse than the silence it
 * replaced: on the pre-container scanner these texts produced no fence, no
 * finding and no masking at all. Every case below is valid CommonMark whose
 * fence closes (checked against a CommonMark renderer, not by eye), so the point
 * of each is `null`.
 */
describe("unterminatedFence with tab-indented containers", () => {
  it.each([
    ["a bulleted item with a tab-indented body", "- ```js\n\tcode\n\t```\n\nAfter.\n"],
    ["an ordered item with a tab-indented body", "1. ```js\n\tcode\n\t```\n\nAfter.\n"],
    ["an ordered item with `)` and a tab", "1) ```js\n\tcode\n\t```\n"],
    ["a `*` bullet with a tab", "* ```js\n\tcode\n\t```\n"],
    ["a `+` bullet with a tab", "+ ```js\n\tcode\n\t```\n"],
    ["a tilde fence with a tab", "- ~~~\n\tcode\n\t~~~\n"],
    ["a body indented with a space then a tab", "- ```js\n \tcode\n \t```\n"],
    ["a bullet marker followed by a tab", "-\t```js\n\tcode\n\t```\n"],
    ["an ordered marker followed by a tab", "1.\t```js\n\tcode\n\t```\n"],
    ["a block-quote marker followed by a tab", ">\t```js\n>\tcode\n>\t```\n"],
    ["a tab-indented body under a nested item", "- outer\n  - ```js\n\tcode\n\t```\n"],
  ])("reports nothing for a closed fence in %s", (_name, text) => {
    expect(unterminatedFence(text)).toBeNull();
  });

  it("masks the item rather than running to the end of the body", () => {
    const text = "- ```\n\t## user · 2026-01-01T00:00:00Z\n\t```\nafter\n";
    expect(slices(text, fencedCodeRanges(text))).toEqual([
      "- ```\n\t## user · 2026-01-01T00:00:00Z\n\t```",
    ]);
  });

  it("still refuses a closer four or more columns past the content column", () => {
    // One tab under a `- ` marker is four columns, two past a content column of
    // 2 — that closes, above. Two tabs are eight columns, six past it, so
    // CommonMark swallows that line into the block as indented code rather than
    // closing on it (verified by rendering: the ``` appears inside the <code>).
    // CommonMark then closes the block at the item's end; this scanner does not,
    // which is the "containers never end" divergence pinned below.
    expect(unterminatedFence("- ```js\n\t\tcode\n\t\t```\n")).toEqual({
      marker: "```",
      start: 0,
      line: 1,
    });
  });

  it("still treats a tab at the margin as indented code, not a fence", () => {
    expect(fencedCodeRanges("\t```js\n\tcode\n\t```\n")).toEqual([]);
    expect(unterminatedFence("\t```js\n\tcode\n\t```\n")).toBeNull();
  });

  /**
   * A block quote inside an indented list item: its continuation lines carry
   * more indentation before the `>` than BLOCKQUOTE_MARKER tolerates on its own,
   * so the item's allowance has to be spent before the marker is looked for.
   */
  it("finds a quote marker indented past its own three-space tolerance", () => {
    expect(unterminatedFence("  - > ```\n    > code\n    > ```\n\nAfter.\n")).toBeNull();
  });
});

/**
 * The two divergences from CommonMark that are known, deliberate and *not*
 * fixed, pinned here so that changing either is a decision rather than an
 * accident. Both err toward a false error — the loud direction — and the module
 * docblock says so; these tests exist to keep that description true.
 */
describe("unterminatedFence divergences that are accepted", () => {
  it("keeps a fence open past the end of the list item that opened it", () => {
    // CommonMark closes the fence at the item's boundary, so this text is clean
    // there and unterminated here. Closing a container needs block structure
    // this module does not build.
    expect(unterminatedFence("- ```js\n  code\n\nAfter the list.\n")).toEqual({
      marker: "```",
      start: 0,
      line: 1,
    });
  });

  it("reads an ordered marker as a container even where it cannot interrupt a paragraph", () => {
    // CommonMark: an ordered item may interrupt a paragraph only when it starts
    // at 1, so there is no list and no fence here at all.
    expect(unterminatedFence("Some prose\n2. ```\nmore text\n")).toEqual({
      marker: "```",
      start: 11,
      line: 2,
    });
  });

  it("is why that divergence is not repaired by refusing a marker after a paragraph", () => {
    // The same shape one line earlier is a genuine sibling item. Refusing it
    // would leave the item's closing fence reading as a fresh opener — the very
    // failure the container model was added to fix.
    expect(unterminatedFence("1. a\n2. ```js\n   code\n   ```\n")).toBeNull();
  });
});

/**
 * The safety property the container model rests on, asserted rather than
 * described: a text carrying no container marker takes the path it took before
 * containers (or tabs) were modelled at all.
 *
 * `preContainerScan` is that scanner, transcribed — FENCE_LINE against the line
 * as given, no prefix removed, no tab expanded. Every permutation below is
 * container-free and tab-bearing, which is exactly the region where an
 * expand-everything implementation could drift without anyone noticing: the
 * repository's own markdown contains only two files with a tab in them.
 */
describe("the container-free path is unchanged", () => {
  const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const preContainerScan = (text: string): string => {
    const ranges: { start: number; end: number }[] = [];
    let open: { marker: string; start: number; line: number } | null = null;
    let lineNumber = 0;
    for (const line of splitLines(text)) {
      lineNumber += 1;
      const match = FENCE_LINE.exec(line.text);
      if (open === null) {
        if (match === null) continue;
        const marker = match[1] ?? "";
        if (marker.startsWith("`") && (match[2] ?? "").includes("`")) continue;
        open = { marker, start: line.start, line: lineNumber };
        continue;
      }
      const marker = match?.[1] ?? "";
      if (
        match !== null &&
        (match[2] ?? "").trim() === "" &&
        marker[0] === open.marker[0] &&
        marker.length >= open.marker.length
      ) {
        ranges.push({ start: open.start, end: line.contentEnd });
        open = null;
      }
    }
    if (open !== null) ranges.push({ start: open.start, end: text.length });
    return JSON.stringify({ ranges, open });
  };

  const lines = [
    "```",
    "```js",
    "~~~",
    "``` ",
    "```\t",
    "\t```",
    " \t```",
    "\t\t```",
    "  \t```",
    "   \t```",
    "\tcode",
    "code\ttail",
    "\t",
    "",
    "text",
    "```\tjs",
    "\t~~~",
    "a\t`b`\tc",
  ];

  it("agrees with the pre-container scanner on every tab-bearing permutation", () => {
    const divergent: string[] = [];
    for (const first of lines) {
      for (const second of lines) {
        for (const third of lines) {
          const text = `${first}\n${second}\n${third}\n`;
          const actual = JSON.stringify({
            ranges: fencedCodeRanges(text),
            open: unterminatedFence(text),
          });
          if (actual !== preContainerScan(text)) divergent.push(JSON.stringify(text));
        }
      }
    }
    expect(divergent).toEqual([]);
  });
});

describe("inlineCodeRanges", () => {
  it("covers a span including its delimiters", () => {
    const text = "a `code` b";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["`code`"]);
  });

  it("matches runs of equal length only", () => {
    const text = "``a ` b`` c";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["``a ` b``"]);
  });

  it("leaves an unmatched run as literal text", () => {
    expect(inlineCodeRanges("a `unclosed span")).toEqual([]);
  });

  it("finds a later span after an unmatched run", () => {
    const text = "``unmatched then `code` here";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["`code`"]);
  });

  it("ignores backticks inside a skipped range", () => {
    const text = "```\n`x`\n```\nthen `y`";
    expect(slices(text, inlineCodeRanges(text, fencedCodeRanges(text)))).toEqual(["`y`"]);
  });

  it("spans a line break", () => {
    const text = "a `two\nlines` b";
    expect(slices(text, inlineCodeRanges(text))).toEqual(["`two\nlines`"]);
  });
});

describe("codeRanges", () => {
  it("returns fenced blocks and inline spans together", () => {
    const text = "`one`\n```\ntwo\n```\n`three`";
    expect(slices(text, codeRanges(text)).sort()).toEqual(["```\ntwo\n```", "`one`", "`three`"]);
  });
});

describe("overlapsRange", () => {
  const ranges = [{ start: 5, end: 10 }];

  it.each([
    [0, 5, false],
    [0, 6, true],
    [5, 10, true],
    [9, 12, true],
    [10, 12, false],
  ])("reports [%i,%i) as %s", (start, end, expected) => {
    expect(overlapsRange(ranges, start, end)).toBe(expected);
  });
});
