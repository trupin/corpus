import type { OpenRequest, RevealItem } from "@corpus/kit/plugin";
import { describe, expect, it } from "vitest";
import type { TodoItem } from "../items.js";
import { itemOpenRequest, lineText } from "./reveal.js";

const item = (text: string, done = false, due?: string): TodoItem => ({
  text,
  done,
  ...(due === undefined ? {} : { due }),
});

/** The reveal an open carries, or a failure that names what came instead. */
function revealOf(request: OpenRequest): RevealItem {
  const target = request.reveal;
  if (target === undefined || target.kind !== "item") {
    throw new Error(`expected an item reveal, got ${JSON.stringify(target)}`);
  }
  return target;
}

/**
 * What the reader has on screen for a document of items: the prose above the
 * list, then one run of text per line — **markers included**, whitespace
 * collapsed, blocks joined by a single space.
 *
 * That last part is not incidental. `apps/ui`'s `indexText` flattens the
 * rendered DOM exactly this way before it searches, so this is the string the
 * frames are really matched against, and building it from {@link lineText} is
 * what makes the tests below cross the seam instead of restating the producer.
 */
function rendered(items: readonly TodoItem[]): string {
  return ["Chores that landed in the inbox.", ...items.map((entry) => lineText(entry))]
    .map((run) => run.replace(/\s+/gu, " ").trim())
    .join(" ");
}

/**
 * The reader's own occurrence rule — `chooseOccurrence` in
 * `apps/ui/src/reader/reveal.ts`, restated over the collapsed surface, with
 * **one deliberate difference**: it answers `null` when no occurrence satisfies
 * the frame, where the reader falls back to the first one.
 *
 * The fallback is right in production (a drifted frame should still flash the
 * quote rather than nothing) and it is exactly what hid this bug for a release:
 * a suffix that could never match looked identical to a suffix that matched,
 * for every document with a single occurrence. So the fallback is dropped here
 * and `null` means "this frame is unusable".
 *
 * Restated rather than imported because a plugin may not import `apps/ui`
 * (SPEC.md §10, lint-enforced) and the kit publishes no reveal matcher — the
 * gap UI-045 item 1 already tracks for `SELECTOR_CONTEXT`, one entry wider. The
 * un-copied crossing is `apps/ui/e2e/reveal.spec.ts`, which clicks the real row
 * and measures the real box.
 */
function framedOccurrence(haystack: string, target: RevealItem): number | null {
  const needle = target.exact;
  const head = (target.prefix ?? "").trim();
  const tail = (target.suffix ?? "").trim();
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  if (head === "" && tail === "") return found[0] ?? null;
  return (
    found.find(
      (at) =>
        haystack.slice(0, at).trimEnd().endsWith(head) &&
        haystack
          .slice(at + needle.length)
          .trimStart()
          .startsWith(tail),
    ) ?? null
  );
}

/** The `nth` (0-based) occurrence of `needle` in `haystack`. */
function occurrence(haystack: string, needle: string, nth: number): number {
  let at = haystack.indexOf(needle);
  for (let seen = 0; seen < nth; seen += 1) at = haystack.indexOf(needle, at + 1);
  return at;
}

describe("lineText", () => {
  it("is the item's text when it carries no deadline", () => {
    expect(lineText(item("Call the plumber"))).toBe("Call the plumber");
  });

  it("carries the inline due marker, because the rendered line does", () => {
    expect(lineText(item("Pay the bill", false, "2026-08-01"))).toBe(
      "Pay the bill (due: 2026-08-01)",
    );
  });
});

