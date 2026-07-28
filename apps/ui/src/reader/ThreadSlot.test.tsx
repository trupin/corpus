/** @vitest-environment jsdom */
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
import { ThreadSlot } from "./ThreadSlot";
import { turnStamp } from "./Turns";

afterEach(cleanup);

const ROW = threadRowFixture({
  id: "th_rate",
  parent: "doc_m",
  anchorQuote: "assume a 30-year fixed at 6.1%",
  turnCount: 2,
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
  onOpenThread,
  flashing,
}: {
  readonly transport: ReaderTransport;
  readonly onOpenThread?: (id: string) => void;
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
        onOpenRef={() => undefined}
        onOpenThread={onOpenThread ?? (() => undefined)}
      />
    </harness.Wrapper>
  );
}

describe("turnStamp", () => {
  it("degrades to the raw value rather than printing Invalid Date", () => {
    expect(turnStamp("nonsense")).toBe("nonsense");
    expect(turnStamp("2026-07-01T10:05:00.000Z")).toContain("Jul");
  });
});

describe("ThreadSlot", () => {
  it("collapses to a chip naming the anchored text", () => {
    const { container } = render(<Host transport={wire()} />);
    expect(container.querySelector(".t-chip")?.textContent).toBe(
      "💬 2 · “assume a 30-year fixed at 6.1%”",
    );
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
  it("marks the thread seen on expansion, once", async () => {
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

  it("offers the thread-context link that opens the thread as a document", async () => {
    const onOpenThread = vi.fn();
    const { container } = render(<Host transport={wire()} onOpenThread={onOpenThread} />);
    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector(".t-context .ref")).not.toBeNull();
    });
    fireEvent.click(container.querySelector(".t-context .ref") as HTMLElement);
    expect(onOpenThread).toHaveBeenCalledWith("th_rate");
  });

  it("flashes and scrolls itself into view when the 💬 popover jumps to it", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    const { container } = render(<Host transport={wire()} flashing />);
    expect(container.querySelector(".thread-card.flash")).not.toBeNull();
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

  it("ships no composer — UI-008 owns the writing half", async () => {
    const { container } = render(<Host transport={wire()} />);
    fireEvent.click(container.querySelector(".t-chip") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(2);
    });
    expect(container.querySelector(".composer")).toBeNull();
    expect(container.querySelector(".turn-del")).toBeNull();
  });
});
