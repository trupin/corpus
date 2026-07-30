import { describe, expect, it } from "vitest";
import {
  appendItemToBody,
  docSource,
  dueCount,
  hasLegacyItems,
  isOverdue,
  itemProblems,
  itemsOrEmpty,
  migrateBody,
  openItems,
  parseBodyItems,
  planWrite,
  readItems,
  readLegacyItems,
  removeItemFromBody,
  resolveSelector,
  TodoItemError,
  updateItemInBody,
  type TodoItem,
} from "./items.js";

/**
 * The format owner's own tests (PLUGINS-005). Two properties carry most of the
 * weight and neither existed before this issue:
 *
 * 1. **The plugin shares the body with the user.** Everything it did not mean
 *    to touch must come back byte-identical, including a fenced code block that
 *    contains a line looking exactly like an item.
 * 2. **Body order is the order.** Per-item `ts` is gone (SHARED-005 A1(c)), so
 *    what used to be a timestamp's job is now a property of editing lines in
 *    place — which is only true if a toggle rewrites one character.
 */

const item = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  text: "Renew passport",
  done: false,
  ...overrides,
});

/** The TEST-476 document: prose, a fenced lookalike, two groups, trailing prose. */
const RICH_BODY = [
  "Some prose before the list, with trailing spaces.  ",
  "",
  "- [ ] Book the passport appointment (due: 2026-08-01)",
  "- [x] Send the signed form",
  "",
  "## Later",
  "",
  "```sh",
  "- [ ] this is an example, not an item",
  "```",
  "",
  "- [ ] Call the plumber",
  "",
  "Trailing prose.",
  "",
].join("\n");

describe("parseBodyItems", () => {
  it("reads `- [ ]` and `- [x]` lines in body order, with the inline due date", () => {
    expect(parseBodyItems(RICH_BODY)).toEqual([
      { text: "Book the passport appointment", done: false, due: "2026-08-01" },
      { text: "Send the signed form", done: true },
      { text: "Call the plumber", done: false },
    ]);
  });

  it("never reads a line inside a fenced code block as an item", () => {
    // TEST-477: a regex without fence awareness checks off an example.
    expect(parseBodyItems(RICH_BODY).map((entry) => entry.text)).not.toContain(
      "this is an example, not an item",
    );
    const tildes = "~~~\n- [ ] fenced with tildes\n~~~\n- [ ] real\n";
    expect(parseBodyItems(tildes).map((entry) => entry.text)).toEqual(["real"]);
    // A longer closing run closes; a shorter one does not.
    const nested = "````\n- [ ] still fenced\n```\n- [ ] also still fenced\n````\n- [ ] real\n";
    expect(parseBodyItems(nested).map((entry) => entry.text)).toEqual(["real"]);
  });

  it("reads GFM's other bullets and an uppercase mark, and any indent", () => {
    const body = "* [ ] star\n+ [X] plus\n  - [ ] indented\n";
    expect(parseBodyItems(body)).toEqual([
      { text: "star", done: false },
      { text: "plus", done: true },
      { text: "indented", done: false },
    ]);
  });

  it("ignores things that are not task items", () => {
    const body = [
      "- an ordinary bullet",
      "- [ ]",
      "- []nope",
      "> - [ ] quoted",
      "text - [ ] mid-line",
      "-[ ] no space",
    ].join("\n");
    expect(parseBodyItems(body)).toEqual([]);
  });

  it("survives CRLF line endings", () => {
    expect(parseBodyItems("- [ ] a\r\n- [x] b\r\n")).toEqual([
      { text: "a", done: false },
      { text: "b", done: true },
    ]);
  });
});

describe("the inline due marker", () => {
  // TEST-478, and SPEC.md:403 verbatim: "text that doesn't parse as the marker
  // is ordinary item text — never an error".
  it("is tolerant in both directions", () => {
    const body = [
      "- [ ] a (due: 2026-08-01)",
      "- [ ] b (due: not-a-date)",
      "- [ ] c (due: 2026-08-01) trailing",
      "- [ ] d",
      "- [ ] (due: 2026-08-01)",
    ].join("\n");
    expect(parseBodyItems(body)).toEqual([
      { text: "a", done: false, due: "2026-08-01" },
      { text: "b (due: not-a-date)", done: false },
      { text: "c (due: 2026-08-01) trailing", done: false },
      { text: "d", done: false },
      { text: "(due: 2026-08-01)", done: false },
    ]);
  });

  it("round-trips a `--due` date to the end of the line and back", () => {
    // TEST-479's storage half; the CLI half is verbs.test.ts.
    const body = appendItemToBody("", { text: "Renew passport", due: "2026-08-01" });
    expect(body).toBe("- [ ] Renew passport (due: 2026-08-01)\n");
    expect(parseBodyItems(body)[0]?.due).toBe("2026-08-01");
  });

  it("refuses a malformed date at the write boundary, as it always did", () => {
    expect(() => appendItemToBody("", { text: "a", due: "Friday" })).toThrow(/due/);
    expect(() => appendItemToBody("", { text: "a", due: "2026-8-1" })).toThrow(TodoItemError);
  });
});

