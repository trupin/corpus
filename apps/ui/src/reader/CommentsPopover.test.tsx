/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadRowFixture } from "../testing/readerFixture";
import { CommentsPopover, threadMeta, threadQuote } from "./CommentsPopover";
import { resetEscapeLayers } from "./useEscapeStack";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const ANCHORED = threadRowFixture({
  id: "th_rate",
  anchorQuote: "assume a 30-year fixed at 6.1%",
  turnCount: 2,
  lastAuthor: "agent",
  status: "open",
});

const WHOLE = threadRowFixture({
  id: "th_carrier",
  anchorQuote: null,
  turnCount: 1,
  lastAuthor: "user",
  status: "resolved",
});

describe("threadQuote / threadMeta", () => {
  it("quotes the anchored text, and names the kind when there is none", () => {
    expect(threadQuote(ANCHORED)).toBe("“assume a 30-year fixed at 6.1%”");
    expect(threadQuote(WHOLE)).toBe("whole-document thread");
    expect(threadQuote(threadRowFixture({ anchorQuote: "   " }))).toBe("whole-document thread");
  });

  it("reads `<n> turns · last: <author> · <status>`", () => {
    expect(threadMeta(ANCHORED)).toBe("2 turns · last: agent · open");
    expect(threadMeta(WHOLE)).toBe("1 turn · last: user · resolved");
    expect(threadMeta(threadRowFixture({ turnCount: null, lastAuthor: null }))).toBe(
      "0 turns · last: — · open",
    );
  });
});

describe("CommentsPopover", () => {
  it("lists one line per thread", () => {
    render(
      <CommentsPopover
        threads={[ANCHORED, WHOLE]}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.querySelectorAll(".cp-item")).toHaveLength(2);
    expect(screen.getByText("“assume a 30-year fixed at 6.1%”")).toBeDefined();
    expect(screen.getByText("2 turns · last: agent · open")).toBeDefined();
  });

  it("says what to do instead when there are no threads", () => {
    render(<CommentsPopover threads={[]} onSelect={() => undefined} onClose={() => undefined} />);
    expect(
      screen.getByText("No threads on this document yet — select some text to start one."),
    ).toBeDefined();
  });

  it("reports the thread that was chosen", () => {
    const onSelect = vi.fn();
    render(
      <CommentsPopover threads={[ANCHORED, WHOLE]} onSelect={onSelect} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByText("whole-document thread"));
    expect(onSelect).toHaveBeenCalledWith("th_carrier");
  });

  it("closes on Escape before anything below it acts", () => {
    const onClose = vi.fn();
    render(<CommentsPopover threads={[ANCHORED]} onSelect={() => undefined} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
