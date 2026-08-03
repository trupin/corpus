import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createCorpusClient } from "../client/createCorpusClient.js";
import { docKey, docsListKey, HEALTH_KEY, pluginKey, threadKey, TREE_KEY } from "../query/keys.js";
import { fakeEventSourceFactory, failingEventSourceFactory } from "../testing/index.js";
import {
  backoffDelay,
  createSseBridge,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_BATCH_WINDOW_MS,
  DEFAULT_MAX_DELAY_MS,
  type BridgeLogger,
  type ConnectionState,
  type SseBridge,
} from "./sseBridge.js";

/**
 * Every test here injects an `EventSource` through the seam
 * `createEventStream` already exposes. None constructs a real one: Node gates
 * `EventSource` behind `--experimental-eventsource` and jsdom ships none, so a
 * test that needed the global would not be a test.
 */

/**
 * A logger whose calls are assertable. The spies are held as plain properties
 * rather than read back off the `BridgeLogger`, whose members are declared as
 * methods — referencing one without calling it is an unbound-method defect.
 */
interface LoggerSpy {
  readonly logger: BridgeLogger;
  readonly debug: Mock;
  readonly info: Mock;
  readonly warn: Mock;
}

function silentLogger(): LoggerSpy {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  return { logger: { debug, info, warn }, debug, info, warn };
}

function neverFetch(): typeof globalThis.fetch {
  return vi.fn().mockReturnValue(new Promise(() => undefined));
}

function setup(overrides: { readonly random?: () => number } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createCorpusClient({
    baseUrl: "http://127.0.0.1:8905",
    token: "test-token",
    fetch: neverFetch(),
  });
  const factory = fakeEventSourceFactory();
  const logger = silentLogger();
  const bridge = createSseBridge({
    client,
    queryClient,
    eventSourceFactory: factory,
    logger: logger.logger,
    random: overrides.random ?? (() => 0.5),
  });
  return { queryClient, factory, bridge, logger };
}

function states(bridge: SseBridge): { readonly seen: ConnectionState[] } {
  const seen: ConnectionState[] = [];
  bridge.subscribe(() => seen.push(bridge.getState()));
  return { seen };
}

let active: SseBridge | undefined;

afterEach(() => {
  active?.stop();
  active = undefined;
  vi.useRealTimers();
});

describe("connecting", () => {
  it("carries the token as a query parameter, which EventSource cannot send as a header", () => {
    const { bridge, factory } = setup();
    active = bridge;
    bridge.start();
    expect(factory.sources).toHaveLength(1);
    expect(factory.latest().url).toBe("http://127.0.0.1:8905/events?token=test-token");
  });

  it("opens nothing until it is started, and nothing more once it is", () => {
    const { bridge, factory } = setup();
    active = bridge;
    expect(factory.sources).toHaveLength(0);
    bridge.start();
    bridge.start();
    bridge.start();
    expect(factory.sources).toHaveLength(1);
  });

  it("closes the stream on stop", () => {
    const { bridge, factory } = setup();
    bridge.start();
    const source = factory.latest();
    bridge.stop();
    expect(source.closed).toBe(true);
    expect(bridge.currentUrl()).toBeUndefined();
  });
});

