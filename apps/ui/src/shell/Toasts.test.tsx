/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, TOAST_DURATION_MS, ToastProvider, useToast } from "./Toasts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Narrator(): React.ReactElement {
  const toast = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast({ tone: "info", message: `note ${String(Date.now())}` });
        }}
      >
        say
      </button>
      <button
        type="button"
        onClick={() => {
          toast({ tone: "error", message: "Reorder failed — locked" });
        }}
      >
        fail
      </button>
    </>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("narrates an act and dismisses it after the prototype's dwell", () => {
    render(
      <ToastProvider>
        <Narrator />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("say"));
    expect(document.querySelectorAll(".toast")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 1);
    });
    expect(document.querySelectorAll(".toast")).toHaveLength(0);
  });

  it("keeps at most three", () => {
    render(
      <ToastProvider>
        <Narrator />
      </ToastProvider>,
    );

    for (let index = 0; index < 5; index++) {
      fireEvent.click(screen.getByText("say"));
      act(() => {
        vi.advanceTimersByTime(2);
      });
    }
    expect(document.querySelectorAll(".toast")).toHaveLength(MAX_TOASTS);
  });

  /**
   * UI-132. The slot is the whole fix for "nothing moves": it is assigned on
   * arrival and never reassigned, so the geometry spec's boxes cannot change
   * unless one of these assertions is already wrong.
   */
  describe("reserved slots", () => {
    function slots(): string[] {
      return [...document.querySelectorAll(".toast")].map(
        (toast) => toast.getAttribute("data-slot") ?? "",
      );
    }

    function raise(times: number): void {
      for (let index = 0; index < times; index++) {
        fireEvent.click(screen.getByText("say"));
        act(() => {
          vi.advanceTimersByTime(2);
        });
      }
    }

    it("fills upward from the anchor and reads top-down in the DOM", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      raise(3);
      // Highest slot first: the DOM order is the order the stack reads.
      expect(slots()).toEqual(["2", "1", "0"]);
    });

    it("leaves the survivors in their slots when one expires", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText("say"));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      raise(2);

      expect(slots()).toEqual(["2", "1", "0"]);
      // Past the first toast's dwell and short of the other two, which were
      // raised two seconds later.
      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS - 2000);
      });
      // Slot 0 emptied; nothing was re-slotted to fill it.
      expect(slots()).toEqual(["2", "1"]);
    });

    it("gives an arriving notice the slot a dismissal freed", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      raise(2);
      const bottom = document.querySelector('.toast[data-slot="0"] .close');
      fireEvent.click(bottom as Element);
      expect(slots()).toEqual(["1"]);

      raise(1);
      expect(slots()).toEqual(["1", "0"]);
    });

    it("keeps at most three by displacing the oldest, not by shifting", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      raise(5);
      expect(document.querySelectorAll(".toast")).toHaveLength(MAX_TOASTS);
      // Every slot is still occupied exactly once.
      expect([...slots()].sort()).toEqual(["0", "1", "2"]);
    });
  });

  /**
   * UI-132's other half: a toast the person is on does not go out from under
   * them. It is not immortal — the dwell still runs, and the toast goes the
   * instant they leave — and it cannot pile up, because the cap is unchanged.
   */
  describe("a toast the person is on", () => {
    function raiseThree(): void {
      for (let index = 0; index < 3; index++) {
        fireEvent.click(screen.getByText("say"));
        act(() => {
          vi.advanceTimersByTime(2);
        });
      }
    }

    it("waits for the pointer to leave before it goes", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText("say"));
      const toast = document.querySelector(".toast") as HTMLElement;

      fireEvent.pointerOver(toast);
      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
      });
      expect(document.querySelectorAll(".toast")).toHaveLength(1);

      fireEvent.pointerOut(toast);
      expect(document.querySelectorAll(".toast")).toHaveLength(0);
    });

    it("waits for focus to leave before it goes", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText("say"));
      const close = screen.getByRole("button", { name: "Dismiss" });

      act(() => {
        close.focus();
      });
      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
      });
      expect(document.activeElement).toBe(close);
      expect(document.querySelectorAll(".toast")).toHaveLength(1);

      act(() => {
        close.blur();
      });
      expect(document.querySelectorAll(".toast")).toHaveLength(0);
    });

    it("still goes on time once the pointer has moved on", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText("say"));
      const toast = document.querySelector(".toast") as HTMLElement;

      fireEvent.pointerOver(toast);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      fireEvent.pointerOut(toast);
      expect(document.querySelectorAll(".toast")).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS);
      });
      expect(document.querySelectorAll(".toast")).toHaveLength(0);
    });

    it("is not the one displaced when the stack is full", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      raiseThree();
      // The oldest is at the anchor; park the pointer on it.
      const oldest = document.querySelector('.toast[data-slot="0"]') as HTMLElement;
      const text = oldest.textContent ?? "";
      fireEvent.pointerOver(oldest);

      fireEvent.click(screen.getByText("say"));
      expect(document.querySelectorAll(".toast")).toHaveLength(MAX_TOASTS);
      // Still there, still in slot 0: the next-oldest gave up its slot instead.
      expect(document.querySelector('.toast[data-slot="0"]')?.textContent).toBe(text);
    });
  });

  it("marks a failure differently from a confirmation", () => {
    render(
      <ToastProvider>
        <Narrator />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("fail"));
    const toast = document.querySelector(".toast");
    expect(toast?.getAttribute("data-tone")).toBe("error");
    expect(toast?.textContent).toContain("Reorder failed");
  });

  it("can be dismissed by hand", () => {
    render(
      <ToastProvider>
        <Narrator />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("say"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.querySelectorAll(".toast")).toHaveLength(0);
  });

  it("clears its timers on unmount", () => {
    const { unmount } = render(
      <ToastProvider>
        <Narrator />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("say"));
    expect(() => {
      unmount();
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    }).not.toThrow();
  });

  it("is a no-op outside a provider rather than a crash", () => {
    render(<Narrator />);
    expect(() => {
      fireEvent.click(screen.getByText("say"));
    }).not.toThrow();
  });

  /**
   * sprint-010 FIND-4. What the finding counted was `.toast-wrap` and its one
   * `.toast` child — a `[class*="toast"]` probe matches both, and their text is
   * identical because the wrapper holds exactly one item. The assertions below
   * pin the shape that makes that reading unambiguous, so a genuine double
   * mount would fail here instead of being argued about in a browser.
   */
  describe("one notice, one node", () => {
    it("renders exactly one element per notice, inside the wrapper", () => {
      render(
        <StrictMode>
          <ToastProvider>
            <Narrator />
          </ToastProvider>
        </StrictMode>,
      );

      fireEvent.click(screen.getByText("say"));

      const wraps = document.querySelectorAll(".toast-wrap");
      const toasts = document.querySelectorAll(".toast");
      expect(wraps).toHaveLength(1);
      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.parentElement).toBe(wraps[0]);
      // The count the finding reported, and why it is 2 rather than 1.
      expect(document.querySelectorAll('[class*="toast"]')).toHaveLength(2);
    });

    /**
     * A `role="status"` inside an `aria-live` region is a live region inside a
     * live region: announced by its own region and again by its ancestor. One
     * region, one announcement.
     */
    it("announces through exactly one live region", () => {
      render(
        <ToastProvider>
          <Narrator />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText("say"));

      const regions = document.querySelectorAll("[aria-live], [role='status'], [role='alert']");
      expect(regions).toHaveLength(1);
      expect(regions[0]?.className).toBe("toast-wrap");
      expect(regions[0]?.getAttribute("aria-live")).toBe("polite");
      // Additive, not re-read in full every time a toast joins the stack.
      expect(regions[0]?.getAttribute("aria-atomic")).toBe("false");
    });
  });
});
