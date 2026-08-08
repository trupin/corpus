import type { Thread } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  isPendingTurn,
  mergePendingTurns,
  PendingTurnStore,
  type PendingTurn,
} from "./pendingTurns.js";

const thread = (turns: readonly { author: "user" | "agent"; ts: string; body: string }[]): Thread =>
  ({ id: "th_a", turns }) as unknown as Thread;

const pending = (ts: string, body = "Mine."): PendingTurn => ({
  author: "user",
  ts,
  body,
  model: null,
  pending: true,
  clientId: `c-${ts}`,
});

describe("isPendingTurn", () => {
  it("tells a provisional turn from a confirmed one", () => {
    expect(isPendingTurn(pending("2026-07-27T10:00:00Z"))).toBe(true);
    expect(
      isPendingTurn({ author: "user", ts: "2026-07-27T10:00:00Z", body: "x", model: null }),
    ).toBe(false);
  });
});

describe("mergePendingTurns", () => {
  it("appends a provisional turn the server has not confirmed yet", () => {
    const merged = mergePendingTurns(
      thread([{ author: "agent", ts: "2026-07-27T09:00:00Z", body: "First." }]),
      [pending("2026-07-27T10:00:00Z")],
    );
    expect(merged.turns).toHaveLength(2);
    expect(isPendingTurn(merged.turns[1] as PendingTurn)).toBe(true);
  });

  // Turn timestamps are unique and monotonic within a thread (SPEC.md §6), so a
  // confirmed turn by the same author at or after the provisional's timestamp
  // *is* the provisional one, and keeping both would show it twice.
  it("drops a provisional turn the server has since confirmed", () => {
    const merged = mergePendingTurns(
      thread([
        { author: "agent", ts: "2026-07-27T09:00:00Z", body: "First." },
        { author: "user", ts: "2026-07-27T10:00:01Z", body: "Mine." },
      ]),
      [pending("2026-07-27T10:00:00Z")],
    );
    expect(merged.turns).toHaveLength(2);
    expect(merged.turns.some(isPendingTurn)).toBe(false);
  });

  it("does not treat another author's later turn as confirmation", () => {
    const merged = mergePendingTurns(
      thread([{ author: "agent", ts: "2026-07-27T11:00:00Z", body: "Reply." }]),
      [pending("2026-07-27T10:00:00Z")],
    );
    expect(merged.turns.some(isPendingTurn)).toBe(true);
  });

  /**
   * PR #10 finding 19. Two appends in flight: the server stamps the first with
   * a time later than the second provisional's client-side stamp, so a plain
   * "any confirmed turn at or after" test matched both and the second turn
   * blinked out of the conversation until its own response landed.
   */
  describe("two appends in flight", () => {
    const first = pending("2026-07-27T10:00:00Z", "One.");
    const second = pending("2026-07-27T10:00:01Z", "Two.");

    it("keeps the second one visible when only the first has been confirmed", () => {
      const merged = mergePendingTurns(
        thread([
          { author: "agent", ts: "2026-07-27T09:00:00Z", body: "First." },
          // The server's stamp for `first`, later than `second`'s client stamp.
          { author: "user", ts: "2026-07-27T10:00:02Z", body: "One." },
        ]),
        [first, second],
      );
      const provisional = merged.turns.filter(isPendingTurn);
      expect(provisional).toHaveLength(1);
      expect(provisional[0]?.body).toBe("Two.");
    });

    it("drops both once both have been confirmed", () => {
      const merged = mergePendingTurns(
        thread([
          { author: "user", ts: "2026-07-27T10:00:02Z", body: "One." },
          { author: "user", ts: "2026-07-27T10:00:03Z", body: "Two." },
        ]),
        [first, second],
      );
      expect(merged.turns.some(isPendingTurn)).toBe(false);
      expect(merged.turns).toHaveLength(2);
    });
  });

  it("returns the thread itself when there is nothing pending", () => {
    const original = thread([{ author: "agent", ts: "2026-07-27T09:00:00Z", body: "First." }]);
    expect(mergePendingTurns(original, [])).toBe(original);
  });
});

describe("PendingTurnStore", () => {
  it("keeps turns per thread and forgets them by client id", () => {
    const store = new PendingTurnStore();
    const one = pending("2026-07-27T10:00:00Z", "one");
    const two = pending("2026-07-27T10:00:01Z", "two");
    store.add("th_a", one);
    store.add("th_a", two);
    store.add("th_b", pending("2026-07-27T10:00:02Z", "elsewhere"));

    expect(store.list("th_a")).toHaveLength(2);
    expect(store.list("th_b")).toHaveLength(1);
    expect(store.list("th_missing")).toEqual([]);

    store.remove("th_a", one.clientId);
    expect(store.list("th_a")).toEqual([two]);
    store.remove("th_a", two.clientId);
    expect(store.list("th_a")).toEqual([]);
  });

  it("ignores a removal that names nothing it holds", () => {
    const store = new PendingTurnStore();
    store.add("th_a", pending("2026-07-27T10:00:00Z"));
    store.remove("th_a", "not-a-client-id");
    expect(store.list("th_a")).toHaveLength(1);
  });
});
