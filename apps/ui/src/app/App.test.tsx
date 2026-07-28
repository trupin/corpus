/** @vitest-environment jsdom */
import { fakeEventSourceFactory } from "@corpus/kit/testing";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_ATTRIBUTE } from "../shell/theme";
import { memoryStorage } from "../testing/memoryStorage";
import { App } from "./App";
import { DEV_PROBE_PATH } from "../dev/devRoutes";

/**
 * Adapted for UI-002 only by injecting an `EventSource`: `App` now mounts the
 * kit's `CorpusProvider`, which opens the live-update stream, and there is no
 * `EventSource` in this runtime (Node gates it, jsdom implements none). Without
 * the injection every test would spend its life in the bridge's backoff loop.
 * The three assertions themselves are unchanged.
 */

let client: QueryClient;
let eventSource: ReturnType<typeof fakeEventSourceFactory>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  eventSource = fakeEventSourceFactory();
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
    const { container } = render(<App client={client} eventSourceFactory={eventSource} />);
    expect(container.querySelector(".app")).not.toBeNull();
    expect(container.querySelector(".board")).not.toBeNull();
  });

  it("renders the shell rather than a blank page on an unknown path", () => {
    window.history.pushState({}, "", "/nope");
    const { container } = render(<App client={client} eventSourceFactory={eventSource} />);
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".board")).not.toBeNull();
    expect(container.querySelector(".console")).not.toBeNull();
  });

  it("falls back to the app-wide query client when none is injected", () => {
    const { container } = render(<App eventSourceFactory={eventSource} />);
    expect(container.querySelector(".app")).not.toBeNull();
  });

  it("opens exactly one live-update stream for the whole application", () => {
    render(<App client={client} eventSourceFactory={eventSource} />);
    expect(eventSource.sources).toHaveLength(1);
    expect(eventSource.latest().url).toBe(`${window.location.origin}/events?token=`);
  });

  it("mounts the development probe route, which renders every read hook at once", () => {
    window.history.pushState({}, "", DEV_PROBE_PATH);
    const { container } = render(<App client={client} eventSourceFactory={eventSource} />);
    expect(container.querySelector(".probe")).not.toBeNull();
    expect(container.querySelector(".app")).toBeNull();
  });
});
