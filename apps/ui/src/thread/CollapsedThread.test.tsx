/** @vitest-environment jsdom */
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollapsedThread,
  collapsedLabel,
  summaryFromRow,
  summarySubject,
  type ThreadSummary,
} from "./CollapsedThread.js";

/**
 * What a collapsed conversation still says (SPEC.md §11).
 *
 * The line is the whole of "collapsed is never hidden", so each clause of it is
 * pinned separately: a fold that stopped naming its size would be a truncation,
 * and one that stopped naming its subject would be a conversation the reader has
 * to open to identify — which is the opposite of a focus feature.
 */

afterEach(cleanup);

function summary(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: "th_1",
    status: "open",
    turnCount: 3,
    lastAuthor: "agent",
    unread: false,
    quote: "lender spreads",
    parent: "doc_m",
    parentTitle: "Rates memo",
    ...overrides,
  };
}

describe("what the line says", () => {
  it("names the conversation's whole size, with its unit", () => {
    expect(collapsedLabel(summary())).toContain("3 turns");
    expect(collapsedLabel(summary({ turnCount: 1 }))).toContain("1 turn ");
    expect(collapsedLabel(summary({ turnCount: 0 }))).toContain("0 turns");
  });

  it("names who spoke last, and says so honestly when nobody has", () => {
    expect(collapsedLabel(summary())).toContain("· agent ·");
    expect(collapsedLabel(summary({ lastAuthor: null }))).toContain("· new ·");
  });

  it("says what it is about — the quote, or which kind of conversation it is", () => {
    expect(summarySubject(summary())).toBe("“lender spreads”");
    expect(summarySubject(summary({ quote: "" }))).toBe("whole document");
    expect(summarySubject(summary({ quote: "", parent: null }))).toBe("standalone");
  });

  it("marks a resolved conversation, and leaves an open one unmarked", () => {
    expect(collapsedLabel(summary({ status: "resolved" }))).toContain("· resolved ·");
    expect(collapsedLabel(summary())).not.toContain("resolved");
  });
});

describe("summaryFromRow", () => {
  it("is the projection's thread row, narrowed", () => {
    const row = docRowFixture({
      id: "th_2",
      type: "thread",
      status: "resolved",
      turnCount: 4,
      lastAuthor: "user",
      unread: true,
      anchorQuote: "  yield curve  ",
      parent: "doc_m",
      parentTitle: "Rates memo",
    });
    expect(summaryFromRow(row)).toEqual({
      id: "th_2",
      status: "resolved",
      turnCount: 4,
      lastAuthor: "user",
      unread: true,
      // Trimmed: the selector quotes the file, and the line quotes the words.
      quote: "yield curve",
      parent: "doc_m",
      parentTitle: "Rates memo",
    });
  });

  it("reads a row that knows nothing about turns as an empty conversation", () => {
    const row = docRowFixture({ id: "th_3", type: "thread", turnCount: null, unread: null });
    expect(summaryFromRow(row)).toMatchObject({ turnCount: 0, unread: false, quote: "" });
  });
});

describe("the control", () => {
  it("is a button that reports it is collapsed, and expands on activation", () => {
    const onExpand = vi.fn();
    render(<CollapsedThread summary={summary()} onExpand={onExpand} />);
    const line = screen.getByRole("button");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(line.getAttribute("data-thread-expand")).toBe("th_1");
    fireEvent.click(line);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows the unread badge only while something in it is unseen", () => {
    const { rerender } = render(
      <CollapsedThread summary={summary({ unread: true })} onExpand={() => undefined} />,
    );
    expect(screen.getByRole("button").querySelector(".unread")?.textContent).toBe("new");
    rerender(<CollapsedThread summary={summary()} onExpand={() => undefined} />);
    expect(screen.getByRole("button").querySelector(".unread")).toBeNull();
  });

  it("carries the resolved treatment when it is resolved", () => {
    render(
      <CollapsedThread summary={summary({ status: "resolved" })} onExpand={() => undefined} />,
    );
    expect(screen.getByRole("button").className).toBe("t-chip resolved-chip");
  });
});
