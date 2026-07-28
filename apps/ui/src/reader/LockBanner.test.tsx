/** @vitest-environment jsdom */
import type { Lock } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTransport } from "../testing/readerFixture";
import { LockBanner, lockNote } from "./LockBanner";

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
   * Both of the toast's claims are the server's — the audit-trail commit and
   * the re-queued deferred edit — so the copy only fires on the response.
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
    expect(message).toContain("recorded in the audit trail");
    expect(message).toContain("re-queued");
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
