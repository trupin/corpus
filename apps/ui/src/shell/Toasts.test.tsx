/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