describe("itemOpenRequest", () => {
  it("names the clicked item and both of its neighbours", () => {
    const items = [item("Book the flights"), item("Call the plumber"), item("Send the form")];
    expect(itemOpenRequest("doc_week", items, 1)).toEqual({
      docId: "doc_week",
      reveal: {
        kind: "item",
        exact: "Call the plumber",
        prefix: "Book the flights",
        suffix: "Send the form",
      },
    });
  });

  it("frames the first item with what follows it and the last with what precedes it", () => {
    const items = [item("First"), item("Middle"), item("Last")];
    expect(itemOpenRequest("doc_week", items, 0).reveal).toEqual({
      kind: "item",
      exact: "First",
      suffix: "Middle",
    });
    expect(itemOpenRequest("doc_week", items, 2).reveal).toEqual({
      kind: "item",
      exact: "Last",
      prefix: "Middle",
    });
  });

  it("frames a lone item with nothing at all, and still reveals it", () => {
    expect(itemOpenRequest("doc_week", [item("Only one")], 0)).toEqual({
      docId: "doc_week",
      reveal: { kind: "item", exact: "Only one" },
    });
  });

  /**
   * sprint-023 OC4, in the shape a todo list actually produces it: `exact`
   * alone would send every one of these to the first line. The frames are what
   * make the three requests different, and each one encloses exactly one
   * occurrence — which is what the reader's `chooseOccurrence` resolves on.
   */
  it("distinguishes three identical items by their neighbours", () => {
    const items = [
      item("Call the plumber"),
      item("Book the passport appointment"),
      item("Call the plumber"),
      item("Rinse the filters"),
      item("Call the plumber"),
    ];
    expect(itemOpenRequest("doc_week", items, 0).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      suffix: "Book the passport appointment",
    });
    expect(itemOpenRequest("doc_week", items, 2).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Book the passport appointment",
      suffix: "Rinse the filters",
    });
    expect(itemOpenRequest("doc_week", items, 4).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Rinse the filters",
    });
  });

  /**
   * The frame is the line the *reader* renders above the target, and a checked
   * item is rendered. Quoting the previous **open** item instead would name a
   * line that is not adjacent on screen, and the frame would match nothing.
   */
  it("frames with a checked neighbour, because the reader renders it", () => {
    const items = [item("Send the form", true), item("Call the plumber"), item("Rinse", true)];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Send the form",
      suffix: "Rinse",
    });
  });

  /**
   * The due marker is part of the rendered line, so **both** frames have to
   * carry it — the text before the target ends with `(due: …)`, and the text
   * after the target *begins* with the target's own marker before it reaches
   * the next line at all. The target's own quote still leaves it out: it is
   * bookkeeping, and a deadline edited between the click and the open must not
   * cost the reveal.
   */
  it("quotes a deadline in both frames and never in the target", () => {
    const items = [
      item("Book the passport appointment", false, "2026-08-01"),
      item("Call the plumber", false, "2026-08-09"),
      item("Send the form", false, "2026-08-10"),
    ];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Book the passport appointment (due: 2026-08-01)",
      suffix: "(due: 2026-08-09) Send the form (due: 2026-08-10)",
    });
  });

  /**
   * The last item's frame is its own marker and nothing else — there is no line
   * below it, and the words after the quote are still the deadline.
   */
  it("frames the last item with its own deadline when it has one", () => {
    const items = [item("Send the form"), item("Call the plumber", false, "2026-08-09")];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "Send the form",
      suffix: "(due: 2026-08-09)",
    });
  });

  it("trims what it quotes, so a stray indent is not part of the frame", () => {
    const items = [item("  padded  "), item("  target  "), item("  trailing  ")];
    expect(itemOpenRequest("doc_week", items, 1).reveal).toEqual({
      kind: "item",
      exact: "target",
      prefix: "padded",
      suffix: "trailing",
    });
  });

  /**
   * A reveal that cannot name its target must not be sent: the reader would
   * search for nothing and the navigation entry would carry a dead instruction.
   * An ordinary open is the honest fallback — the document still opens.
   */
  it("sends a plain open when the position names no item", () => {
    const items = [item("Only one")];
    expect(itemOpenRequest("doc_week", items, 3)).toEqual({ docId: "doc_week" });
    expect(itemOpenRequest("doc_week", items, -1)).toEqual({ docId: "doc_week" });
    expect(itemOpenRequest("doc_week", [], 0)).toEqual({ docId: "doc_week" });
  });

  it("sends a plain open for an item with nothing quotable in it", () => {
    expect(itemOpenRequest("doc_week", [item("   ")], 0)).toEqual({ docId: "doc_week" });
  });

  it("drops a frame that is itself blank rather than quoting emptiness", () => {
    const items = [item("   "), item("Call the plumber"), item(" ")];
    expect(itemOpenRequest("doc_week", items, 1)).toEqual({
      docId: "doc_week",
      reveal: { kind: "item", exact: "Call the plumber" },
    });
  });
});

