/** @vitest-environment jsdom */
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readerTransport,
  threadFixture,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture";
import { chipLabel, ThreadSlot } from "./ThreadSlot";

afterEach(() => {
  cleanup();
  resetSeenMarks();
});

const ROW = threadRowFixture({
  id: "th_rate",
  parent: "doc_m",
  anchorQuote: "assume a 30-year fixed at 6.1%",
  turnCount: 2,
  lastAuthor: "agent",
  unread: true,
});

function wire(): ReaderTransport {
  return readerTransport({
    threads: [
      threadFixture({
        id: "th_rate",
        parent: "doc_m",
        turns: [
          { author: "user", ts: "2026-07-01T10:05:00.000Z", body: "is 6.1% right?" },
          {
            author: "agent",
            ts: "2026-07-01T10:07:00.000Z",
            body: "6.4% is closer, see [[doc_r]].",
          },
        ],
      }),
    ],
  });
}

function Host({
  transport,
  flashing,
}: {
  readonly transport: ReaderTransport;
  readonly flashing?: boolean;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const [expanded, setExpanded] = useState(false);
  return (
    <harness.Wrapper>
      <ThreadSlot
        row={ROW}
        expanded={expanded}
        flashing={flashing ?? false}
        onToggle={() => {
          setExpanded(!expanded);
        }}
        onOpenDoc={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

describe("chipLabel", () => {
  it("names the turn count, the last author and resolution", () => {
    expect(chipLabel(ROW)).toBe("💬 2 · agent");
    expect(
      chipLabel(threadRowFixture({ status: "resolved", turnCount: 1, lastAuthor: "user" })),
    ).toBe("💬 1 · user · resolved");
    expect(chipLabel(threadRowFixture({ turnCount: 0, lastAuthor: null }))).toBe("💬 0 · new");
  });
});

describe("ThreadSlot", () => {
  it("collapses to a chip carrying the unread badge", () => {
    const { container } = render(<Host transport={wire()} />);
    expect(container.querySelector(".t-chip")?.textContent).toContain("💬 2 · agent");
    expect(container.querySelector(".t-chip .unread")).not.toBeNull();
    expect(container.querySelector(".thread-slot.expanded")).toBeNull();
  });

  /** A collapsed chip has displayed nothing, so it fetches nothing (SPEC.md §7, §11). */
  it("fetches the conversation only once it is expanded", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    expect(transport.of("GET", "/api/threads/th_rate")).toHaveLength(0);

    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(2);
    });
    expect(transport.of("GET", "/api/threads/th_rate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("is 6.1% right?")).toBeDefined();
  });

  /** SPEC.md §7: expanding a collapsed chip is displayed content, and marks it seen. */
  it("marks the thread seen on expansion, once per (thread, last turn)", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    expect(transport.of("POST", "/api/threads/th_rate/seen")).toHaveLength(0);

    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_rate/seen")).toHaveLength(1);
    });

    fireEvent.click(container.querySelector(".t-collapse") as HTMLElement);
    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector(".thread-slot.expanded")).not.toBeNull();
    });
    expect(transport.of("POST", "/api/threads/th_rate/seen")).toHaveLength(1);
  });

  it("flashes and scrolls itself into view when the 💬 popover jumps to it", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    const { container } = render(<Host transport={wire()} flashing />);
    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector(".thread-card.flash")).not.toBeNull();
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("says so when the conversation cannot be read", async () => {
    const transport = readerTransport({ threads: [] });
    const { container } = render(<Host transport={transport} />);
    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector("[role='alert']")).not.toBeNull();
    });
  });

  it("carries the composer and the collapse control the slot host gives it", async () => {
    const { container } = render(<Host transport={wire()} />);
    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(2);
    });
    expect(container.querySelector(".composer")).not.toBeNull();
    expect(container.querySelector(".t-collapse")?.textContent).toBe("–");
  });
});
