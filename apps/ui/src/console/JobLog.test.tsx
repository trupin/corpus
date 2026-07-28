/** @vitest-environment jsdom */
import type { JobLogView } from "@corpus/kit";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isScrolledToBottom, JobLog, PIN_THRESHOLD_PX } from "./JobLog";

/**
 * jsdom implements no layout, so `scrollHeight` and `clientHeight` are both 0
 * and `scrollTop` is a plain property. The pane's geometry is therefore stubbed
 * on the element — which is exactly the arithmetic under test; the *rendering*
 * of the scroll is the browser's job and is verified in the E2E log.
 */
function geometry(
  element: HTMLElement,
  values: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(element, "scrollHeight", { value: values.scrollHeight, writable: true });
  Object.defineProperty(element, "clientHeight", { value: values.clientHeight, writable: true });
  element.scrollTop = values.scrollTop;
}

function view(count: number, truncated = false): JobLogView {
  return {
    lines: Array.from({ length: count }, (_, index) => ({
      ts: "2026-07-27T09:12:00Z",
      line: `line ${String(index)}`,
    })),
    nextCursor: count,
    truncated,
  };
}

afterEach(cleanup);

describe("the pin predicate", () => {
  it("is true within the threshold of the bottom", () => {
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 800 - 1, clientHeight: 200 })).toBe(
      true,
    );
  });

  it("is false once the user has scrolled further than that", () => {
    expect(
      isScrolledToBottom({
        scrollHeight: 1000,
        scrollTop: 800 - PIN_THRESHOLD_PX,
        clientHeight: 200,
      }),
    ).toBe(false);
  });
});

describe("auto-scroll discipline", () => {
  it("pins to the bottom as lines arrive", () => {
    const { container, rerender } = render(<JobLog log={view(2)} />);
    const pane = container.querySelector<HTMLElement>(".job-log-lines");
    expect(pane).not.toBeNull();
    if (pane === null) return;

    geometry(pane, { scrollHeight: 400, clientHeight: 100, scrollTop: 0 });
    rerender(<JobLog log={view(3)} />);
    expect(pane.scrollTop).toBe(400);
  });

  // The failure a live log has: yanking the viewport away from something
  // somebody is reading.
  it("does not move the viewport once the user has scrolled up", () => {
    const { container, rerender } = render(<JobLog log={view(2)} />);
    const pane = container.querySelector<HTMLElement>(".job-log-lines");
    if (pane === null) throw new Error("no pane");

    geometry(pane, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 });
    fireEvent.scroll(pane);

    rerender(<JobLog log={view(3)} />);
    expect(pane.scrollTop).toBe(100);
  });

  it("re-pins when the user scrolls back to the bottom", () => {
    const { container, rerender } = render(<JobLog log={view(2)} />);
    const pane = container.querySelector<HTMLElement>(".job-log-lines");
    if (pane === null) throw new Error("no pane");

    geometry(pane, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 });
    fireEvent.scroll(pane);
    rerender(<JobLog log={view(3)} />);
    expect(pane.scrollTop).toBe(100);

    geometry(pane, { scrollHeight: 1000, clientHeight: 200, scrollTop: 800 });
    fireEvent.scroll(pane);
    rerender(<JobLog log={view(4)} />);
    expect(pane.scrollTop).toBe(1000);
  });
});

describe("rendering", () => {
  it("marks ERR lines and leaves the rest alone", () => {
    const { container } = render(
      <JobLog
        log={{
          nextCursor: 2,
          truncated: false,
          lines: [
            { ts: "2026-07-27T09:12:00Z", line: "claimed evt_9f2" },
            { ts: "2026-07-27T09:12:01Z", line: "ERR subagent timeout after 3m" },
          ],
        }}
      />,
    );
    const lines = [...container.querySelectorAll(".job-log-lines > div")];
    expect(lines.map((line) => line.className)).toEqual(["", "err"]);
  });

  it("says when the head of the buffer was dropped", () => {
    const { container } = render(<JobLog log={view(3, true)} />);
    expect(container.querySelector(".truncated")?.textContent).toBe("…truncated");
    expect(container.querySelectorAll(".job-log-lines > div")).toHaveLength(4);
  });

  it("renders nothing extra for an untruncated log", () => {
    const { container } = render(<JobLog log={view(3)} />);
    expect(container.querySelector(".truncated")).toBeNull();
  });
});
