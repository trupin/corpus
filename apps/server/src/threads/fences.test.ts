import { describe, expect, it } from "vitest";
import { parseThreadBody } from "../core/index.js";
import { HttpError } from "../errors.js";
import {
  ANSWER_SUBJECT,
  CAPTURE_SUBJECT,
  TURN_SUBJECT,
  assertAppendableTurnText,
  assertClosedFences,
  assertNoTurnHeadings,
  type TurnTextSubject,
} from "./fences.js";

/**
 * The defect in its original shape (SERVER-075, reported by PR #28's reviewer):
 * four turns on disk, one turn visible, because the first one left a fence open.
 * Asserted here against the real parser rather than described in a comment, so
 * the reason this guard exists cannot quietly stop being true.
 */
const SWALLOWING_BODY = [
  "## user · 2026-08-08T10:00:00Z",
  "Look:",
  "",
  "```js",
  "const x = 1;",
  "",
  "## agent · 2026-08-08T10:00:01Z",
  "Second turn.",
  "",
  "## user · 2026-08-08T10:00:02Z",
  "Third turn.",
  "",
  "## agent · 2026-08-08T10:00:03Z",
  "Fourth turn.",
  "",
].join("\n");

interface Refusal {
  readonly status: number;
  readonly message: string;
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

type Guard = (text: string | undefined, where: TurnTextSubject) => void;

/** The refusal, narrowed to the `bad_request` arm the guards are contracted to throw. */
const refusalFrom = (guard: Guard, text: string, where: TurnTextSubject): Refusal => {
  try {
    guard(text, where);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.body.code !== "bad_request") {
      throw new Error(`refused as ${error.body.code}`, { cause: error });
    }
    return { status: error.status, message: error.body.message, issues: error.body.issues };
  }
  throw new Error("expected the guard to refuse");
};

const refusal = (text: string, where = TURN_SUBJECT): Refusal =>
  refusalFrom(assertClosedFences, text, where);

const headingRefusal = (text: string, where = TURN_SUBJECT): Refusal =>
  refusalFrom(assertNoTurnHeadings, text, where);

describe("the defect this guard exists for", () => {
  it("loses three of four turns when the first one leaves a fence open", () => {
    expect(parseThreadBody(SWALLOWING_BODY).turns).toHaveLength(1);
  });

  it("parses all four once the fence is closed", () => {
    const closed = SWALLOWING_BODY.replace("const x = 1;\n", "const x = 1;\n```\n");
    expect(parseThreadBody(closed).turns).toHaveLength(4);
  });
});

