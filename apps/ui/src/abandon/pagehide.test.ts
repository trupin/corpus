/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { onPageHide, resetPageHide } from "./pagehide";

/**
 * The tab-close sequence's only claim: `decide` runs before `flush`, which runs
 * before `settle`, whatever order the surfaces registered in (PR #12 review,
 * MINOR 14; UI-044 for the third phase).
 *
 * Registration order is effect order, which is child-before-parent — the
 * editor's flush registers before the reader's abandon decision — so a suite
 * that registered in the "natural" order would pass against plain listeners and
 * prove nothing. Every case below registers the later phases **first**.
 */

afterEach(() => {
  resetPageHide();
});

function hide(): void {
  window.dispatchEvent(new Event("pagehide"));
}

describe("the tab-close sequence", () => {
  it("runs every decide handler before any flush handler", () => {
    const order: string[] = [];
    onPageHide("flush", () => {
      order.push("flush-a");
    });
    onPageHide("decide", () => {
      order.push("decide-a");
    });
    onPageHide("flush", () => {
      order.push("flush-b");
    });
    onPageHide("decide", () => {
      order.push("decide-b");
    });

    hide();

    expect(order).toEqual(["decide-a", "decide-b", "flush-a", "flush-b"]);
  });

  it("runs every settle handler after the last flush handler", () => {
    // UI-044: ending the edit session tells the server to acknowledge the
    // commit range *as it stands*, so it has to follow the writes.
    const order: string[] = [];
    onPageHide("settle", () => {
      order.push("settle-a");
    });
    onPageHide("flush", () => {
      order.push("flush-a");
    });
    onPageHide("decide", () => {
      order.push("decide-a");
    });
    onPageHide("settle", () => {
      order.push("settle-b");
    });

    hide();

    expect(order).toEqual(["decide-a", "flush-a", "settle-a", "settle-b"]);
  });

  it("lets a decide handler settle what a flush handler then reads", () => {
    let decided = false;
    const seen: boolean[] = [];
    onPageHide("flush", () => {
      seen.push(decided);
    });
    onPageHide("decide", () => {
      decided = true;
    });

    hide();

    // The shape of the real coupling: `isAbandoned` is false to a flush that
    // ran first, and that is the `PUT` racing a `DELETE`.
    expect(seen).toEqual([true]);
  });

  it("stops calling a handler that deregistered, and survives one that goes mid-sequence", () => {
    const kept = vi.fn();
    const dropped = vi.fn();
    const off = onPageHide("flush", dropped);
    onPageHide("decide", () => {
      off();
    });
    onPageHide("flush", kept);

    hide();

    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("holds no window listener once the last handler has gone", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const handler = vi.fn();

    const first = onPageHide("decide", handler);
    const second = onPageHide("flush", handler);
    expect(add.mock.calls.filter((call) => call[0] === "pagehide")).toHaveLength(1);

    first();
    expect(remove.mock.calls.filter((call) => call[0] === "pagehide")).toHaveLength(0);
    second();
    expect(remove.mock.calls.filter((call) => call[0] === "pagehide")).toHaveLength(1);

    hide();
    expect(handler).not.toHaveBeenCalled();

    // And a later registration re-installs it rather than going deaf.
    onPageHide("decide", handler);
    hide();
    expect(handler).toHaveBeenCalledTimes(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
