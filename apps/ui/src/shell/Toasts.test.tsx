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

  it("keeps at most three, newest first", () => {
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