describe("appendItemToBody", () => {
  it("writes the canonical line the spec names, nothing else", () => {
    // TEST-475: `- [ ] text`, never `* [ ]`, never an HTML input, never a
    // marker at the start of the line.
    expect(appendItemToBody("", { text: "Renew passport" })).toBe("- [ ] Renew passport\n");
  });

  it("joins the end of an existing list rather than the end of the document", () => {
    const next = appendItemToBody(RICH_BODY, { text: "New thing" });
    expect(next).toBe(
      RICH_BODY.replace("- [ ] Call the plumber\n", "- [ ] Call the plumber\n- [ ] New thing\n"),
    );
  });

  it("starts a list after the last non-empty line, with a blank line between", () => {
    expect(appendItemToBody("## Notes\n", { text: "first" })).toBe("## Notes\n\n- [ ] first\n");
  });

  it("keeps text containing checkbox-like characters in one item", () => {
    const body = appendItemToBody("", { text: "explain - [ ] syntax" });
    expect(parseBodyItems(body)).toEqual([{ text: "explain - [ ] syntax", done: false }]);
  });

  it("refuses empty text and text spanning lines", () => {
    expect(() => appendItemToBody("", { text: "" })).toThrow(/text/);
    expect(() => appendItemToBody("", { text: "two\nlines" })).toThrow(/single line/);
  });
});

describe("updateItemInBody", () => {
  it("changes exactly one character to check an item", () => {
    // TEST-476, the failure that loses user work rather than merely looking
    // wrong: everything the plugin did not touch is byte-identical.
    const next = updateItemInBody(RICH_BODY, 2, { done: true });
    const before = RICH_BODY.split("\n");
    const after = next.split("\n");
    const changed = after.filter((line, at) => line !== before[at]);
    expect(changed).toEqual(["- [x] Call the plumber"]);
    expect(after).toHaveLength(before.length);
  });

  it("keeps a due marker's own spacing when only `done` changes", () => {
    const body = "- [ ] a  (due: 2026-08-01)\n";
    expect(updateItemInBody(body, 0, { done: true })).toBe("- [x] a  (due: 2026-08-01)\n");
  });

  it("preserves indentation, bullet, inner spacing and trailing whitespace", () => {
    const body = "  *   [ ]   spaced out   \n";
    expect(updateItemInBody(body, 0, { done: true })).toBe("  *   [x]   spaced out   \n");
  });

  it("keeps an uppercase mark when the item stays done", () => {
    expect(updateItemInBody("- [X] a\n", 0, { text: "b" })).toBe("- [X] b\n");
    expect(updateItemInBody("- [X] a\n", 0, { done: false })).toBe("- [ ] a\n");
  });

  it("renames in place and re-renders the due marker canonically", () => {
    expect(updateItemInBody("- [ ] a (due: 2026-08-01)\n", 0, { text: "b" })).toBe(
      "- [ ] b (due: 2026-08-01)\n",
    );
  });

  it("sets, keeps and clears `due`", () => {
    const dated = updateItemInBody("- [ ] a\n", 0, { due: "2026-08-01" });
    expect(dated).toBe("- [ ] a (due: 2026-08-01)\n");
    expect(updateItemInBody(dated, 0, { done: true })).toBe("- [x] a (due: 2026-08-01)\n");
    expect(updateItemInBody(dated, 0, { due: null })).toBe("- [ ] a\n");
  });

  it("leaves the order alone through check, uncheck and rename", () => {
    // TEST-481: what per-item `ts` used to protect is now a property of
    // editing a line in place.
    const body = "- [ ] one\n- [ ] two\n- [ ] three\n";
    const checked = updateItemInBody(body, 1, { done: true });
    const unchecked = updateItemInBody(checked, 1, { done: false });
    const renamed = updateItemInBody(unchecked, 1, { text: "second" });
    expect(unchecked).toBe(body);
    expect(parseBodyItems(renamed).map((entry) => entry.text)).toEqual(["one", "second", "three"]);
  });

  it("refuses an out-of-range index with a readable message", () => {
    expect(() => updateItemInBody("- [ ] a\n", 5, { done: true })).toThrow(/out of range/);
    expect(() => updateItemInBody("- [ ] a\n", -1, { done: true })).toThrow(/has 1 item/);
    try {
      updateItemInBody("- [ ] a\n", 5, { done: true });
    } catch (error) {
      expect((error as TodoItemError).status).toBe(400);
    }
  });

  it("refuses with 409 when the item at that index changed under the caller", () => {
    try {
      updateItemInBody("- [ ] a\n", 0, { done: true, expectedText: "something else" });
      expect.unreachable("the guard must throw");
    } catch (error) {
      expect((error as TodoItemError).status).toBe(409);
      expect((error as TodoItemError).message).toContain("changed under you");
    }
    expect(updateItemInBody("- [ ] a\n", 0, { done: true, expectedText: "a" })).toBe("- [x] a\n");
  });

  it("refuses a rename to empty text or across lines", () => {
    expect(() => updateItemInBody("- [ ] a\n", 0, { text: "" })).toThrow(/text/);
    expect(() => updateItemInBody("- [ ] a\n", 0, { text: "x\ny" })).toThrow(/single line/);
  });
});

