/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage";
import {
  CONSOLE_RESIZE_STEP,
  CONSOLE_STORAGE_KEY,
  DEFAULT_CONSOLE_HEIGHT,
  DEFAULT_CONSOLE_STATE,
  MIN_CONSOLE_HEIGHT,
  clampConsoleHeight,
  readConsoleState,
  useConsoleLayout,
  writeConsoleState,
} from "./useConsoleLayout";

/** jsdom's default viewport, so `60vh` is a number the assertions can name. */
const VIEWPORT = 768;
const MAX = VIEWPORT * 0.6;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * jsdom implements no `PointerEvent`, and the drag only ever reads `clientY` —
 * so a `MouseEvent` under the pointer event's name is the same event as far as
 * the listener is concerned.
 */
function pointerMove(clientY: number): MouseEvent {
  return new MouseEvent("pointermove", { clientY });
}

describe("clamping", () => {
  it("stops at 120px on the way down", () => {
    expect(clampConsoleHeight(10, VIEWPORT)).toBe(MIN_CONSOLE_HEIGHT);
  });

  it("stops at 60vh on the way up", () => {
    expect(clampConsoleHeight(5000, VIEWPORT)).toBe(MAX);
  });

  it("passes a height inside the band through untouched", () => {
    expect(clampConsoleHeight(210, VIEWPORT)).toBe(210);
  });

  // A window shorter than 200px would otherwise clamp the drawer *below* its own
  // minimum and squeeze the board to nothing; the floor wins.
  it("keeps the floor above the ceiling in a tiny window", () => {
    expect(clampConsoleHeight(300, 100)).toBe(MIN_CONSOLE_HEIGHT);
  });

  it("falls back to the default for a non-finite height", () => {
    expect(clampConsoleHeight(Number.NaN, VIEWPORT)).toBe(DEFAULT_CONSOLE_HEIGHT);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    writeConsoleState({ open: true, height: 260 }, storage);
    expect(readConsoleState(storage)).toEqual({ open: true, height: 260 });
  });

  it("stores nothing but the two local facts", () => {
    const storage = memoryStorage();
    writeConsoleState({ open: true, height: 260 }, storage);
    expect(JSON.parse(storage.getItem(CONSOLE_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      open: true,
      height: 260,
    });
  });

  it.each([
    ["garbage", "{not json"],
    ["a non-object", '"210"'],
    ["null", "null"],
    ["a blob from another version", JSON.stringify({ version: 99, open: true, height: 900 })],
  ])("falls back to defaults for %s", (_case, raw) => {
    const storage = memoryStorage({ [CONSOLE_STORAGE_KEY]: raw });
    expect(readConsoleState(storage)).toEqual(DEFAULT_CONSOLE_STATE);
  });

  // A field of the wrong type loses that field, not the whole blob: the drawer
  // stays open and takes the default height.
  it("repairs a single malformed field", () => {
    const storage = memoryStorage({
      [CONSOLE_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, height: "tall" }),
    });
    expect(readConsoleState(storage)).toEqual({ open: true, height: DEFAULT_CONSOLE_HEIGHT });
  });

  it("survives storage that throws on every access", () => {
    const storage = throwingStorage();
    expect(readConsoleState(storage)).toEqual(DEFAULT_CONSOLE_STATE);
    expect(() => {
      writeConsoleState({ open: true, height: 300 }, storage);
    }).not.toThrow();
  });

  it("treats an absent Storage as no stored state", () => {
    expect(readConsoleState(null)).toEqual(DEFAULT_CONSOLE_STATE);
    expect(() => {
      writeConsoleState({ open: true, height: 300 }, null);
    }).not.toThrow();
  });
});

describe("the hook", () => {
  it("starts collapsed at the prototype's height", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useConsoleLayout());
    expect(result.current.open).toBe(false);
    expect(result.current.height).toBe(DEFAULT_CONSOLE_HEIGHT);
  });

  it("toggles and persists", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useConsoleLayout());

    act(() => {
      result.current.toggle();
    });

    expect(result.current.open).toBe(true);
    expect(readConsoleState(storage).open).toBe(true);
  });

  it("restores a stored height, clamped to the current window", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        [CONSOLE_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, height: 5000 }),
      }),
    );
    const { result } = renderHook(() => useConsoleLayout());
    expect(result.current.height).toBe(MAX);
  });

  // TEST-91: arrow keys resize, so the drawer is not a mouse-only affordance.
  it("resizes by arrow key and ignores every other key", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useConsoleLayout());
    const press = (key: string): void => {
      act(() => {
        result.current.onResizerKeyDown({
          key,
          preventDefault: () => undefined,
        } as React.KeyboardEvent<HTMLElement>);
      });
    };

    press("ArrowUp");
    expect(result.current.height).toBe(DEFAULT_CONSOLE_HEIGHT + CONSOLE_RESIZE_STEP);

    press("ArrowDown");
    expect(result.current.height).toBe(DEFAULT_CONSOLE_HEIGHT);

    press("Enter");
    expect(result.current.height).toBe(DEFAULT_CONSOLE_HEIGHT);
  });

  it("clamps arrow-key resizing at both ends", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useConsoleLayout());
    const press = (key: string): void => {
      act(() => {
        result.current.onResizerKeyDown({
          key,
          preventDefault: () => undefined,
        } as React.KeyboardEvent<HTMLElement>);
      });
    };

    for (let i = 0; i < 40; i++) press("ArrowDown");
    expect(result.current.height).toBe(MIN_CONSOLE_HEIGHT);

    for (let i = 0; i < 60; i++) press("ArrowUp");
    expect(result.current.height).toBe(MAX);
  });

  it("drags the top edge, inverted, and stops dragging on pointer up", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useConsoleLayout());

    act(() => {
      result.current.onResizerPointerDown({
        clientY: 600,
        pointerId: 1,
        currentTarget: { setPointerCapture: vi.fn() },
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLElement>);
    });
    expect(result.current.dragging).toBe(true);

    // Dragging *up* 40px grows the drawer by 40px.
    act(() => {
      window.dispatchEvent(pointerMove(560));
    });
    expect(result.current.height).toBe(DEFAULT_CONSOLE_HEIGHT + 40);

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(result.current.dragging).toBe(false);

    // No longer dragging: further movement must not resize.
    act(() => {
      window.dispatchEvent(pointerMove(100));
    });
    expect(result.current.height).toBe(DEFAULT_CONSOLE_HEIGHT + 40);
  });

  it("re-clamps when the window shrinks below the stored height", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        [CONSOLE_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, height: 400 }),
      }),
    );
    const { result } = renderHook(() => useConsoleLayout());
    expect(result.current.height).toBe(400);

    act(() => {
      window.innerHeight = 400;
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.height).toBe(240);
    window.innerHeight = VIEWPORT;
  });
});
