/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESERVED_SAVE_CHIP_TEXT,
  SaveChip,
  SaveStatusProvider,
  saveChipClass,
  saveChipText,
  useSaveStatusPublisher,
} from "./SaveChip.js";
import type { SaveState } from "./useAutosave.js";

/**
 * The chip's copy and classes.
 *
 * Every string here is a claim about what the server did, so each one is pinned:
 * a chip that says `committed · git ✓` when nothing was committed is the most
 * expensive kind of wrong this component can be.
 */

afterEach(cleanup);

describe("copy", () => {
  it("says nothing at rest", () => {
    expect(saveChipText({ kind: "idle" })).toBe("");
    expect(saveChipClass({ kind: "idle" })).toBe("save-chip");
  });

  it("says `saving…` while the request is on the wire", () => {
    expect(saveChipText({ kind: "saving" })).toBe("saving…");
    expect(saveChipClass({ kind: "saving" })).toBe("save-chip saving");
  });

  it("claims the commit only once the response has arrived", () => {
    const saved: SaveState = { kind: "saved", remapped: 0, orphaned: 0 };
    expect(saveChipText(saved)).toBe("committed · git ✓");
    expect(saveChipClass(saved)).toBe("save-chip saved");
  });

  it("reports remapped anchors, singular and plural", () => {
    expect(saveChipText({ kind: "saved", remapped: 1, orphaned: 0 })).toBe(
      "committed · git ✓ · 1 anchor moved",
    );
    expect(saveChipText({ kind: "saved", remapped: 3, orphaned: 0 })).toBe(
      "committed · git ✓ · 3 anchors moved",
    );
  });

  it("names an orphan rather than claiming the anchors are fine", () => {
    const text = saveChipText({ kind: "saved", remapped: 2, orphaned: 1 });
    expect(text).toBe("committed · git ✓ · 1 anchor orphaned");
    expect(text).not.toContain("anchors ✓");
    expect(text).not.toContain("moved");
  });

  it("has its own class for a failure", () => {
    const failed: SaveState = { kind: "error", message: "HTTP 500" };
    expect(saveChipText(failed)).toBe("save failed");
    expect(saveChipClass(failed)).toBe("save-chip failed");
  });
});

/**
 * The reservation (UI-135). The *width* it produces is a browser fact and is
 * asserted in `e2e/reader-head-geometry.spec.ts`; what is checkable here is
 * that the string being reserved really is the longest copy the chip can reach
 * on the ordinary path, so the box is measured against real content rather than
 * a placeholder (SPEC.md §11's third clause).
 */
describe("the reserved width", () => {
  it("is the widest string the copy can produce, and is derived from it", () => {
    expect(RESERVED_SAVE_CHIP_TEXT).toBe("committed · git ✓ · 99 anchors orphaned");
    const reachable: readonly SaveState[] = [
      { kind: "idle" },
      { kind: "saving" },
      { kind: "saved", remapped: 0, orphaned: 0 },
      { kind: "saved", remapped: 1, orphaned: 0 },
      { kind: "saved", remapped: 99, orphaned: 0 },
      { kind: "saved", remapped: 0, orphaned: 1 },
      { kind: "saved", remapped: 0, orphaned: 99 },
      { kind: "error", message: "HTTP 500" },
    ];
    for (const state of reachable) {
      expect(saveChipText(state).length).toBeLessThanOrEqual(RESERVED_SAVE_CHIP_TEXT.length);
    }
    // `— retry` is appended outside `saveChipText`, and the failure copy is
    // short enough that the suffix still fits the reserved box.
    expect("save failed — retry".length).toBeLessThanOrEqual(RESERVED_SAVE_CHIP_TEXT.length);
  });

  /**
   * The one case the box does not cover, named rather than pretended away: an
   * anchor count of three digits or more. It truncates, and the `title` below
   * is what makes truncating it honest.
   */
  it("does not pretend to cover an unbounded count", () => {
    expect(saveChipText({ kind: "saved", remapped: 0, orphaned: 128 }).length).toBeGreaterThan(
      RESERVED_SAVE_CHIP_TEXT.length,
    );
  });
});

function Publisher({ state, onRetry }: { state: SaveState; onRetry: (() => void) | null }): null {
  const publish = useSaveStatusPublisher();
  useEffect(() => {
    publish?.({ state, onRetry });
  }, [onRetry, publish, state]);
  return null;
}

function Host({
  state,
  onRetry,
}: {
  readonly state: SaveState;
  readonly onRetry?: (() => void) | null;
}): ReactElement {
  return (
    <SaveStatusProvider>
      <Publisher state={state} onRetry={onRetry ?? null} />
      <SaveChip />
    </SaveStatusProvider>
  );
}

describe("the element", () => {
  it("renders an empty chip with no provider at all", () => {
    render(<SaveChip />);
    const chip = document.querySelector("[data-save-chip]");
    expect(chip?.textContent).toBe("");
    expect(chip?.className).toBe("save-chip");
    // The element is present even when empty: the head must not reflow the
    // moment the first save lands.
    expect(chip?.tagName).toBe("SPAN");
  });

  it("shows the published state", () => {
    render(<Host state={{ kind: "saving" }} />);
    const chip = document.querySelector("[data-save-chip]");
    expect(chip?.textContent).toBe("saving…");
    expect(chip?.className).toBe("save-chip saving");
  });

  it("offers a retry after a failure and calls it", () => {
    const retry = vi.fn();
    render(<Host state={{ kind: "error", message: "HTTP 500" }} onRetry={retry} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toBe("save failed — retry");
    expect(chip.getAttribute("title")).toBe("HTTP 500");
    chip.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("stays a plain chip when a failure has no retry to offer", () => {
    render(<Host state={{ kind: "error", message: "HTTP 500" }} onRetry={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("[data-save-chip]")?.className).toBe("save-chip failed");
  });

  it("carries the reservation in every state, including the retry button", () => {
    const states: readonly SaveState[] = [
      { kind: "idle" },
      { kind: "saving" },
      { kind: "saved", remapped: 0, orphaned: 0 },
      { kind: "saved", remapped: 12, orphaned: 0 },
      { kind: "saved", remapped: 0, orphaned: 12 },
      { kind: "error", message: "HTTP 500" },
    ];
    for (const state of states) {
      render(<Host state={state} onRetry={state.kind === "error" ? vi.fn() : null} />);
      expect(document.querySelector("[data-save-chip]")?.getAttribute("data-reserve")).toBe(
        RESERVED_SAVE_CHIP_TEXT,
      );
      cleanup();
    }
  });

  it("reveals the whole of the text it may have truncated", () => {
    render(<Host state={{ kind: "saved", remapped: 0, orphaned: 128 }} />);
    const chip = document.querySelector("[data-save-chip]");
    expect(chip?.getAttribute("title")).toBe("committed · git ✓ · 128 anchors orphaned");
    expect(chip?.textContent).toBe("committed · git ✓ · 128 anchors orphaned");
  });

  it("has nothing to reveal at rest, so offers no tooltip", () => {
    render(<Host state={{ kind: "idle" }} />);
    expect(document.querySelector("[data-save-chip]")?.hasAttribute("title")).toBe(false);
  });

  it("keeps the failure's own sentence on the title rather than the chip's three words", () => {
    render(
      <Host state={{ kind: "error", message: "the server refused the save" }} onRetry={null} />,
    );
    expect(document.querySelector("[data-save-chip]")?.getAttribute("title")).toBe(
      "the server refused the save",
    );
  });
});
