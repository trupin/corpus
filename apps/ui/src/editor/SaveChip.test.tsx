/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
});
