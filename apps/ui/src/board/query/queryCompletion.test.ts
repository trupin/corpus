import { describe, expect, it } from "vitest";
import { applyQueryCompletion, detectQueryTrigger } from "./queryCompletion";

/** `text` with `|` marking the caret — the position is the whole subject here. */
function at(marked: string): { text: string; caret: number } {
  const caret = marked.indexOf("|");
  return { text: marked.replace("|", ""), caret };
}

describe("detectQueryTrigger", () => {
  it.each([
    ["|", "field", "", ""],
    ["ty|", "field", "", "ty"],
    ["type|", "field", "", "type"],
    ["type=|", "value", "type", ""],
    ["type=thr|", "value", "type", "thr"],
    ["type=thread|", "value", "type", "thread"],
    ["type=thread&|", "field", "", ""],
    ["type=thread&sta|", "field", "", "sta"],
    ["type=thread&status=op|", "value", "status", "op"],
    // A comma restarts the token: the field is still `type`, the query is what
    // follows the comma, not `note,vi`.
    ["type=note,vi|", "value", "type", "vi"],
    ["type=note,|", "value", "type", ""],
    // `q=` may hold anything, including the `=` a naive split would trip on.
    ["q=a=b|", "value", "q", "a=b"],
    // Spacing a person left behind is theirs; the token is still the word.
    [" type|", "field", "", "type"],
    ["type= thr|", "value", "type", "thr"],
  ])("reads %s as a %s trigger on %s with query %s", (marked, kind, field, query) => {
    const { text, caret } = at(marked);
    expect(detectQueryTrigger(text, caret)).toMatchObject({ kind, field, query });
  });

  it("points start at the token, not at the whitespace before it", () => {
    const { text, caret } = at("type=thread& sta|");
    const trigger = detectQueryTrigger(text, caret);
    expect(trigger?.start).toBe(text.indexOf("sta"));
    expect(trigger?.end).toBe(caret);
  });

  it("reads a caret in the middle of a query, not just at its end", () => {
    const { text, caret } = at("ty|=thread&status=open");
    expect(detectQueryTrigger(text, caret)).toMatchObject({ kind: "field", query: "ty" });
  });

  /**
   * The token, not the part in front of the caret (PR #19 review). A caret
   * dropped into the middle of a word is the ordinary way to fix a typo, and a
   * trigger that ended at the caret left the tail behind.
   */
  it.each([
    ["a field name", "ty|e=note", "type", "type=note", 5],
    ["a value", "type=no|te", "note", "type=note", 9],
    [
      "a value with another field after it",
      "type=no|te&status=open",
      "note",
      "type=note&status=open",
      9,
    ],
    ["a value after a comma", "type=note,vi|ew", "view", "type=note,view", 14],
    ["a caret at the very start of the token", "|tye=note", "type", "type=note", 5],
  ])(
    "replaces the whole token under the caret — %s",
    (_case, marked, chosen, expected, caretAfter) => {
      const { text, caret } = at(marked);
      const trigger = detectQueryTrigger(text, caret);
      expect(trigger).not.toBeNull();
      expect(applyQueryCompletion(text, trigger as never, chosen)).toEqual({
        text: expected,
        caret: caretAfter,
      });
    },
  );

  it("stops the token at the delimiter, never eating the next field", () => {
    const { text, caret } = at("ty|&status=open");
    const trigger = detectQueryTrigger(text, caret);
    expect(applyQueryCompletion(text, trigger as never, "type").text).toBe("type=&status=open");
  });

  it("leaves the spacing a person typed around the token alone", () => {
    const { text, caret } = at("ty|e = note");
    const trigger = detectQueryTrigger(text, caret);
    expect(applyQueryCompletion(text, trigger as never, "type").text).toBe("type= = note");
  });

  it("refuses a caret outside the text rather than inventing a trigger", () => {
    expect(detectQueryTrigger("type=note", -1)).toBeNull();
    expect(detectQueryTrigger("type=note", 99)).toBeNull();
  });
});

describe("applyQueryCompletion", () => {
  it("carries the `=` along when completing a field name", () => {
    const { text, caret } = at("ty|");
    const trigger = detectQueryTrigger(text, caret);
    expect(trigger).not.toBeNull();
    expect(applyQueryCompletion(text, trigger as never, "type")).toEqual({
      text: "type=",
      caret: 5,
    });
  });

  it("inserts a bare value, leaving `&` or `,` to the person", () => {
    const { text, caret } = at("type=thr|");
    const trigger = detectQueryTrigger(text, caret);
    expect(applyQueryCompletion(text, trigger as never, "thread")).toEqual({
      text: "type=thread",
      caret: 11,
    });
  });

  it("replaces only the token, keeping what follows the caret intact", () => {
    const { text, caret } = at("type=thr|&status=open");
    const trigger = detectQueryTrigger(text, caret);
    expect(applyQueryCompletion(text, trigger as never, "thread")).toEqual({
      text: "type=thread&status=open",
      caret: 11,
    });
  });

  it("completes the value after a comma without disturbing the first one", () => {
    const { text, caret } = at("type=note,vi|");
    const trigger = detectQueryTrigger(text, caret);
    expect(applyQueryCompletion(text, trigger as never, "view")).toEqual({
      text: "type=note,view",
      caret: 14,
    });
  });

  it("round-trips: what it inserts is what detection reads back", () => {
    const { text, caret } = at("|");
    const first = applyQueryCompletion(text, detectQueryTrigger(text, caret) as never, "status");
    expect(first.text).toBe("status=");
    const next = detectQueryTrigger(first.text, first.caret);
    expect(next).toMatchObject({ kind: "value", field: "status", query: "" });
    expect(applyQueryCompletion(first.text, next as never, "open").text).toBe("status=open");
  });
});
