import type {
  EventSourceFactory,
  EventSourceLike,
  EventStream,
  QueryKey,
} from "@corpus/contract/client";
import type { QueryClient } from "@tanstack/react-query";
import type { CorpusClient } from "../client/createCorpusClient.js";
import { HEALTH_KEY } from "../query/keys.js";

/**
 * The single `invalidate` → `invalidateQueries` bridge (SPEC.md §2.2 rule 3,
 * §11 "Live updates").
 *
 * Deliberately framework-free: no React here, so the reconnect schedule, the
 * coalescing window and the invalidation mapping are testable without a
 * renderer. `CorpusProvider` owns one of these; `useConnectionState` subscribes
 * to it.
 *
 * Parsing is **not** here. `createEventStream` in `@corpus/contract/client`
 * already validates every frame with `InvalidatePayloadSchema`; a second parser
 * in the kit would be a second thing to drift. This module wraps it.
 */

export type ConnectionState = "connecting" | "open" | "reconnecting";

/** Where the kit reports reconnects, dropped frames and misuse. `console` by default. */
export interface BridgeLogger {
  debug(message: string, ...details: readonly unknown[]): void;
  info(message: string, ...details: readonly unknown[]): void;
  warn(message: string, ...details: readonly unknown[]): void;
}

/**
 * ~50 ms. The agent editing many files produces a burst of frames naming the
 * same handful of keys; without a window each one would start its own refetch.
 * Short enough that a single mutation still repaints in one frame's time.
 */
export const DEFAULT_BATCH_WINDOW_MS = 50;

/** First retry delay. Long enough not to hammer a server that is still booting. */
export const DEFAULT_BASE_DELAY_MS = 500;

/** Ceiling on the retry delay, so a long outage settles at one attempt per 30 s. */
export const DEFAULT_MAX_DELAY_MS = 30_000;

export interface SseBridgeOptions {
  readonly client: Pick<CorpusClient, "connectEvents">;
  readonly queryClient: QueryClient;
  /**
   * Injectable EventSource constructor. Required in every test: Node gates
   * `EventSource` behind `--experimental-eventsource`, so the global is absent
   * on the versions this repo runs on and jsdom ships none either.
   */
  readonly eventSourceFactory?: EventSourceFactory;
  readonly batchWindowMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Injectable jitter source, so the backoff schedule is assertable. */
  readonly random?: () => number;
  readonly logger?: BridgeLogger;
}

export interface SseBridge {
  start(): void;
  stop(): void;
  getState(): ConnectionState;
  /** Store subscription for `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  /** The URL of the current stream, or undefined while no stream is open. */
  currentUrl(): string | undefined;
}

interface GlobalWithEventSource {
  EventSource?: new (url: string) => EventSourceLike;
}

const globalEventSourceFactory: EventSourceFactory = (url) => {
  const constructor = (globalThis as GlobalWithEventSource).EventSource;
  if (!constructor) {
    throw new Error(
      "No global EventSource in this runtime; pass `eventSourceFactory` to CorpusProvider.",
    );
  }
  return new constructor(url);
};

/**
 * `min(cap, base * 2^attempt)`, then half-to-full jitter.
 *
 * Jittering the *whole* delay (rather than adding jitter on top) keeps the cap
 * a real ceiling; taking half the value as the floor keeps it a real delay — a
 * zero-jitter draw would be a hot loop by another name.
 */
export function backoffDelay(
  attempt: number,
  options: { readonly baseMs: number; readonly maxMs: number; readonly random: () => number },
): number {
  const exponential = Math.min(options.maxMs, options.baseMs * 2 ** attempt);
  return Math.round(exponential * (0.5 + options.random() * 0.5));
}