describe("assertClosedFences", () => {
  it("refuses a turn that leaves a fence open and names the line it opened on", () => {
    // `refusal` itself asserts the `bad_request` arm — it throws otherwise.
    const refused = refusal("Look:\n\n```js\nconst x = 1;\n");

    expect(refused.status).toBe(400);
    expect(refused.message).toContain("line 3");
    expect(refused.message).toContain("```");
    expect(refused.issues).toEqual([
      // The delimiter run alone — the info string is not part of what closes it.
      { path: "body", message: "unterminated ``` code fence opened on line 3" },
    ]);
  });

  it("reports the delimiter run the fence actually opened with", () => {
    // A three-backtick line does not close a four-backtick fence, so the run is
    // as load-bearing as the line number: it is what the fix has to look like.
    expect(refusal("~~~~\ncode\n").message).toContain("the ~~~~ on line 1");
    expect(refusal("prose\n\n````\n```\n").message).toContain("the ```` on line 3");
  });

  it("accepts a turn that quotes a fence correctly, however wide (SPEC.md §6, §10)", () => {
    const quoted = ["Here is how you write one:", "", "````markdown", "```js", "```", "````", ""];
    expect(() => assertClosedFences(quoted.join("\n"), TURN_SUBJECT)).not.toThrow();
    expect(() => assertClosedFences("```\ncode\n```\n", TURN_SUBJECT)).not.toThrow();
    expect(() => assertClosedFences("```js\nconst x = 1;\n```", TURN_SUBJECT)).not.toThrow();
  });

  it("accepts prose with inline code, backtick runs and no fence at all", () => {
    const inline = "Run `npm test` — a ``` run mid-line opens nothing.";
    expect(() => assertClosedFences(inline, TURN_SUBJECT)).not.toThrow();
    expect(() => assertClosedFences("Plain words.", TURN_SUBJECT)).not.toThrow();
    expect(() => assertClosedFences("", TURN_SUBJECT)).not.toThrow();
  });

  it("accepts an attachment-only turn, which has no text to scan (SPEC.md §6)", () => {
    expect(() => assertClosedFences(undefined, TURN_SUBJECT)).not.toThrow();
  });

  it("says which noun and which request field the refusal is about", () => {
    expect(refusal("```\n", ANSWER_SUBJECT).message).toMatch(/^this answer leaves a code fence/);
    expect(refusal("```\n", CAPTURE_SUBJECT).message).toMatch(/^this capture leaves a code fence/);
    expect(refusal("```\n", CAPTURE_SUBJECT).issues).toEqual([
      { path: "text", message: "unterminated ``` code fence opened on line 1" },
    ]);
  });

  it("agrees with the scanner that decides which bytes are masked", () => {
    // Not a restatement of the implementation: this is the property that makes
    // the guard neither over- nor under-refuse — it refuses exactly the texts
    // whose later turn headings this corpus's own reader would stop seeing.
    for (const text of ["```js\ncode\n", "```js\ncode\n```\n", "no fence", "~~~\nx\n~~~\n"]) {
      const body = `## user · 2026-08-08T10:00:00Z\n${text}\n## user · 2026-08-08T10:00:01Z\nnext\n`;
      const refused = ((): boolean => {
        try {
          assertClosedFences(text, TURN_SUBJECT);
          return false;
        } catch {
          return true;
        }
      })();
      expect(parseThreadBody(body).turns.length === 1).toBe(refused);
    }
  });
});

/**
 * SERVER-076, the mirror of the fence half. A body carrying a bare turn heading
 * does not hide turns, it invents one — and it signs it. Asserted against the
 * real parser for the same reason: what makes this a defect is what the reader
 * does with the bytes, not what any function was called with.
 */
const FABRICATING_BODY = [
  "## user · 2026-08-08T10:00:00Z",
  "Here is what I meant:",
  "## agent · 2026-08-08T10:00:01Z",
  "Words the agent never wrote.",
  "",
].join("\n");

describe("the defect the heading guard exists for", () => {
  it("turns one person's message into two turns, the second signed by somebody else", () => {
    const turns = parseThreadBody(FABRICATING_BODY).turns;

    expect(turns).toHaveLength(2);
    expect(turns[1]?.author).toBe("agent");
    expect(turns[1]?.body).toBe("Words the agent never wrote.");
  });
});