/**
 * The producer against the consumer (PR #19 review, MAJOR 1).
 *
 * Everything above says what `itemOpenRequest` *emits*. These say whether the
 * reader can act on it, which is a different question and the one that was
 * wrong: a suffix that excluded the target's own due marker could never satisfy
 * `chooseOccurrence`, and the reader's fallback to the first occurrence turned
 * that into a **confidently wrong** reveal — the second "Call the plumber"
 * clicked, the first one flashed — rather than a missing one.
 */
describe("itemOpenRequest, against what the reader does with it", () => {
  const DEADLINED: readonly TodoItem[] = [
    item("Call the plumber", false, "2026-08-09"),
    item("Book the passport appointment", false, "2026-08-01"),
    item("Call the plumber", false, "2026-08-09"),
    item("Send the form"),
  ];

  it("lands on the clicked duplicate when the target carries a deadline", () => {
    const body = rendered(DEADLINED);
    expect(framedOccurrence(body, revealOf(itemOpenRequest("doc_week", DEADLINED, 2)))).toBe(
      occurrence(body, "Call the plumber", 1),
    );
  });

  it("lands on the first duplicate when that is the one clicked", () => {
    const body = rendered(DEADLINED);
    expect(framedOccurrence(body, revealOf(itemOpenRequest("doc_week", DEADLINED, 0)))).toBe(
      occurrence(body, "Call the plumber", 0),
    );
  });

  /**
   * The same list without deadlines — the case that already worked, kept beside
   * the one that did not so a future frame change cannot fix one by breaking
   * the other.
   */
  it("lands on the clicked duplicate when nothing carries a deadline", () => {
    const plain = DEADLINED.map((entry) => item(entry.text, entry.done));
    const body = rendered(plain);
    expect(framedOccurrence(body, revealOf(itemOpenRequest("doc_week", plain, 2)))).toBe(
      occurrence(body, "Call the plumber", 1),
    );
  });

  /** A deadlined last item is framed by its own marker, and that frame resolves. */
  it("lands on a deadlined duplicate that ends the list", () => {
    const items = [
      item("Call the plumber", false, "2026-08-09"),
      item("Send the form"),
      item("Call the plumber", false, "2026-08-09"),
    ];
    const body = rendered(items);
    expect(framedOccurrence(body, revealOf(itemOpenRequest("doc_week", items, 2)))).toBe(
      occurrence(body, "Call the plumber", 1),
    );
  });

  /** Every position of a realistic list resolves to itself, deadlines and all. */
  it("resolves every item of a mixed list onto its own line", () => {
    const items = [
      item("Call the plumber", false, "2026-08-09"),
      item("Rinse the filters", true),
      item("Call the plumber"),
      item("Send the form", false, "2026-08-10"),
      item("Call the plumber", false, "2026-08-09"),
    ];
    const body = rendered(items);
    const seen = items.map((_, at) =>
      framedOccurrence(body, revealOf(itemOpenRequest("doc_week", items, at))),
    );
    // Every line found, each one distinct: no two rows point at the same words.
    expect(seen.some((at) => at === null)).toBe(false);
    expect(new Set(seen).size).toBe(items.length);
    expect(seen).toEqual([...seen].sort((left, right) => (left ?? 0) - (right ?? 0)));
  });
});
