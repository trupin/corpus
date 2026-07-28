import { describe, expect, it } from "vitest";
import { applyCompletion, completionText, detectTrigger } from "./triggers.js";

describe("detectTrigger", () => {
  it("opens at the start of a line and after a space", () => {
    expect(detectTrigger("@", 1)).toMatchObject({ kind: "mention", query: "" });
    expect(detectTrigger("ask @res", 8)).toMatchObject({ kind: "mention", query: "res" });
    expect(detectTrigger("/com", 4)).toMatchObject({ kind: "skill", query: "com" });
    expect(detectTrigger("see [[rate", 10)).toMatchObject({ kind: "ref", query: "rate" });
  });

  /** The server's boundary rule, restated: an address is not a mention (§8). */
  it.each([
    ["me@agent.example", 8],
    ["a@agentb", 8],
    ["path/comment", 12],
    ["https://x/comment", 17],
  ])("does not fire mid-token in %s", (text, caret) => {
    expect(detectTrigger(text, caret)).toBeNull();
  });

  it("does not fire on an escaped sigil", () => {
    expect(detectTrigger("\\@agent", 7)).toBeNull();
    expect(detectTrigger("\\[[doc", 6)).toBeNull();
    // An escaped backslash is not an escape.
    expect(detectTrigger("\\\\@ag", 5)).toMatchObject({ kind: "mention", query: "ag" });
  });

  it("closes once the token leaves the charset the server accepts", () => {
    // A space ends a mention token; the run is no longer a completion target.
    expect(detectTrigger("@agent now", 10)).toBeNull();
    // A ref query may hold spaces, because titles do.
    expect(detectTrigger("[[mortgage options", 18)).toMatchObject({ query: "mortgage options" });
    // …but not a closing bracket: the ref is already written.
    expect(detectTrigger("[[doc_a]] and", 13)).toBeNull();
  });

  it("prefers the trigger nearest the caret", () => {
    // A slash inside a ref query is part of the query, not an invocation.
    expect(detectTrigger("[[notes/rates", 13)).toMatchObject({ kind: "ref" });
  });

  it("reports the run it would replace", () => {
    expect(detectTrigger("hi @res", 7)).toMatchObject({ start: 3, end: 7 });
  });
});

describe("completions", () => {
  it("inserts the sigil form per kind", () => {
    expect(completionText("mention", "researcher")).toBe("@researcher");
    expect(completionText("skill", "comment")).toBe("/comment");
    expect(completionText("ref", "doc_a1")).toBe("[[doc_a1]]");
  });

  it("replaces the trigger run and leaves the caret after a trailing space", () => {
    const trigger = detectTrigger("ask @res about it", 8);
    expect(trigger).not.toBeNull();
    const result = applyCompletion("ask @res about it", trigger!, "researcher");
    // No doubled space: one already follows.
    expect(result.text).toBe("ask @researcher about it");
    expect(result.caret).toBe("ask @researcher".length);
  });

  it("adds the separating space when it is completing at the end", () => {
    const trigger = detectTrigger("ask @res", 8);
    expect(applyCompletion("ask @res", trigger!, "researcher").text).toBe("ask @researcher ");
  });

  it("writes an id, never a title, for a ref", () => {
    const trigger = detectTrigger("see [[rate", 10);
    const result = applyCompletion("see [[rate", trigger!, "doc_r1");
    expect(result.text).toBe("see [[doc_r1]] ");
  });
});