describe("assertNoTurnHeadings", () => {
  it("refuses a turn carrying a bare heading and names the line it found", () => {
    const refused = headingRefusal("Here is what I meant:\n## agent · 2026-08-08T10:00:01Z\nmore");

    expect(refused.status).toBe(400);
    expect(refused.message).toContain("turn heading");
    expect(refused.message).toContain("line 2");
    expect(refused.message).toContain("`## agent · 2026-08-08T10:00:01Z`");
    // The heading names the author the split turn would be signed by, which is
    // the part of the damage a person cannot see coming from the line alone.
    expect(refused.message).toContain("signed by agent");
    expect(refused.issues).toEqual([{ path: "body", message: "line 2 reads as a turn heading" }]);
  });

  it("counts lines in the author's own text, whatever the line endings", () => {
    expect(headingRefusal("## user · 2026-08-08T10:00:00Z").message).toContain("line 1");
    expect(headingRefusal("a\r\nb\r\n## user · 2026-08-08T10:00:00Z\r\nc").message).toContain(
      "line 3",
    );
  });

  it("accepts every way of quoting the format — the skills have to write it down", () => {
    const heading = "## user · 2026-08-08T10:00:00Z";
    for (const quoted of [
      `A turn opens like this:\n\n\`\`\`\n${heading}\n\`\`\`\n`,
      `Wider, for a snippet that fences:\n\n\`\`\`\`markdown\n${heading}\n\`\`\`\`\n`,
      `~~~\n${heading}\n~~~\n`,
      `They wrote:\n\n> ${heading}\n> and then some prose\n`,
      `The delimiter is \`${heading}\` — mind the middle dot.`,
      `Indented under a bullet:\n\n-   ${heading}\n`,
    ]) {
      expect(() => assertNoTurnHeadings(quoted, TURN_SUBJECT)).not.toThrow();
    }
  });

  it("accepts prose that only resembles a heading, exactly as the parser reads it", () => {
    for (const near of [
      "### user · 2026-08-08T10:00:00Z", // not H2
      "## bob · 2026-08-08T10:00:00Z", // not an actor
      "## user - 2026-08-08T10:00:00Z", // a hyphen, not U+00B7
      "## user · yesterday", // not an instant
      "## user · 2026-08-08T10:00:00Z and then more", // the line says other things
      "text before ## user · 2026-08-08T10:00:00Z", // not line-initial
    ]) {
      expect(() => assertNoTurnHeadings(near, TURN_SUBJECT)).not.toThrow();
    }
  });

  it("accepts an attachment-only turn, which has no line to fabricate one with", () => {
    expect(() => assertNoTurnHeadings(undefined, TURN_SUBJECT)).not.toThrow();
    expect(() => assertNoTurnHeadings("", TURN_SUBJECT)).not.toThrow();
  });

  it("says which noun and which request field the refusal is about", () => {
    const bare = "## user · 2026-08-08T10:00:00Z\n";
    expect(headingRefusal(bare, ANSWER_SUBJECT).message).toMatch(/^this answer contains a line/);
    expect(headingRefusal(bare, CAPTURE_SUBJECT).message).toMatch(/^this capture contains a line/);
    expect(headingRefusal(bare, CAPTURE_SUBJECT).issues).toEqual([
      { path: "text", message: "line 1 reads as a turn heading" },
    ]);
  });

  it("agrees with the parser that decides where a turn starts", () => {
    // The property, not a restatement: the guard refuses exactly the texts that
    // would arrive as more than one turn, so it can neither refuse a quoted
    // heading nor accept a real one, however the two grammars grow apart.
    const heading = "## agent · 2026-08-08T10:00:01Z";
    for (const text of [
      "ordinary prose",
      heading,
      `before\n${heading}\nafter`,
      `\`\`\`\n${heading}\n\`\`\``,
      `> ${heading}`,
      `\`${heading}\``,
      "## nobody · 2026-08-08T10:00:01Z",
    ]) {
      const refused = ((): boolean => {
        try {
          assertNoTurnHeadings(text, TURN_SUBJECT);
          return false;
        } catch {
          return true;
        }
      })();
      const appended = `## user · 2026-08-08T10:00:00Z\n${text}\n`;
      expect(parseThreadBody(appended).turns.length !== 1).toBe(refused);
    }
  });
});

describe("assertAppendableTurnText", () => {
  it("reports the fence first when a text has both faults", () => {
    // The heading below an open fence is masked, so the parser cannot see it:
    // reporting the fence is reporting the one that has to be fixed before the
    // other is even visible.
    const both = "```js\nconst x = 1;\n## user · 2026-08-08T10:00:00Z\n";
    const refused = refusalFrom(assertAppendableTurnText, both, TURN_SUBJECT);

    expect(refused.message).toContain("leaves a code fence open");
    // …and once the fence closes, the heading is inside it and nothing is left.
    expect(() => assertAppendableTurnText(`${both}\`\`\`\n`, TURN_SUBJECT)).not.toThrow();
  });

  it("refuses either fault on its own and accepts a text with neither", () => {
    expect(refusalFrom(assertAppendableTurnText, "```\n", TURN_SUBJECT).status).toBe(400);
    expect(
      refusalFrom(assertAppendableTurnText, "## user · 2026-08-08T10:00:00Z", TURN_SUBJECT).status,
    ).toBe(400);
    expect(() => assertAppendableTurnText("just words", TURN_SUBJECT)).not.toThrow();
  });
});
