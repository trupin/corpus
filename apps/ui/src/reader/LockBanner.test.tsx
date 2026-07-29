/** @vitest-environment jsdom */
import type { Lock } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTransport } from "../testing/readerFixture";
import { LOCK_TICK_MS, LockBanner, lockNote } from "./LockBanner";

afterEach(cleanup);

const LOCK: Lock = {
  docId: "doc_m",
  holder: "agent",
  acquired: "2026-07-02T09:00:00.000Z",
  ttl: 300,
};

describe("lockNote", () => {
  it("states what the wire actually carries: who, and since when", () => {
    expect(lockNote(LOCK, new Date("2026-07-02T09:00:20.000Z"))).toBe(
      "holding the edit lock, started just now",
    );
    expect(lockNote(LOCK, new Date("2026-07-02T09:07:00.000Z"))).toBe(
      "holding the edit lock for 7 min",
    );
    expect(lockNote(LOCK, new Date("2026-07-02T11:00:00.000Z"))).toBe(
      "holding the edit lock for 2 h",
    );
  });

  it("degrades rather than printing NaN for an unparseable stamp", () => {
    expect(lockNote({ ...LOCK, acquired: "not a date" })).toBe("holding this document's edit lock");
  });
});

describe("LockBanner", () => {
  it("renders the sepia banner naming the holder and the read-only state", () => {
    const wire = readerTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { container } = render(<LockBanner lock={LOCK} onNotify={() => undefined} />, {
      wrapper: harness.Wrapper,
    });
    expect(container.querySelector(".lock-banner .working-dot")).not.toBeNull();
    expect(screen.getByText("agent is editing")).toBeDefined();
    expect(container.textContent).toContain("document is read-only");
  });

  /**
   * The toast's claim is the server's — the audit-trail commit — and it fires
   * on the response, never before it.
   */
  it("breaks the lock and reports what the server did", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<LockBanner lock={LOCK} onNotify={notify} />, { wrapper: harness.Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Force unlock" }));

    await waitFor(() => {
      expect(wire.of("POST", "/api/locks/doc_m/break")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    const message = notify.mock.calls[0]?.[0]?.message ?? "";
    expect(message).toContain("agent's lock on doc_m was force-released");
    expect(message).toContain("recorded in the audit trail");
  });

  /**
   * sprint-010 FIND-2: the toast used to assert "the agent's deferred edit was
   * re-queued" on every break, including breaks of locks with nothing deferred.
   * `ReleaseLockResult` carries no such field, so there is nothing to make the
   * clause conditional *on* — the copy may claim only `{docId, released,
   * holder}` and the route's documented audit commit.
   */
  it("claims nothing the response does not carry", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<LockBanner lock={LOCK} onNotify={notify} />, { wrapper: harness.Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Force unlock" }));

    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    const message = notify.mock.calls[0]?.[0]?.message ?? "";
    expect(message).not.toContain("re-queued");
    expect(message).not.toContain("deferred");
    expect(message).not.toContain("queue");
  });

  /**
   * PR #10 finding 14. The duration was computed once at mount and never again,
   * so a banner left open said "started just now" for as long as the reader was
   * on screen. Nothing else re-renders it: the `Lock` object does not change
   * while it is held.
   */
  it("keeps the held duration current as the lock goes on being held", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-02T09:00:20.000Z"));
      const wire = readerTransport();
      const harness = createCorpusTestHarness({ fetch: wire.fetch });
      const { container } = render(<LockBanner lock={LOCK} onNotify={() => undefined} />, {
        wrapper: harness.Wrapper,
      });
      expect(container.textContent).toContain("started just now");

      // `advanceTimersByTime` moves the mocked clock as well as the timers, so
      // the banner is reading a `new Date()` that really has moved on.
      act(() => {
        vi.advanceTimersByTime(7 * LOCK_TICK_MS);
      });
      expect(container.textContent).toContain("holding the edit lock for 7 min");

      act(() => {
        vi.advanceTimersByTime(113 * LOCK_TICK_MS);
      });
      expect(container.textContent).toContain("holding the edit lock for 2 h");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops ticking once the banner is gone", () => {
    vi.useFakeTimers();
    try {
      const clear = vi.spyOn(globalThis, "clearInterval");
      const wire = readerTransport();
      const harness = createCorpusTestHarness({ fetch: wire.fetch });
      const { unmount } = render(<LockBanner lock={LOCK} onNotify={() => undefined} />, {
        wrapper: harness.Wrapper,
      });
      unmount();
      expect(clear).toHaveBeenCalled();
      clear.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never claims a break that did not happen", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({ failing: { "POST /api/locks/doc_m/break": 404 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<LockBanner lock={LOCK} onNotify={notify} />, { wrapper: harness.Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Force unlock" }));

    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ tone: "error" });
    expect(notify.mock.calls[0]?.[0]?.message).toContain("Force unlock failed");
    // The banner is still there: the lock was not broken.
    expect(screen.getByRole("button", { name: "Force unlock" })).toBeDefined();
  });
});
