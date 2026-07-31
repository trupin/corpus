/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
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

/**
 * UI-030. The 💬 sheet had the ⋯ sheet's gap exactly: `role="menuitem"` buttons
 * with no way for focus to reach them. It gets the same mechanism, so it gets
 * the same evidence — including the empty case, which is where a roving-focus
 * hook handed zero items ships broken.
 */
describe("the 💬 sheet from the keyboard", () => {
  function mountWithTrigger(threads: readonly DocRow[], onSelect = vi.fn()): () => void {
    function Head(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            className="comments-btn"
            onClick={() => {
              setOpen((was) => !was);
            }}
          >
            💬
          </button>
          {open ? (
            <CommentsPopover
              threads={threads}
              onSelect={onSelect}
              onClose={() => {
                setOpen(false);
              }}
            />
          ) : null}
        </>
      );
    }
    render(<Head />);
    return onSelect;
  }

  function trigger(): HTMLElement {
    return screen.getByRole("button", { name: "💬" });
  }

  /** The `data-cp-item` of whatever has focus, or `null` when it is not an item. */
  function focusedThread(): string | null {
    const active = document.activeElement;
    return active instanceof HTMLElement ? (active.dataset["cpItem"] ?? null) : null;
  }

  it("takes focus and walks the threads with the arrows, Home and End", async () => {
    const user = userEvent.setup();
    mountWithTrigger([ANCHORED, WHOLE]);
    await user.click(trigger());
    expect(document.activeElement).toBe(
      screen.getByRole("menu", { name: "Threads on this document" }),
    );

    await user.keyboard("{ArrowDown}");
    expect(focusedThread()).toBe("th_rate");
    await user.keyboard("{ArrowDown}");
    expect(focusedThread()).toBe("th_carrier");
    await user.keyboard("{Home}");
    expect(focusedThread()).toBe("th_rate");
    await user.keyboard("{End}");
    expect(focusedThread()).toBe("th_carrier");
  });

  it("opens the focused thread on ↵, and closes", async () => {
    const user = userEvent.setup();
    const onSelect = mountWithTrigger([ANCHORED, WHOLE]);
    await user.click(trigger());
    await user.keyboard("{ArrowDown}{ArrowDown}");

    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("th_carrier");
  });

  it("closes on esc without opening a thread, and hands focus back to 💬", async () => {
    const user = userEvent.setup();
    const onSelect = mountWithTrigger([ANCHORED, WHOLE]);
    await user.click(trigger());
    await user.keyboard("{ArrowDown}");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it("degrades sanely with no threads: focus lands, nothing traps, esc still closes", async () => {
    const user = userEvent.setup();
    mountWithTrigger([]);
    await user.click(trigger());
    const menu = screen.getByRole("menu", { name: "Threads on this document" });
    expect(document.activeElement).toBe(menu);

    // Nothing to rove to, and no crash trying.
    await user.keyboard("{ArrowDown}{ArrowUp}{Home}{End}");
    expect(document.activeElement).toBe(menu);
    expect(screen.getByText(/No threads on this document yet/)).toBeDefined();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
