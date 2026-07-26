/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage";
import {
  applyTheme,
  isThemeMode,
  nextThemeMode,
  readStoredTheme,
  THEME_ATTRIBUTE,
  THEME_MODES,
  THEME_STORAGE_KEY,
  themeGlyph,
  themeToggleLabel,
  writeStoredTheme,
  type ThemeMode,
} from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("isThemeMode", () => {
  it.each(["system", "light", "dark"])("accepts %s", (value) => {
    expect(isThemeMode(value)).toBe(true);
  });

  it.each([["System"], ["auto"], [""], [null], [undefined], [7], [{}]])(
    "rejects %s",
    (value: unknown) => {
      expect(isThemeMode(value)).toBe(false);
    },
  );
});

describe("nextThemeMode", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextThemeMode("system")).toBe("light");
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
  });

  it("returns to the starting mode after one full cycle", () => {
    let mode: ThemeMode = "system";
    for (let step = 0; step < THEME_MODES.length; step += 1) mode = nextThemeMode(mode);
    expect(mode).toBe("system");
  });
});

describe("readStoredTheme", () => {
  it("restores a persisted mode", () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
  });

  it("falls back to system for a corrupt value", () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("system");
  });

  it("falls back to system when nothing is stored", () => {
    expect(readStoredTheme(memoryStorage())).toBe("system");
  });

  it("falls back to system when storage is unavailable", () => {
    expect(readStoredTheme(null)).toBe("system");
    expect(readStoredTheme(throwingStorage())).toBe("system");
  });
});

describe("writeStoredTheme", () => {
  it("persists under the namespaced key", () => {
    const storage = memoryStorage();
    writeStoredTheme("dark", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("is a no-op when storage is unavailable or throwing", () => {
    expect(() => {
      writeStoredTheme("dark", null);
    }).not.toThrow();
    expect(() => {
      writeStoredTheme("dark", throwingStorage());
    }).not.toThrow();
  });
});

describe("ambient storage access", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("reads and writes globalThis.localStorage when no storage is passed", () => {
    writeStoredTheme("dark");
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("degrades to system when the storage methods throw", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(readStoredTheme()).toBe("system");
    expect(() => {
      writeStoredTheme("dark");
    }).not.toThrow();
  });

  it("degrades to system when reaching the storage object throws at all", () => {
    // Safari's private mode throws on the *property access*, before any method
    // call — a different failure point from a throwing `getItem`.
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get(): Storage {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    try {
      expect(readStoredTheme()).toBe("system");
      expect(() => {
        writeStoredTheme("dark");
      }).not.toThrow();
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});

describe("applyTheme", () => {
  it.each(["light", "dark"] as const)("sets data-theme for %s", (mode) => {
    applyTheme(document.documentElement, mode);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(mode);
  });

  it("removes the attribute for system so the OS media query keeps winning", () => {
    applyTheme(document.documentElement, "dark");
    applyTheme(document.documentElement, "system");
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });
});

describe("toggle presentation", () => {
  it("uses a different glyph per mode, none of them empty", () => {
    const glyphs = THEME_MODES.map(themeGlyph);
    expect(glyphs.every((glyph) => glyph.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(THEME_MODES.length);
  });

  it.each(THEME_MODES)("names the current mode %s in the accessible label", (mode) => {
    expect(themeToggleLabel(mode)).toContain(mode);
    expect(themeToggleLabel(mode)).toContain(nextThemeMode(mode));
  });
});

describe("index.html pre-paint script", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");

  it("reads the same storage key this module writes", () => {
    expect(html).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("sets the same attribute this module sets", () => {
    expect(html).toContain(`setAttribute("${THEME_ATTRIBUTE}"`);
  });

  it("only honours the two explicit modes, leaving system attribute-free", () => {
    expect(html).toContain('mode === "light" || mode === "dark"');
    expect(html).not.toContain('"system"');
  });

  it("runs before the module bundle so no wrong-theme frame is painted", () => {
    const inlineScript = html.indexOf("localStorage.getItem");
    const moduleScript = html.indexOf('type="module"');
    expect(inlineScript).toBeGreaterThan(-1);
    expect(moduleScript).toBeGreaterThan(inlineScript);
  });
});
