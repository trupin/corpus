import type { InProgressSet } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../../registry/fixtures.js";
import { formatHeldFor, renderInProgress, reportInProgress } from "./in-progress.js";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function heldAgo(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

function held(
  overrides: Partial<InProgressSet["events"][number]> = {},
): InProgressSet["events"][number] {
  return {
    id: "evt_0001",
    type: "comment.created",
    heldSince: heldAgo(3 * 3600),
    originId: "doc_r8",
    originTitle: "Re: the rate assumption",
    ...overrides,
  };
}

function set(overrides: Partial<InProgressSet> = {}): InProgressSet {
  const events = overrides.events ?? [held()];
  return { events, total: events.length, truncated: false, ...overrides };
}

describe("formatHeldFor", () => {
  it("renders one significant unit up the ladder", () => {
    expect(formatHeldFor(heldAgo(0), NOW)).toBe("held 0s");
    expect(formatHeldFor(heldAgo(45), NOW)).toBe("held 45s");
    expect(formatHeldFor(heldAgo(59), NOW)).toBe("held 59s");
    expect(formatHeldFor(heldAgo(60), NOW)).toBe("held 1m");
    expect(formatHeldFor(heldAgo(12 * 60 + 40), NOW)).toBe("held 12m");
    expect(formatHeldFor(heldAgo(3600), NOW)).toBe("held 1h");
    expect(formatHeldFor(heldAgo(3 * 3600), NOW)).toBe("held 3h");
    expect(formatHeldFor(heldAgo(23 * 3600), NOW)).toBe("held 23h");
    expect(formatHeldFor(heldAgo(24 * 3600), NOW)).toBe("held 1d");
    expect(formatHeldFor(heldAgo(9 * 24 * 3600), NOW)).toBe("held 9d");
  });

  it("clamps a future instant rather than printing a negative age", () => {
    // The contract keeps `heldSince` an instant precisely so the caller uses its
    // own clock; skew between the two must not surface as `held -4m`.
    expect(formatHeldFor(heldAgo(-240), NOW)).toBe("held 0s");
  });

  it("falls back to the raw value when it is not a date at all", () => {
    expect(formatHeldFor("not-a-date", NOW)).toBe("held since not-a-date");
  });
});

describe("renderInProgress", () => {
  it("says nothing at all when nothing is held", () => {
    // The loudest requirement: this runs on every iteration of the agent loop.
    expect(renderInProgress(set({ events: [], total: 0 }), NOW)).toEqual([]);
  });

  it("states that the rows are not the batch that was just claimed", () => {
    const [header] = renderInProgress(set(), NOW);
    expect(header).toBe("the server still holds 1 event in-progress — not claimed by this call:");
  });

  it("pluralises the header on the count the server reports", () => {
    const events = [held(), held({ id: "evt_0002" })];
    expect(renderInProgress(set({ events }), NOW)[0]).toContain("holds 2 events in-progress");
  });

  it("renders one padded row per event, with the age and the origin title", () => {
    const events = [
      held(),
      held({ id: "evt_0002", type: "form.respond", heldSince: heldAgo(12 * 60) }),
      held({ id: "evt_0003", type: "doc.edited", heldSince: heldAgo(45) }),
    ];

    expect(renderInProgress(set({ events }), NOW)).toEqual([
      "the server still holds 3 events in-progress — not claimed by this call:",
      "  evt_0001  comment.created  held 3h   Re: the rate assumption",
      "  evt_0002  form.respond     held 12m  Re: the rate assumption",
      "  evt_0003  doc.edited       held 45s  Re: the rate assumption",
    ]);
  });

  it("falls back to the origin id when the document has been deleted since", () => {
    // The contract nulls the title in exactly that case; the id still tells the
    // reader which document, which a bare em dash would not.
    const events = [held({ originTitle: null })];
    expect(renderInProgress(set({ events }), NOW)[1]).toBe(
      "  evt_0001  comment.created  held 3h  doc_r8",
    );
  });

  it("shows an em dash for an event that names no document at all", () => {
    const events = [held({ originId: null, originTitle: null })];
    expect(renderInProgress(set({ events }), NOW)[1]).toBe(
      "  evt_0001  comment.created  held 3h  —",
    );
  });

  it("keeps a multi-line title on one line", () => {
    const events = [held({ originTitle: "Re: the\n  rate   assumption" })];
    expect(renderInProgress(set({ events }), NOW)[1]).toContain("Re: the rate assumption");
  });

  it("never lets a capped list read as a complete one", () => {
    const events = Array.from({ length: 20 }, (_unused, index) =>
      held({ id: `evt_${String(index).padStart(4, "0")}` }),
    );
    const lines = renderInProgress(set({ events, total: 24, truncated: true }), NOW);

    expect(lines[0]).toContain("holds 24 events in-progress");
    expect(lines).toHaveLength(22);
    expect(lines.at(-1)).toBe("  … and 4 more held, not shown (24 in total)");
  });

  it("surfaces the overflow from either half of the pair alone", () => {
    // `truncated` is what the contract says to branch on and the remainder is the
    // arithmetic that proves it; trusting one would let a server that dropped it
    // print a short list as if it were the whole set.
    const events = [held()];
    expect(renderInProgress(set({ events, total: 9, truncated: false }), NOW).at(-1)).toBe(
      "  … and 8 more held, not shown (9 in total)",
    );
    expect(renderInProgress(set({ events, total: 1, truncated: true }), NOW).at(-1)).toBe(
      "  … and 0 more held, not shown (1 in total)",
    );
  });

  it("never claims fewer held events than it goes on to list", () => {
    const events = [held(), held({ id: "evt_0002" })];
    expect(renderInProgress(set({ events, total: 0 }), NOW)[0]).toContain("holds 2 events");
  });
});

describe("reportInProgress", () => {
  it("writes the block to stderr in human mode and leaves stdout untouched", () => {
    const harness = createTestContext();

    reportInProgress(harness.context.out, set(), NOW);

    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toBe(
      "the server still holds 1 event in-progress — not claimed by this call:\n" +
        "  evt_0001  comment.created  held 3h  Re: the rate assumption\n",
    );
  });

  it("prints nothing under --json, where the set is already in the JSON value", () => {
    const harness = createTestContext({ json: true });

    reportInProgress(harness.context.out, set(), NOW);

    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toBe("");
  });

  it("prints nothing when the set is empty", () => {
    const harness = createTestContext();
    reportInProgress(harness.context.out, set({ events: [], total: 0 }), NOW);
    expect(harness.stderr()).toBe("");
  });

  it("tolerates an absent report rather than losing an already-claimed batch", () => {
    // By the time this runs the events have left `pending/`; a throw here would
    // strand work the server has already handed over.
    const harness = createTestContext();
    expect(() => {
      reportInProgress(harness.context.out, undefined, NOW);
    }).not.toThrow();
    expect(harness.stderr()).toBe("");
  });

  it("defaults to the caller's own clock", () => {
    const harness = createTestContext();
    const events = [held({ heldSince: new Date(Date.now() - 5_000).toISOString() })];

    reportInProgress(harness.context.out, set({ events }));

    expect(harness.stderr()).toContain("held 5s");
  });
});
