/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage";
import {
  DEFAULT_EXPLORER_STATE,
  DEFAULT_EXPLORER_WIDTH,
  EXPLORER_RESIZE_STEP,
  EXPLORER_STORAGE_KEY,
  MIN_EXPLORER_WIDTH,
  clampExplorerWidth,
  readExplorerState,
  useExplorerLayout,
  writeExplorerState,
} from "./useExplorerLayout";

/** jsdom's default viewport, so `50vw` is a number the assertions can name. */
const VIEWPORT = 1024;
const MAX = VIEWPORT * 0.5;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * jsdom implements no `PointerEvent`, and the drag only ever reads `clientX` —
 * so a `MouseEvent` under the pointer event's name is the same event as far as
 * the listener is concerned.
 */
function pointerMove(clientX: number): MouseEvent {
  return new MouseEvent("pointermove", { clientX });
}

describe("clamping", () => {
  it("stops at 180px on the way down", () => {
    expect(clampExplorerWidth(10, VIEWPORT)).toBe(MIN_EXPLORER_WIDTH);
  });

  it("stops at half the window on the way up — the bound is the room", () => {
    expect(clampExplorerWidth(5000, VIEWPORT)).toBe(MAX);
  });

  it("grows the ceiling with the window rather than holding a measured number", () => {
    expect(clampExplorerWidth(5000, 2400)).toBe(1200);
  });

  it("passes a width inside the band through untouched", () => {
    expect(clampExplorerWidth(300, VIEWPORT)).toBe(300);
  });

  // A window narrower than 360px would otherwise clamp the panel *below* its own
  // minimum; the floor wins, and the board scrolls instead.
  it("keeps the floor above the ceiling in a tiny window", () => {
    expect(clampExplorerWidth(300, 200)).toBe(MIN_EXPLORER_WIDTH);
  });

  it("falls back to the default for a non-finite width", () => {
    expect(clampExplorerWidth(Number.NaN, VIEWPORT)).toBe(DEFAULT_EXPLORER_WIDTH);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    writeExplorerState({ open: true, width: 300, expanded: ["finance"] }, storage);
    expect(readExplorerState(storage)).toEqual({
      open: true,
      width: 300,
      expanded: ["finance"],
    });
  });

  it("stores nothing but the three local facts", () => {
    const storage = memoryStorage();
    writeExplorerState({ open: true, width: 300, expanded: [] }, storage);
    expect(JSON.parse(storage.getItem(EXPLORER_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      open: true,
      width: 300,
      expanded: [],
    });
  });

  it.each([
    ["garbage", "{not json"],
    ["a non-object", '"260"'],
    ["null", "null"],
    ["a blob from another version", JSON.stringify({ version: 99, open: true, width: 900 })],
  ])("falls back to defaults for %s", (_case, raw) => {
    const storage = memoryStorage({ [EXPLORER_STORAGE_KEY]: raw });
    expect(readExplorerState(storage)).toEqual(DEFAULT_EXPLORER_STATE);
  });

  // A field of the wrong type loses that field, not the whole blob.
  it("repairs a single malformed field", () => {
    const storage = memoryStorage({
      [EXPLORER_STORAGE_KEY]: JSON.stringify({
        version: 1,
        open: true,
        width: "wide",
        expanded: ["finance", 7, ""],
      }),
    });
    expect(readExplorerState(storage)).toEqual({
      open: true,
      width: DEFAULT_EXPLORER_WIDTH,
      expanded: ["finance"],
    });
  });

  it("survives storage that throws on every access", () => {
    const storage = throwingStorage();
    expect(readExplorerState(storage)).toEqual(DEFAULT_EXPLORER_STATE);
    expect(() => {
      writeExplorerState({ open: true, width: 300, expanded: [] }, storage);
    }).not.toThrow();
  });

  it("treats an absent Storage as no stored state", () => {
    expect(readExplorerState(null)).toEqual(DEFAULT_EXPLORER_STATE);
    expect(() => {
      writeExplorerState({ open: true, width: 300, expanded: [] }, null);
    }).not.toThrow();
  });
});

describe("the hook", () => {
  it("is closed by default, at the prototype's width (rider 1)", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useExplorerLayout());
    expect(result.current.open).toBe(false);
    expect(result.current.width).toBe(DEFAULT_EXPLORER_WIDTH);
  });

  it("toggles and persists", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useExplorerLayout());

    act(() => {
      result.current.toggle();
    });

    expect(result.current.open).toBe(true);
    expect(readExplorerState(storage).open).toBe(true);
  });

  it("restores a stored width, clamped to the current window", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        [EXPLORER_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, width: 5000 }),
      }),
    );
    const { result } = renderHook(() => useExplorerLayout());
    expect(result.current.width).toBe(MAX);
  });

  it("expands a folder, collapses it again, and persists both", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useExplorerLayout());

    // A folder nobody has touched is **closed**: the set holds what is open, so
    // a tree nobody has expanded asks for no folder listing at all.
    expect(result.current.isExpanded("finance")).toBe(false);

    act(() => {
      result.current.toggleFolder("finance");
    });
    expect(result.current.isExpanded("finance")).toBe(true);
    expect(readExplorerState(storage).expanded).toEqual(["finance"]);

    act(() => {
      result.current.toggleFolder("finance");
    });
    expect(result.current.isExpanded("finance")).toBe(false);
    expect(readExplorerState(storage).expanded).toEqual([]);
  });

  it("resizes by arrow key and ignores every other key", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useExplorerLayout());
    const press = (key: string): void => {
      act(() => {
        result.current.onResizerKeyDown({
          key,
          preventDefault: () => undefined,
        } as React.KeyboardEvent<HTMLElement>);
      });
    };

    press("ArrowRight");
    expect(result.current.width).toBe(DEFAULT_EXPLORER_WIDTH + EXPLORER_RESIZE_STEP);

    press("ArrowLeft");
    expect(result.current.width).toBe(DEFAULT_EXPLORER_WIDTH);

    press("Enter");
    expect(result.current.width).toBe(DEFAULT_EXPLORER_WIDTH);
  });

  it("clamps arrow-key resizing at both ends", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useExplorerLayout());
    const press = (key: string): void => {
      act(() => {
        result.current.onResizerKeyDown({
          key,
          preventDefault: () => undefined,
        } as React.KeyboardEvent<HTMLElement>);
      });
    };

    for (let i = 0; i < 40; i++) press("ArrowLeft");
    expect(result.current.width).toBe(MIN_EXPLORER_WIDTH);

    for (let i = 0; i < 60; i++) press("ArrowRight");
    expect(result.current.width).toBe(MAX);
  });

  it("drags the right edge and stops dragging on pointer up", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { result } = renderHook(() => useExplorerLayout());

    act(() => {
      result.current.onResizerPointerDown({
        clientX: 260,
        pointerId: 1,
        currentTarget: { setPointerCapture: vi.fn() },
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLElement>);
    });
    expect(result.current.dragging).toBe(true);

    // Dragging *right* 40px grows the panel by 40px.
    act(() => {
      window.dispatchEvent(pointerMove(300));
    });
    expect(result.current.width).toBe(DEFAULT_EXPLORER_WIDTH + 40);

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(result.current.dragging).toBe(false);

    // No longer dragging: further movement must not resize.
    act(() => {
      window.dispatchEvent(pointerMove(900));
    });
    expect(result.current.width).toBe(DEFAULT_EXPLORER_WIDTH + 40);
  });

  it("re-clamps when the window narrows below the stored width", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        [EXPLORER_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, width: 480 }),
      }),
    );
    const { result } = renderHook(() => useExplorerLayout());
    expect(result.current.width).toBe(480);

    act(() => {
      window.innerWidth = 600;
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.width).toBe(300);
    window.innerWidth = VIEWPORT;
  });
});
