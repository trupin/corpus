/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { Board } from "../shell/Board";
import { ToastProvider } from "../shell/Toasts";
import { boardTransport, viewRow, type BoardTransport } from "../testing/boardFixture";
import { KeyboardHarness } from "../testing/keyboardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { COLUMN_RESIZE_STEP, MIN_COLUMN_WIDTH } from "./columnWidth";

/**
 * Dragging a column's edge, through the real board (SPEC.md §10).
 *
 * The assertions that matter are about the **wire**: one completed drag is one
 * `PUT` carrying `{ extra: { width } }` and nothing else, because `extra` is
 * merged per RFC 7386 and sending the whole object is the easy way to destroy a
 * plugin's data (sprint-016 TEST-447).
 */

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NARROW = viewRow({ id: "doc_view", title: "Inbox", order: 10 });

function renderBoard(views: readonly ReturnType<typeof viewRow>[]): BoardTransport {
  const wire = boardTransport({ views, defaultRows: [docRowFixture({ id: "doc_a" })] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ToastProvider>
          <ContextMenuProvider>
            <KeyboardHarness>{children}</KeyboardHarness>
          </ContextMenuProvider>
        </ToastProvider>
      </harness.Wrapper>
    );
  }
  render(<Board />, { wrapper: Wrapper });
  return wire;
}

async function handle(): Promise<HTMLElement> {
  return screen.findByRole("separator", { name: "Resize Inbox" });
}

function column(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.col[data-col="doc_view"]');
  if (element === null) throw new Error("no column");
  return element;
}

/**
 * jsdom ships no `PointerEvent`, so testing-library's `fireEvent.pointerDown`
 * degrades to a bare `Event` and drops `clientX` — which is the one field a
 * resize drag is made of. A `MouseEvent` typed `pointerdown` carries it and
 * React dispatches it identically (the same trick `useConsoleLayout.test.ts`
 * uses for its own drag).
 */
function drag(element: HTMLElement, from: number, to: readonly number[]): void {
  act(() => {
    fireEvent(element, new MouseEvent("pointerdown", { clientX: from, bubbles: true }));
  });
  for (const x of to) {
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: x }));
    });
  }
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", {}));
  });
}

describe("resizing a column", () => {
  it("renders the width the view document carries", async () => {
    renderBoard([viewRow({ ...NARROW, extra: { width: 480 } })]);
    await handle();
    expect(column().style.width).toBe("480px");
  });

  it("falls back to the default when the stored width is nonsense", async () => {
    renderBoard([viewRow({ ...NARROW, extra: { width: "wide" } })]);
    await handle();
    expect(column().style.width).toBe("336px");
  });

  it("follows the pointer live and writes once, on release", async () => {
    const wire = renderBoard([NARROW]);
    const element = await handle();

    drag(element, 336, [360, 400, 436]);

    expect(column().style.width).toBe("436px");
    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]?.path).toBe("/api/docs/doc_view");
    // Only the one key: `extra` is a shallow merge, and the whole object would
    // take a plugin's data with it.
    expect(wire.writes("PUT")[0]?.body).toEqual({ extra: { width: 436 } });
  });

  it("writes nothing for a drag that ends where it started", async () => {
    const wire = renderBoard([NARROW]);
    const element = await handle();

    drag(element, 336, [400, 336]);

    expect(wire.writes("PUT")).toHaveLength(0);
  });

  it("clamps at the minimum rather than letting a column vanish", async () => {
    const wire = renderBoard([NARROW]);
    const element = await handle();

    drag(element, 336, [-2000]);

    expect(column().style.width).toBe(`${String(MIN_COLUMN_WIDTH)}px`);
    await waitFor(() => {
      expect(wire.writes("PUT")[0]?.body).toEqual({ extra: { width: MIN_COLUMN_WIDTH } });
    });
  });

  it("resizes from the keyboard too, without switching columns", async () => {
    const wire = renderBoard([NARROW]);
    const element = await handle();

    act(() => {
      fireEvent.keyDown(element, { key: "ArrowRight" });
    });

    await waitFor(() => {
      expect(wire.writes("PUT")[0]?.body).toEqual({
        extra: { width: 336 + COLUMN_RESIZE_STEP },
      });
    });
    expect(column().style.width).toBe(`${String(336 + COLUMN_RESIZE_STEP)}px`);
  });

  it("widens relative to the chosen base when a document opens in it", async () => {
    renderBoard([viewRow({ ...NARROW, extra: { width: 300 } })]);
    await handle();
    expect(column().style.width).toBe("300px");

    const row = await screen.findByRole("button", { name: /Fixture document/ });
    act(() => {
      row.click();
    });

    await waitFor(() => {
      expect(document.querySelector(".reader")).not.toBeNull();
    });
    // 300 × (560/336) = 500 — its own base widened, not a fixed 560.
    expect(column().style.width).toBe("500px");
  });

  it("announces its bounds to assistive technology", async () => {
    renderBoard([viewRow({ ...NARROW, extra: { width: 480 } })]);
    const element = await handle();
    expect(element.getAttribute("aria-valuenow")).toBe("480");
    expect(element.getAttribute("aria-orientation")).toBe("vertical");
  });
});
