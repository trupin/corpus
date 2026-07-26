/** @vitest-environment jsdom */
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_ATTRIBUTE } from "./shell/theme";
import { memoryStorage } from "./testing/memoryStorage";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
  vi.stubGlobal("localStorage", memoryStorage());
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