export function createSseBridge(options: SseBridgeOptions): SseBridge {
  const {
    client,
    queryClient,
    batchWindowMs = DEFAULT_BATCH_WINDOW_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    random = Math.random,
    logger = console,
  } = options;
  const createSource = options.eventSourceFactory ?? globalEventSourceFactory;

  const listeners = new Set<() => void>();
  let state: ConnectionState = "connecting";
  let stopped = true;
  let hasEverConnected = false;
  let attempt = 0;
  let generation = 0;
  let stream: EventStream | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, QueryKey>();

  const setState = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener();
  };

  // Invalidation is fire-and-forget by design: the refetch it triggers belongs
  // to the query's own lifecycle, and awaiting it here would serialise a burst.
  const invalidate = (queryKey: QueryKey): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const flush = (): void => {
    flushTimer = undefined;
    const keys = [...pending.values()];
    pending.clear();
    for (const key of keys) invalidate(key);
  };

  const enqueue = (keys: readonly QueryKey[]): void => {
    for (const key of keys) {
      // The contract's `QueryKeySchema` allows an empty array, and TanStack
      // treats `[]` as a prefix of every key — so one degenerate frame would
      // invalidate the entire cache. No shape in the vocabulary is empty, so
      // this can only ever be a malformed frame.
      if (key.length === 0) {
        logger.debug("[corpus] ignored an empty query key in an invalidate frame");
        continue;
      }
      pending.set(JSON.stringify(key), key);
    }
    if (pending.size === 0 || flushTimer !== undefined) return;
    flushTimer = setTimeout(flush, batchWindowMs);
  };

  const handleOpen = (gen: number): void => {
    if (stopped || gen !== generation) return;
    const reconnected = hasEverConnected;
    hasEverConnected = true;
    attempt = 0;
    setState("open");
    if (!reconnected) return;
    logger.info("[corpus] event stream reconnected; refetching active queries");
    // Nothing told us which keys changed while we were disconnected, so the only
    // correct recovery is to refetch what is on screen. Exactly once per
    // reconnect — never on the first connect, where nothing is stale yet.
    void queryClient.refetchQueries({ type: "active" });
    invalidate(HEALTH_KEY);
  };

  const handleDrop = (gen: number, reason: string): void => {
    if (stopped || gen !== generation) return;
    // Bump the generation so further events from this dead source are ignored;
    // a real EventSource fires `error` repeatedly while it flails.
    generation += 1;
    stream?.close();
    stream = undefined;
    setState("reconnecting");
    // The console strip's verdict is a frozen boot-time probe (staleTime:
    // Infinity) until something invalidates it, so losing the stream has to
    // push it — otherwise it reports a version for a server that is gone.
    invalidate(HEALTH_KEY);
    const delay = backoffDelay(attempt, { baseMs: baseDelayMs, maxMs: maxDelayMs, random });
    attempt += 1;
    logger.info(
      `[corpus] event stream lost (${reason}); retrying in ${String(delay)}ms (attempt ${String(attempt)})`,
    );
    retryTimer = setTimeout(open, delay);
  };

  function open(): void {
    retryTimer = undefined;
    if (stopped) return;
    const gen = generation;
    const factory: EventSourceFactory = (url) => {
      const source = createSource(url);
      source.addEventListener("open", () => {
        handleOpen(gen);
      });
      source.addEventListener("error", () => {
        handleDrop(gen, "transport error");
      });
      return source;
    };
    try {
      const opened = client.connectEvents({
        onInvalidate: (payload) => {
          if (gen !== generation) return;
          enqueue(payload.keys);
        },
        // Frames that do not parse are logged and dropped — never thrown, and
        // never treated as a disconnect. The connection is fine; the frame was
        // not. Transport failures arrive on the listener above instead.
        onError: (error) => {
          logger.debug("[corpus] dropped an unusable event frame", error);
        },
        eventSourceFactory: factory,
      });
      // A source can fail during construction, in which case `handleDrop` ran
      // before this assignment and already moved on. Close the orphan rather
      // than parking it in `stream`, where `stop()` would find a stale handle.
      if (gen !== generation) opened.close();
      else stream = opened;
    } catch (error) {
      // A runtime with no EventSource, or a constructor that threw. Same
      // recovery as a drop: back off and try again rather than dying silently.
      logger.debug("[corpus] could not open the event stream", error);
      handleDrop(gen, "connect failed");
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      setState("connecting");
      open();
    },
    stop() {
      stopped = true;
      generation += 1;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      retryTimer = undefined;
      flushTimer = undefined;
      pending.clear();
      stream?.close();
      stream = undefined;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentUrl: () => stream?.url,
  };
}
