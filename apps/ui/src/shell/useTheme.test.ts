/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "./theme";
import { useTheme } from "./useTheme";

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("useTheme", () => {
  it("starts in system mode with no attribute written", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it("cycles system → light → dark → system, applying and persisting each step", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.cycle();
    });
    expect(result.current.mode).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");

    act(() => {
      result.current.cycle();
    });
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => {
      result.current.cycle();
    });
    expect(result.current.mode).toBe("system");
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("restores the persisted mode on a fresh mount", () => {
    storage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("ignores a corrupt persisted value", () => {
    storage.setItem(THEME_STORAGE_KEY, "midnight");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });
});
