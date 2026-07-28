/** @vitest-environment jsdom */
import { FakeEventSource } from "@corpus/kit/testing";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_ATTRIBUTE } from "./shell/theme";
import { memoryStorage } from "./testing/memoryStorage";

/**
 * Adapted for UI-002 with one added global stub. `main.tsx` renders `App`
 * without props, so the kit's provider reaches for `globalThis.EventSource` —
 * which a browser has and neither Node nor jsdom does. Stubbing it keeps this
 * test about mounting rather than about the bridge's backoff loop.
 */
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("EventSource", FakeEventSource);
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("main", () => {
  it("mounts the shell into #root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import("./main");

    await waitFor(() => {
      expect(document.querySelector("#root .app")).not.toBeNull();
    });
    expect(document.querySelector("#root .topbar")).not.toBeNull();
    expect(document.querySelector("#root .board")).not.toBeNull();
    expect(document.querySelector("#root .console")).not.toBeNull();
  });

  it("fails loudly when index.html has no mount point", async () => {
    await expect(import("./main")).rejects.toThrow(/no #root element/);
  });
});
