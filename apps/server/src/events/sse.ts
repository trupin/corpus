// `GET /events` — the SSE invalidation stream (SPEC.md §9.2).
//
// Two rules shape everything here:
//
// - **Rule 3 is absolute** (§2.2): the only event name on this wire is
//   `invalidate` and its only payload field is `keys`. No handler may put
//   document, thread, job or queue *data* on the stream. A consumer that appears
//   to need data over SSE is a design change requiring escalation, never a
//   payload extension.
// - **A dead subscriber is a prune, not a fault.** A browser tab closing mid-write
//   is the normal case; it must never surface as an `error`-level log line or a
//   500 on someone else's request.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import {
  INVALIDATE_EVENT,
  contractRoutes,
  type InvalidatePayload,
  type QueryKey,
} from "@corpus/contract";
import { silentLogger, type Logger } from "../logger.js";
import type { InvalidationBus } from "./bus.js";

/** SPEC.md §9.2: 25 s heartbeat. Short enough for the proxies and idle timeouts in between. */
export const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * An SSE *comment*: two bytes of traffic that keep the socket warm and are
 * invisible to `EventSource` consumers, so a heartbeat can never be mistaken for
 * an event carrying data.
 */
export const HEARTBEAT_FRAME = ":hb\n\n";

/**
 * Sent the moment a subscriber attaches. Its job is to flush the response
 * headers immediately — a client that has not seen `content-type:
 * text/event-stream` yet cannot tell "connected and idle" from "still
 * connecting".
 */
export const GREETING_FRAME = ":connected\n\n";

/** The half of a stream the hub needs. Kept minimal so the hub is testable without HTTP. */
export interface SseConnection {
  /** Rejecting (or throwing) means the peer is gone; the hub prunes on either. */
  write(chunk: string): void | Promise<void>;
  close(): void | Promise<void>;
}

/** The exact bytes of one `invalidate` frame. `JSON.stringify` guarantees a single `data:` line. */
export function invalidateFrame(keys: readonly QueryKey[]): string {
  const payload: InvalidatePayload = { keys: [...keys] };
  return `event: ${INVALIDATE_EVENT}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export interface SseHub {
  /** Live subscribers. There is deliberately no cap (sprint-004 Adjudication 4). */
  readonly size: number;
  /** Registers a stream; the returned function detaches it (idempotent). */
  attach(connection: SseConnection): () => void;
  /**
   * Ends every stream. Called *before* `httpServer.close()`, which waits on open
   * connections — an attached SSE client is an active connection and would
   * otherwise hold shutdown open forever.
   */
  close(): Promise<void>;
}

export interface SseHubOptions {
  readonly bus: InvalidationBus;
  readonly logger?: Logger | undefined;
  readonly heartbeatMs?: number | undefined;
}

type Subscriber = {
  readonly connection: SseConnection;
  /** Serializes writes so frames reach the client in the order they were broadcast. */
  tail: Promise<void>;
  alive: boolean;
};

export function createSseHub(options: SseHubOptions): SseHub {
  const logger = options.logger ?? silentLogger;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const subscribers = new Set<Subscriber>();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const prune = (subscriber: Subscriber, reason: unknown): void => {
    if (!subscriber.alive) return;
    subscriber.alive = false;
    subscribers.delete(subscriber);
    stopHeartbeatIfIdle();
    // Debug, not error: `EPIPE` / `ERR_STREAM_DESTROYED` here means a client
    // went away, which is the expected end of every stream's life.
    logger.debug("sse subscriber pruned", {
      subscribers: subscribers.size,
      ...(reason instanceof Error ? { reason: `${reason.name}: ${reason.message}` } : {}),
    });
    try {
      void Promise.resolve(subscriber.connection.close()).catch(() => undefined);
    } catch {
      // A close that fails on an already-dead socket is exactly what we expect.
    }
  };

  const send = (subscriber: Subscriber, frame: string): void => {
    if (!subscriber.alive) return;
    subscriber.tail = subscriber.tail.then(async () => {
      if (!subscriber.alive) return;
      try {
        await subscriber.connection.write(frame);
      } catch (error) {
        prune(subscriber, error);
      }
    });
  };

  function stopHeartbeatIfIdle(): void {
    if (subscribers.size > 0 || heartbeat === undefined) return;
    clearInterval(heartbeat);
    heartbeat = undefined;
  }

  const startHeartbeat = (): void => {
    if (heartbeat !== undefined || heartbeatMs <= 0) return;
    heartbeat = setInterval(() => {
      for (const subscriber of [...subscribers]) send(subscriber, HEARTBEAT_FRAME);
    }, heartbeatMs);
    // The heartbeat must not be the reason a process stays alive.
    heartbeat.unref?.();
  };

  const unsubscribe = options.bus.subscribe((keys) => {
    if (subscribers.size === 0) return;
    const frame = invalidateFrame(keys);
    for (const subscriber of [...subscribers]) send(subscriber, frame);
  });

  return {
    get size() {
      return subscribers.size;
    },
    attach(connection) {
      const subscriber: Subscriber = { connection, tail: Promise.resolve(), alive: true };
      if (closed) {
        // Shutting down: answer honestly rather than registering a stream that
        // nothing will ever feed or close.
        void Promise.resolve(connection.close()).catch(() => undefined);
        return () => undefined;
      }
      subscribers.add(subscriber);
      startHeartbeat();
      send(subscriber, GREETING_FRAME);
      logger.debug("sse subscriber attached", { subscribers: subscribers.size });
      return () => {
        if (!subscriber.alive) return;
        subscriber.alive = false;
        subscribers.delete(subscriber);
        stopHeartbeatIfIdle();
      };
    },
    async close() {
      closed = true;
      unsubscribe();
      const draining = [...subscribers];
      subscribers.clear();
      stopHeartbeatIfIdle();
      for (const subscriber of draining) {
        subscriber.alive = false;
        try {
          await subscriber.connection.close();
        } catch {
          // Already gone; nothing left to release.
        }
      }
    },
  };
}

/**
 * Mounts the stream on the contract's own path.
 *
 * Registered as a plain route rather than through `app.openapi`: the contract
 * declares `token` as a *required query parameter* (because `EventSource` cannot
 * set headers), but SPEC.md §2.1's general rule is the `Authorization` header,
 * and both must open the stream. Validating the contract's query here would
 * reject every header-authenticated client with a 400. Authentication itself is
 * the same bearer middleware as everywhere else — mounted in `app.ts` with
 * `allowQueryToken` — so this handler is only reached by an authenticated
 * caller.
 */
export function mountEventStream(app: OpenAPIHono, hub: SseHub): void {
  app.get(contractRoutes.streamEvents.path, (c) =>
    streamSSE(c, async (stream) => {
      let release = (): void => undefined;
      const finished = new Promise<void>((resolve) => {
        release = resolve;
      });
      const detach = hub.attach({
        write: async (chunk) => {
          await stream.write(chunk);
        },
        close: () => {
          release();
        },
      });
      stream.onAbort(() => {
        detach();
        release();
      });
      // Holding the callback open *is* holding the stream open: `streamSSE`
      // closes the response as soon as it returns.
      await finished;
      detach();
    }),
  );
}