describe("invalidation mapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function seedCache(queryClient: QueryClient): void {
    queryClient.setQueryData(docsListKey({}), { items: [], page: {} });
    queryClient.setQueryData(docsListKey({ type: "note" }), { items: [], page: {} });
    queryClient.setQueryData(docKey("doc_a"), { id: "doc_a" });
    queryClient.setQueryData(threadKey("th_a"), { id: "th_a", turns: [] });
    queryClient.setQueryData(TREE_KEY, { folders: [] });
  }

  const invalidated = (queryClient: QueryClient, key: readonly unknown[]): boolean =>
    queryClient.getQueryState(key as never)?.isInvalidated === true;

  // TEST-16.
  it("invalidates by prefix: a `docs` frame reaches every docs entry and nothing else", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    seedCache(queryClient);
    bridge.start();
    factory.latest().invalidate(["docs"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);

    expect(invalidated(queryClient, docsListKey({}))).toBe(true);
    expect(invalidated(queryClient, docsListKey({ type: "note" }))).toBe(true);
    expect(invalidated(queryClient, docKey("doc_a"))).toBe(true);
    expect(invalidated(queryClient, threadKey("th_a"))).toBe(false);
    expect(invalidated(queryClient, TREE_KEY)).toBe(false);
  });

  // TEST-10: the list key and the single-document key do not collide.
  it("a single-document frame reaches the reader and no collection variant", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    seedCache(queryClient);
    bridge.start();
    factory.latest().invalidate(["docs", "doc_a"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);

    expect(invalidated(queryClient, docKey("doc_a"))).toBe(true);
    expect(invalidated(queryClient, docsListKey({}))).toBe(false);
    expect(invalidated(queryClient, docsListKey({ type: "note" }))).toBe(false);
  });

  // TEST-17: the real shape the server sends for a turn append.
  it("dispatches every key in a multi-key frame, dropping none and inventing none", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    seedCache(queryClient);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    factory.latest().invalidate(["docs"], ["docs", "th_a"], ["threads", "th_a"], ["tree"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);

    expect(spy.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ["docs"],
      ["docs", "th_a"],
      ["threads", "th_a"],
      ["tree"],
    ]);
    expect(invalidated(queryClient, threadKey("th_a"))).toBe(true);
    expect(invalidated(queryClient, TREE_KEY)).toBe(true);
  });

  // TEST-18: no allowlist. A kit that only honoured the core shapes would
  // break every plugin's live updates (SPEC.md §10).
  it("passes plugin and unrecognised keys straight through", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    queryClient.setQueryData(pluginKey("todos", "board"), { todos: [] });
    queryClient.setQueryData(["something", "nobody", "declared"], { x: 1 });
    bridge.start();
    factory.latest().invalidate(["x", "todos", "board"], ["something", "nobody", "declared"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);

    expect(invalidated(queryClient, pluginKey("todos", "board"))).toBe(true);
    expect(invalidated(queryClient, ["something", "nobody", "declared"])).toBe(true);
  });

  // TEST-19.
  it.each([
    ["invalid JSON", "not json at all"],
    ["an empty key list", JSON.stringify({ keys: [] })],
    ["a string where an array belongs", JSON.stringify({ keys: "docs" })],
    ["an empty key", JSON.stringify({ keys: [[]] })],
    ["an object with no keys field", JSON.stringify({ nope: true })],
  ])("drops %s without throwing, and keeps serving", (_label, payload) => {
    const { bridge, factory, queryClient, logger } = setup();
    active = bridge;
    seedCache(queryClient);
    bridge.start();
    const source = factory.latest();

    expect(() => {
      source.emit("invalidate", payload);
    }).not.toThrow();
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    expect(invalidated(queryClient, docsListKey({}))).toBe(false);
    expect(logger.debug).toHaveBeenCalled();
    expect(source.closed).toBe(false);
    expect(factory.sources).toHaveLength(1);

    source.invalidate(["docs"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    expect(invalidated(queryClient, docsListKey({}))).toBe(true);
  });

  // TEST-20. SSE comments (`:connected`, `:hb`) never reach an EventSource
  // listener at all, so the criterion is that nothing in the kit turns a
  // liveness signal into a refetch. Two liveness-shaped events stand in.
  it("turns no liveness signal into a refetch", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    seedCache(queryClient);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    const source = factory.latest();
    source.emit("open");
    source.emit("message", ":hb");
    source.emit("ping", "");
    vi.advanceTimersByTime(60_000);

    expect(spy).not.toHaveBeenCalled();
    expect(invalidated(queryClient, docsListKey({}))).toBe(false);
  });

  // TEST-21.
  it("coalesces a storm of frames naming one key into a single invalidation", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    const source = factory.latest();
    for (let index = 0; index < 20; index += 1) source.invalidate(["docs"]);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]?.queryKey).toEqual(["docs"]);
  });

  // TEST-22: coalescing dedupes, it never drops.
  it("keeps every distinct key in a storm", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    const source = factory.latest();
    const keys = [["docs"], ["tree"], ["threads", "th_a"]];
    for (let index = 0; index < 20; index += 1) source.invalidate(keys[index % 3]);

    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map((call) => call[0]?.queryKey)).toEqual(keys);
  });

  it("starts a new window for frames that arrive after a flush", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    const source = factory.latest();
    source.invalidate(["docs"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    source.invalidate(["docs"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("drops a pending batch on stop rather than invalidating after teardown", () => {
    const { bridge, factory, queryClient } = setup();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    factory.latest().invalidate(["docs"]);
    bridge.stop();
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS * 10);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("backoffDelay", () => {
  const options = { baseMs: DEFAULT_BASE_DELAY_MS, maxMs: DEFAULT_MAX_DELAY_MS };

  // TEST-23.
  it("grows exponentially, never exceeds the cap and is never zero", () => {
    for (const random of [() => 0, () => 0.5, () => 0.999999]) {
      const delays = Array.from({ length: 12 }, (_, attempt) =>
        backoffDelay(attempt, { ...options, random }),
      );
      for (const delay of delays) {
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(DEFAULT_MAX_DELAY_MS);
      }
      for (let index = 1; index < delays.length; index += 1) {
        expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1] ?? 0);
      }
      expect(delays.at(-1)).toBe(Math.round(DEFAULT_MAX_DELAY_MS * (0.5 + random() * 0.5)));
    }
  });

  it("floors at half the computed delay, so a zero draw is still a real wait", () => {
    expect(backoffDelay(0, { ...options, random: () => 0 })).toBe(DEFAULT_BASE_DELAY_MS / 2);
  });

  it("jitters: two draws of the same attempt differ", () => {
    const low = backoffDelay(5, { ...options, random: () => 0.1 });
    const high = backoffDelay(5, { ...options, random: () => 0.9 });
    expect(low).not.toBe(high);
  });
});

describe("reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // TEST-23, integration half: ten consecutive failures must not hot-loop.
  it("does not hot-loop when every connect fails", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = createCorpusClient({
      baseUrl: "http://127.0.0.1:8905",
      token: "t",
      fetch: neverFetch(),
    });
    let attempts = 0;
    const bridge = createSseBridge({
      client,
      queryClient,
      eventSourceFactory: (url) => {
        attempts += 1;
        return failingEventSourceFactory()(url);
      },
      logger: silentLogger().logger,
      random: () => 0.5,
    });
    active = bridge;
    bridge.start();
    expect(attempts).toBe(1);
    expect(bridge.getState()).toBe("reconnecting");

    // Ten immediate retries would take no time at all; the schedule must cost
    // orders of magnitude more than that.
    vi.advanceTimersByTime(1000);
    expect(attempts).toBeLessThanOrEqual(4);
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBeLessThanOrEqual(10);
    expect(attempts).toBeGreaterThan(3);
  });

  /**
   * `invalidateQueries` refetches internally, so the spy also sees keyed calls
   * the health invalidation made. Only the unkeyed `{type: "active"}` sweep is
   * the recovery under test.
   */
  const sweeps = (spy: { readonly mock: { readonly calls: readonly unknown[][] } }): unknown[] =>
    spy.mock.calls
      .map((call) => call[0] as { queryKey?: unknown } | undefined)
      .filter((filters) => filters?.queryKey === undefined);

  // TEST-24.
  it("refetches active queries on a reconnect and never on the first connect", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const refetch = vi.spyOn(queryClient, "refetchQueries");
    bridge.start();
    factory.latest().emit("open");
    expect(sweeps(refetch)).toEqual([]);

    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    expect(factory.sources).toHaveLength(2);
    factory.latest().emit("open");

    expect(sweeps(refetch)).toEqual([{ type: "active" }]);
  });

  it("refetches once per reconnect, not once per failed attempt", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const refetch = vi.spyOn(queryClient, "refetchQueries");
    bridge.start();
    factory.latest().emit("open");

    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    expect(sweeps(refetch)).toEqual([]);

    factory.latest().emit("open");
    expect(sweeps(refetch)).toEqual([{ type: "active" }]);
  });

  it("ignores repeated errors from one dead source instead of stacking retries", () => {
    const { bridge, factory } = setup();
    active = bridge;
    bridge.start();
    factory.latest().emit("open");
    const dead = factory.latest();
    dead.emit("error");
    dead.emit("error");
    dead.emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    expect(factory.sources).toHaveLength(2);
  });

  it("ignores frames from a source it has already given up on", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    const dead = factory.latest();
    dead.emit("error");
    spy.mockClear();
    dead.invalidate(["docs"]);
    vi.advanceTimersByTime(DEFAULT_BATCH_WINDOW_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("resets the backoff after a successful connect", () => {
    const { bridge, factory } = setup();
    active = bridge;
    bridge.start();
    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    factory.latest().emit("open");

    factory.latest().emit("error");
    // Back to the first rung: half the base delay at random() === 0.5 is 375ms,
    // so a quarter-second is not yet enough and half a second is.
    vi.advanceTimersByTime(200);
    const before = factory.sources.length;
    vi.advanceTimersByTime(DEFAULT_BASE_DELAY_MS);
    expect(factory.sources.length).toBe(before + 1);
  });

  it("stops reconnecting once stopped", () => {
    const { bridge, factory } = setup();
    bridge.start();
    factory.latest().emit("error");
    bridge.stop();
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS * 5);
    expect(factory.sources).toHaveLength(1);
  });
});

describe("connection state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // TEST-25.
  it("reports connecting → open → reconnecting → open, in order", () => {
    const { bridge, factory } = setup();
    active = bridge;
    const { seen } = states(bridge);
    bridge.start();
    factory.latest().emit("open");
    factory.latest().emit("error");
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    factory.latest().emit("open");

    expect(seen).toEqual(["open", "reconnecting", "open"]);
    expect(bridge.getState()).toBe("open");
  });

  it("starts in connecting and stays there until the stream opens", () => {
    const { bridge } = setup();
    active = bridge;
    expect(bridge.getState()).toBe("connecting");
    bridge.start();
    expect(bridge.getState()).toBe("connecting");
  });

  it("stops notifying an unsubscribed listener", () => {
    const { bridge, factory } = setup();
    active = bridge;
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    bridge.start();
    unsubscribe();
    factory.latest().emit("open");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the health key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // TEST-26. UI-001's console strip is frozen at the boot-time probe
  // (staleTime: Infinity, no refetch triggers), so without this it reports a
  // version for a dead server, or "unreachable" for one that came back.
  it("is invalidated when the stream drops and again when it returns", () => {
    const { bridge, factory, queryClient } = setup();
    active = bridge;
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    bridge.start();
    factory.latest().emit("open");
    expect(spy).not.toHaveBeenCalled();

    factory.latest().emit("error");
    expect(spy).toHaveBeenCalledWith({ queryKey: HEALTH_KEY });

    spy.mockClear();
    vi.advanceTimersByTime(DEFAULT_MAX_DELAY_MS);
    factory.latest().emit("open");
    expect(spy).toHaveBeenCalledWith({ queryKey: HEALTH_KEY });
  });
});
