/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  escapeLayerCount,
  EscapeLayerPriority,
  resetEscapeLayers,
  topLayer,
  useEscapeLayer,
} from "./useEscapeStack";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

function Layer({
  active = true,
  priority,
  onEscape,
}: {
  readonly active?: boolean;
  readonly priority: number;
  readonly onEscape: (event: KeyboardEvent) => void;
}): null {
  useEscapeLayer({ active, priority, onEscape });
  return null;
}

function pressEscape(): void {
  fireEvent.keyDown(document, { key: "Escape" });
}

describe("topLayer", () => {
  it("prefers the higher priority, then the later registration", () => {
    const noop = (): void => undefined;
    const layers = [
      { seq: 0, priority: 0, handler: noop },
      { seq: 1, priority: 20, handler: noop },
      { seq: 2, priority: 20, handler: noop },
      { seq: 3, priority: 10, handler: noop },
    ];
    expect(topLayer(layers)?.seq).toBe(2);
    expect(topLayer([])).toBeNull();
  });
});

describe("useEscapeLayer", () => {
  /** SPEC.md §10: "overlays and focus mode take precedence, then the column reader". */
  it("closes a menu, then focus mode, then the column reader", () => {
    const closed: string[] = [];
    function App({ menu, focus }: { readonly menu: boolean; readonly focus: boolean }) {
      return (
        <>
          <Layer priority={EscapeLayerPriority.Reader} onEscape={() => closed.push("reader")} />
          <Layer
            active={focus}
            priority={EscapeLayerPriority.Focus}
            onEscape={() => closed.push("focus")}
          />
          <Layer
            active={menu}
            priority={EscapeLayerPriority.Popover}
            onEscape={() => closed.push("menu")}
          />
        </>
      );
    }

    const view = render(<App menu focus />);
    pressEscape();
    expect(closed).toEqual(["menu"]);

    view.rerender(<App menu={false} focus />);
    pressEscape();
    expect(closed).toEqual(["menu", "focus"]);

    view.rerender(<App menu={false} focus={false} />);
    pressEscape();
    expect(closed).toEqual(["menu", "focus", "reader"]);
  });

  it("registers nothing while a layer is closed", () => {
    render(
      <Layer active={false} priority={EscapeLayerPriority.Reader} onEscape={() => undefined} />,
    );
    expect(escapeLayerCount()).toBe(0);
    // No handler, no listener, and nothing to swallow the key.
    expect(() => {
      pressEscape();
    }).not.toThrow();
  });

  it("unregisters on unmount, so a closed surface never consumes the key", () => {
    const onEscape = vi.fn();
    const view = render(<Layer priority={EscapeLayerPriority.Focus} onEscape={onEscape} />);
    expect(escapeLayerCount()).toBe(1);
    view.unmount();
    expect(escapeLayerCount()).toBe(0);
    pressEscape();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("ignores every other key", () => {
    const onEscape = vi.fn();
    render(<Layer priority={EscapeLayerPriority.Reader} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  /** SPEC.md §10's keyboard scheme names both: "`esc`/`⌫` close/back". */
  it("takes Backspace as well as Escape", () => {
    const onEscape = vi.fn();
    render(<Layer priority={EscapeLayerPriority.Reader} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  /**
   * The listener is on the capture phase, so without this guard it would take
   * Escape from a field before that field's own "revert my draft" handler saw
   * it — and `⌫` would close the reader instead of deleting a character.
   */
  it("keeps its hands off whatever the user is typing in", () => {
    const onEscape = vi.fn();
    render(
      <>
        <Layer priority={EscapeLayerPriority.Reader} onEscape={onEscape} />
        <input aria-label="Document title" />
        <div contentEditable data-editor />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Document title"), { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("Document title"), { key: "Backspace" });
    expect(onEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(document.querySelector("[data-editor]") as HTMLElement, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  /**
   * The other half of that guard: a control inside the editor is not the
   * editor.
   *
   * A thread chip is rendered into an `anchor-slot` — a `contenteditable=false`
   * island *inside* the document's contenteditable — so every button on an
   * expanded card has an editable ancestor and none of them is editable. Asking
   * only whether some ancestor is editable answered "the user is typing" for
   * the armed delete button, and Escape was dropped before the chain saw it
   * (UI-008 FAIL-1).
   */
  it("treats a control inside a contenteditable=false island as not typing", () => {
    const onEscape = vi.fn();
    render(
      <>
        <Layer priority={EscapeLayerPriority.Popover} onEscape={onEscape} />
        <div contentEditable suppressContentEditableWarning data-editor>
          <div contentEditable={false} data-slot>
            <button type="button">delete?</button>
            <textarea aria-label="Reply" />
          </div>
        </div>
      </>,
    );

    fireEvent.keyDown(screen.getByRole("button"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);

    // A field inside the same island still keeps the key: the nearest editable
    // host is what decides, and there it is the textarea.
    fireEvent.keyDown(screen.getByLabelText("Reply"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("hands the layer the event, so a modified press can mean something else", () => {
    const onEscape = vi.fn<(event: KeyboardEvent) => void>();
    render(<Layer priority={EscapeLayerPriority.Reader} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape", shiftKey: true });
    expect(onEscape.mock.calls[0]?.[0]?.shiftKey).toBe(true);
  });

  /**
   * Registration order is z-order. A layer that re-registered on every render —
   * and a reader re-renders on every scroll — would keep jumping to the top of
   * the chain and start swallowing Escape from the overlay above it.
   */
  it("does not re-register when only its handler changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    function App({ handler }: { readonly handler: (event: KeyboardEvent) => void }) {
      return (
        <>
          <Layer priority={EscapeLayerPriority.Reader} onEscape={handler} />
          <Layer priority={EscapeLayerPriority.Focus} onEscape={second} />
        </>
      );
    }
    const view = render(<App handler={first} />);
    const rerendered = vi.fn();
    view.rerender(<App handler={rerendered} />);

    pressEscape();
    // Focus still wins, and the reader's *current* handler is the one it holds.
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(rerendered).not.toHaveBeenCalled();
    expect(escapeLayerCount()).toBe(2);
  });
});