describe("removeItemFromBody", () => {
  it("removes one line and keeps every other byte", () => {
    const next = removeItemFromBody(RICH_BODY, 1);
    expect(next).toBe(RICH_BODY.replace("- [x] Send the signed form\n", ""));
  });

  it("honours the same concurrency guard and the same range check", () => {
    expect(() => removeItemFromBody(RICH_BODY, 1, "wrong")).toThrow(/changed under you/);
    expect(() => removeItemFromBody(RICH_BODY, 9)).toThrow(/out of range/);
  });
});

describe("readItems", () => {
  it("answers an empty list for a document with no items anywhere", () => {
    expect(readItems(undefined)).toEqual({ ok: true, items: [] });
    expect(readItems({ body: "## Notes\n" })).toEqual({ ok: true, items: [] });
    expect(readItems({ body: "", extra: {} })).toEqual({ ok: true, items: [] });
  });

  it("prefers the body whenever it carries task lines", () => {
    const read = readItems({
      body: "- [ ] from the body\n",
      extra: { items: [{ text: "from frontmatter", done: false, ts: "2026-07-20T09:00:00.000Z" }] },
    });
    expect(read).toEqual({ ok: true, items: [{ text: "from the body", done: false }] });
  });

  it("falls back to a not-yet-migrated document's `items` key, dropping `ts`", () => {
    const read = readItems({
      body: "## Notes\n",
      extra: {
        items: [
          { text: "a", done: true, ts: "2026-07-20T09:00:00.000Z", due: "2026-08-01" },
          { text: "b", done: false, ts: "2026-07-20T09:00:00.000Z" },
        ],
      },
    });
    expect(read).toEqual({
      ok: true,
      items: [
        { text: "a", done: true, due: "2026-08-01" },
        { text: "b", done: false },
      ],
    });
  });

  it("treats a present-but-empty legacy key as an empty list", () => {
    expect(readItems({ body: "", extra: { items: null } })).toEqual({ ok: true, items: [] });
    expect(readItems({ body: "", extra: { items: [] } })).toEqual({ ok: true, items: [] });
  });

  it("reports a legacy key it cannot parse, naming the offending field", () => {
    expect(readItems({ extra: { items: "nope" } })).toEqual({
      ok: false,
      problems: ["items: must be a list of items; found string"],
    });
    const read = readItems({ extra: { items: [{ text: "a", done: false }, { text: "b" }] } });
    expect((read.ok ? [] : read.problems).join("; ")).toContain("items[1].done");
  });

  it("reports a malformed legacy key even when the body has items", () => {
    // A write refuses this document, so a read that quietly showed the body
    // would leave the refusal unexplained.
    expect(readItems({ body: "- [ ] a\n", extra: { items: 7 } }).ok).toBe(false);
  });
});

describe("itemsOrEmpty, itemProblems and docSource", () => {
  it("degrades a malformed document to no items, for list surfaces", () => {
    expect(itemsOrEmpty({ extra: { items: "nope" } })).toEqual([]);
    expect(itemsOrEmpty({ body: "- [ ] a\n" })).toEqual([{ text: "a", done: false }]);
  });

  it("answers the manifest's `validate` with problems, empty when nothing is wrong", () => {
    expect(itemProblems({ body: "- [ ] a\n" })).toEqual([]);
    expect(itemProblems({ extra: { items: "nope" } })).not.toEqual([]);
  });

  it("reads a whole document's body and its legacy key together", () => {
    const doc = { body: "- [ ] a\n", frontmatter: { extra: { items: [] } } };
    expect(docSource(doc)).toEqual({ body: "- [ ] a\n", extra: { items: [] } });
    expect(itemsOrEmpty(docSource(doc))).toEqual([{ text: "a", done: false }]);
  });
});

