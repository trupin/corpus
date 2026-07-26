/** @vitest-environment jsdom */
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_ATTRIBUTE } from "../shell/theme";
import { memoryStorage } from "../testing/memoryStorage";
import { App } from "./App";

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("App", () => {
  it("renders the board shell at /", () => {
    window.history.pushState({}, "", "/");
    const { container } = render(<App client={client} />);
    expect(container.querySelector(".app")).not.toBeNull();
    expect(container.querySelector(".board")).not.toBeNull();
  });

  it("renders the shell rather than a blank page on an unknown path", () => {
    window.history.pushState({}, "", "/nope");
    const { container } = render(<App client={client} />);
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".board")).not.toBeNull();
    expect(container.querySelector(".console")).not.toBeNull();
  });

  it("falls back to the app-wide query client when none is injected", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".app")).not.toBeNull();
  });
});
