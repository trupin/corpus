/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { useRef, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitToContent, useTitleFit } from "./useTitleFit";

afterEach(cleanup);

/**
 * UI-065. jsdom lays nothing out, so `scrollHeight` is stubbed to stand for
 * "the content is N pixels tall" — the browser half (a long title actually
 * occupying more than one line, in a column) is `render-fixes.spec.ts`.
 */

function withScrollHeight(field: HTMLTextAreaElement, height: number): void {
  Object.defineProperty(field, "scrollHeight", { configurable: true, value: height });
}

describe("fitToContent", () => {
  it("sets the field's height to its content height", () => {
    const field = document.createElement("textarea");
    withScrollHeight(field, 72);
    fitToContent(field);
    expect(field.style.height).toBe("72px");
  });

  it("releases the previous height before measuring, so a title can shrink", () => {
    const field = document.createElement("textarea");
    field.style.height = "200px";
    // The stub is read *after* the reset, so a measurement taken through a
    // stale 200px box would be the bug this asserts against.
    withScrollHeight(field, 30);
    fitToContent(field);
    expect(field.style.height).toBe("30px");
  });

  it("leaves the intrinsic height where nothing is laid out", () => {
    const field = document.createElement("textarea");
    withScrollHeight(field, 0);
    fitToContent(field);
    expect(field.style.height).toBe("auto");
  });
});

interface HostProps {
  readonly title: string;
}

function Host({ title }: HostProps): ReactElement {
  const field = useRef<HTMLTextAreaElement>(null);
  useTitleFit(field, title);
  return (
    <div>
      <textarea ref={field} className="doc-title" readOnly value={title} />
    </div>
  );
}

describe("useTitleFit", () => {
  it("fits on mount and again whenever the title changes", () => {
    const heights: string[] = [];
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.className === "doc-title" ? 24 * (heights.length + 1) : 0;
      },
    });
    try {
      const { container, rerender } = render(<Host title="Short" />);
      const field = container.querySelector<HTMLTextAreaElement>(".doc-title");
      heights.push(field?.style.height ?? "");
      rerender(<Host title="A very much longer catch-up report title — 2026-08-04" />);
      heights.push(field?.style.height ?? "");
    } finally {
      if (original !== undefined) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
      }
    }
    expect(heights).toEqual(["24px", "48px"]);
  });

  it("refits when the surrounding box is resized", () => {
    let notify: (() => void) | undefined;
    class StubResizeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(): void {
        /* the callback is all this stub needs to hand back */
      }
      disconnect(): void {
        notify = undefined;
      }
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    let content = 24;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.className === "doc-title" ? content : 0;
      },
    });
    try {
      const { container, unmount } = render(<Host title="Short" />);
      const field = container.querySelector<HTMLTextAreaElement>(".doc-title");
      expect(field?.style.height).toBe("24px");

      // The column narrowed: same text, two lines now.
      content = 48;
      notify?.();
      expect(field?.style.height).toBe("48px");

      unmount();
      expect(notify).toBeUndefined();
    } finally {
      if (original !== undefined) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
      }
      vi.unstubAllGlobals();
    }
  });

  it("does nothing where the environment has no ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    try {
      expect(() => render(<Host title="Short" />)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does nothing while the field is not mounted", () => {
    function Unbound(): ReactElement {
      const field = useRef<HTMLTextAreaElement>(null);
      useTitleFit(field, "Short");
      return <span>no field</span>;
    }
    expect(() => render(<Unbound />)).not.toThrow();
  });

  it("does nothing for a field with no parent to observe", () => {
    function Detached(): ReactElement {
      const field = useRef<HTMLTextAreaElement>(null);
      useTitleFit(field, "Short");
      // Bound to a node React never inserts, so `parentElement` is null: the
      // observer has nothing to watch and the fit still runs.
      if (field.current === null) field.current = document.createElement("textarea");
      return <span>detached</span>;
    }
    expect(() => render(<Detached />)).not.toThrow();
  });
});
