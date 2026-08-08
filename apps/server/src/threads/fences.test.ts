import { describe, expect, it } from "vitest";
import { parseThreadBody } from "../core/index.js";
import { HttpError } from "../errors.js";
import { ANSWER_SUBJECT, CAPTURE_SUBJECT, TURN_SUBJECT, assertClosedFences } from "./fences.js";

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

/** The refusal, narrowed to the `bad_request` arm the guard is contracted to throw. */
const refusal = (text: string, where = TURN_SUBJECT): Refusal => {
  try {
    assertClosedFences(text, where);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.body.code !== "bad_request") {
      throw new Error(`refused as ${error.body.code}`, { cause: error });
    }
    return { status: error.status, message: error.body.message, issues: error.body.issues };
  }
  throw new Error("expected assertClosedFences to refuse");
};

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

  it("accepts a turn that quotes a fence correctly, however wide (SPEC.md §6, §11)", () => {
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