describe("migration", () => {
  const legacy = [
    { text: "a", done: false, ts: "2026-07-20T09:00:00.000Z", due: "2026-08-01" },
    { text: "b - [ ] tricky", done: true, ts: "2026-07-20T09:00:00.000Z" },
  ];

  it("recognises the legacy key, including when its value is null", () => {
    expect(hasLegacyItems(undefined)).toBe(false);
    expect(hasLegacyItems({})).toBe(false);
    expect(hasLegacyItems({ items: null })).toBe(true);
    expect(readLegacyItems({})).toBeNull();
  });

  it("moves every item into the body, preserving order, `done`, `due` and odd text", () => {
    // TEST-487: nothing lost, in any order of operations.
    const plan = planWrite({ body: "## Notes\n", extra: { items: legacy } }, "doc_x");
    expect(plan.clearLegacy).toBe(true);
    expect(plan.body).toBe("## Notes\n\n- [ ] a (due: 2026-08-01)\n- [x] b - [ ] tricky\n");
    expect(parseBodyItems(plan.body)).toEqual([
      { text: "a", done: false, due: "2026-08-01" },
      { text: "b - [ ] tricky", done: true },
    ]);
  });

  it("is a no-op for a document that never carried the key", () => {
    expect(planWrite({ body: "- [ ] a\n" }, "doc_x")).toEqual({
      body: "- [ ] a\n",
      clearLegacy: false,
    });
  });

  it("clears an empty legacy key without touching the body", () => {
    expect(planWrite({ body: "- [ ] a\n", extra: { items: [] } }, "doc_x")).toEqual({
      body: "- [ ] a\n",
      clearLegacy: true,
    });
  });

  it("refuses a legacy key it could not parse, rather than writing over it", () => {
    expect(() => planWrite({ body: "", extra: { items: "nope" } }, "doc_x")).toThrow(
      /doc_x has malformed items and was not written/,
    );
  });

  it("refuses a document carrying items in both places rather than guessing", () => {
    expect(() => planWrite({ body: "- [ ] a\n", extra: { items: legacy } }, "doc_x")).toThrow(
      /items in its body \*and\* in its `items` frontmatter/,
    );
  });

  it("appends to an empty body without a leading blank line", () => {
    expect(migrateBody("", [item({ text: "a" })])).toBe("- [ ] a\n");
  });
});

describe("resolveSelector", () => {
  const list = [item({ text: "Renew passport" }), item({ text: "Call plumber" })];

  it("accepts a 1-based number and returns a 0-based index", () => {
    expect(resolveSelector(list, "1")).toBe(0);
    expect(resolveSelector(list, " 2 ")).toBe(1);
  });

  it("accepts text, case-insensitively", () => {
    expect(resolveSelector(list, "renew PASSPORT")).toBe(0);
  });

  it("refuses a number outside the list", () => {
    expect(() => resolveSelector(list, "0")).toThrow(/has 2 items/);
    expect(() => resolveSelector(list, "3")).toThrow(/has 2 items/);
    expect(() => resolveSelector([item()], "5")).toThrow(/has 1 item/);
  });

  it("refuses text that matches nothing", () => {
    expect(() => resolveSelector(list, "nothing")).toThrow(/no item matches/);
  });

  it("refuses duplicate text and names the candidate numbers", () => {
    const dupes = [item({ text: "milk" }), item({ text: "bread" }), item({ text: "Milk" })];
    expect(() => resolveSelector(dupes, "milk")).toThrow(/matches 2 items \(1, 3\)/);
  });
});

describe("derivations", () => {
  const list = [
    item({ text: "a" }),
    item({ text: "b", done: true, due: "2026-07-01" }),
    item({ text: "c", due: "2026-07-25" }),
    item({ text: "d", due: "2026-07-10" }),
  ];

  it("counts open items and open items with a deadline", () => {
    expect(openItems(list).map((entry) => entry.text)).toEqual(["a", "c", "d"]);
    expect(dueCount(list)).toBe(2);
    expect(dueCount([])).toBe(0);
  });

  it("calls an open item overdue only once its date has passed", () => {
    const today = new Date("2026-07-20T12:00:00.000Z");
    expect(isOverdue(item({ due: "2026-07-10" }), today)).toBe(true);
    expect(isOverdue(item({ due: "2026-07-20" }), today)).toBe(false);
    expect(isOverdue(item({ due: "2026-07-25" }), today)).toBe(false);
    // A completed item is never overdue, and neither is one with no deadline.
    expect(isOverdue(item({ due: "2026-07-10", done: true }), today)).toBe(false);
    expect(isOverdue(item(), today)).toBe(false);
  });
});
