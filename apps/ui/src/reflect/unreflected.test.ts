import type { DocRow, ReflectStatus } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import {
  changeNoun,
  reflectControlLabel,
  reflectControlTitle,
  reflectedAgo,
  reflectedLabel,
  unreflectedCount,
} from "./unreflected";

const CLOCK = "2026-08-22T09:00:00.000Z";
const NOW = new Date("2026-08-22T12:00:00.000Z");

function status(overrides: Partial<ReflectStatus> = {}): ReflectStatus {
  return { reflected: CLOCK, pending: null, changed: 0, lastDigest: null, quiet: 30, ...overrides };
}

function row(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({ updated: "2026-08-22T11:00:00.000Z", ...overrides });
}

describe("unreflectedCount", () => {
  it("counts the rows written after the clock by somebody other than the agent", () => {
    const rows = [
      row({ id: "doc_after" }),
      row({ id: "doc_before", updated: "2026-08-22T08:00:00.000Z" }),
    ];
    expect(unreflectedCount(rows, CLOCK)).toBe(1);
  });

  /**
   * SPEC.md §7's amendment, signed 2026-08-22: "the agent's own writes never
   * count as unreflected — the digest and the changelog entries a reflection
   * produces are its output, not new work for it".
   *
   * This is the whole reason the count is not `rows.filter(newer than clock)`.
   */
  it("never counts the agent's own writes, however recent", () => {
    const rows = [row({ id: "doc_digest", lastActor: "agent" })];
    expect(unreflectedCount(rows, CLOCK)).toBe(0);
  });

  it("excludes archived documents, which show on no board", () => {
    expect(unreflectedCount([row({ id: "doc_gone", status: "archived" })], CLOCK)).toBe(0);
  });

  /** A corpus nobody has reflected on: everything else counts. */
  it("counts everything when there is no clock", () => {
    const rows = [row({ id: "doc_a" }), row({ id: "doc_b", updated: "2020-01-01T00:00:00.000Z" })];
    expect(unreflectedCount(rows, null)).toBe(2);
  });

  it("does not count a document whose age nothing on the wire can date", () => {
    expect(unreflectedCount([row({ id: "doc_skill", updated: null })], CLOCK)).toBe(0);
  });
});

describe("changeNoun", () => {
  it("agrees with the count", () => {
    expect(changeNoun(1)).toBe("change");
    expect(changeNoun(0)).toBe("changes");
    expect(changeNoun(12)).toBe("changes");
  });
});

describe("reflectedAgo", () => {
  it("uses the board's one spelling of an elapsed time", () => {
    expect(reflectedAgo(CLOCK, NOW)).toBe("3h");
    expect(reflectedAgo("2026-08-22T11:59:00.000Z", NOW)).toBe("just now");
  });

  it("has no phrase for a corpus never reflected on, or an unparseable clock", () => {
    expect(reflectedAgo(null, NOW)).toBeNull();
    expect(reflectedAgo("not a date", NOW)).toBeNull();
  });
});

describe("reflectedLabel", () => {
  it("says when, and says never when there is no clock", () => {
    expect(reflectedLabel(status(), NOW)).toBe("reflected 3h");
    expect(reflectedLabel(status({ reflected: null }), NOW)).toBe("never reflected");
  });
});

describe("reflectControlLabel", () => {
  it("carries the count and the clock once something has changed", () => {
    const label = reflectControlLabel(status({ changed: 2 }), NOW);
    expect(label.text).toBe("Reflect · 2 changes since 3h");
    // The number is its own piece, so the control can give it a fixed-width box.
    expect(label.count).toBe(2);
  });

  it("agrees with a single change", () => {
    expect(reflectControlLabel(status({ changed: 1 }), NOW).text).toBe(
      "Reflect · 1 change since 3h",
    );
  });

  /** A person may always ask, so the control offers it rather than going blank. */
  it("is a bare invitation when nothing has changed", () => {
    const label = reflectControlLabel(status({ changed: 0 }), NOW);
    expect(label.text).toBe("Reflect");
    expect(label.count).toBeNull();
  });

  /**
   * §7: "an ask while one is pending is answered with the pending one, never
   * doubled" — so while one is running the control reports it.
   */
  it("reports the running reflection instead of offering another", () => {
    expect(reflectControlLabel(status({ changed: 7, pending: "evt_1" }), NOW).text).toBe(
      "reflecting…",
    );
  });

  /** Nothing has arrived: the button works and claims nothing about the corpus. */
  it("claims nothing before the status has been read", () => {
    expect(reflectControlLabel(undefined, NOW).text).toBe("Reflect");
  });

  /** No clock means no "since" clause — the phrase is dropped, never invented. */
  it("drops the since clause for a corpus never reflected on", () => {
    expect(reflectControlLabel(status({ changed: 4, reflected: null }), NOW).text).toBe(
      "Reflect · 4 changes",
    );
  });
});

describe("reflectControlTitle", () => {
  it("names the quiet window that will enqueue one by itself", () => {
    expect(reflectControlTitle(status({ quiet: 45 }))).toContain("quiet for 45 minutes");
  });

  /** UI-153's acceptance criterion: a configured `quiet` of 0 says so. */
  it("says reflections are manual only when the quiet window is zero", () => {
    const title = reflectControlTitle(status({ quiet: 0 }));
    expect(title).toContain("manual only");
    expect(title).toContain("corpus reflect");
    expect(title).not.toContain("quiet for 0 minutes");
  });

  it("explains why the control is waiting while one runs", () => {
    expect(reflectControlTitle(status({ pending: "evt_1" }))).toContain("already running");
  });
});
