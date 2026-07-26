import {
  INVALIDATE_EVENT,
  InvalidatePayloadSchema,
  type InvalidatePayload,
} from "../schemas/sse.js";

/**
 * The SSE stream is deliberately outside the generated fetch client (SPEC.md
 * §9.3): `EventSource` is not `fetch`, and the server never pushes data over it
 * — only invalidation keys the caller feeds back into its query cache.
 */

/** The slice of `EventSource` this helper needs, so no DOM lib is required. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { readonly data: string }) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface EventStreamOptions {
  /** Origin of the workspace server, e.g. `http://127.0.0.1:8765`. */
  readonly baseUrl: string;
  /** Workspace bearer token. Travels as a query parameter because EventSource cannot set headers. */
  readonly token: string;
  readonly onInvalidate: (payload: InvalidatePayload) => void;
  /** Called for transport failures and for frames that do not parse. Rethrown when absent. */
  readonly onError?: (error: Error) => void;
  /** Injectable for tests and for runtimes without a global `EventSource`. */
  readonly eventSourceFactory?: EventSourceFactory;
}

export interface EventStream {
  /** The URL the stream connected to, token included. */
  readonly url: string;
  close(): void;
}

interface GlobalWithEventSource {
  EventSource?: new (url: string) => EventSourceLike;
}

const defaultEventSourceFactory: EventSourceFactory = (url) => {
  const constructor = (globalThis as GlobalWithEventSource).EventSource;
  if (!constructor) {
    throw new Error(
      "No global EventSource in this runtime; pass `eventSourceFactory` to createEventStream.",
    );
  }
  return new constructor(url);
};

export function eventStreamUrl(baseUrl: string, token: string): string {
  const url = new URL("/events", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Opens the invalidation stream and hands each `invalidate` frame to
 * `onInvalidate` as a validated payload. Frames are parsed with the contract's
 * own schema — SSE is a process boundary like any other.
 */
export function createEventStream(options: EventStreamOptions): EventStream {
  const url = eventStreamUrl(options.baseUrl, options.token);
  const factory = options.eventSourceFactory ?? defaultEventSourceFactory;
  const source = factory(url);

  const report = (error: Error): void => {
    if (!options.onError) throw error;
    options.onError(error);
  };

  source.addEventListener(INVALIDATE_EVENT, (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch (cause) {
      report(new Error(`Malformed ${INVALIDATE_EVENT} frame: not JSON.`, { cause }));
      return;
    }
    const result = InvalidatePayloadSchema.safeParse(parsed);
    if (!result.success) {
      report(new Error(`Malformed ${INVALIDATE_EVENT} frame: ${result.error.message}`));
      return;
    }
    options.onInvalidate(result.data);
  });

  source.addEventListener("error", () => {
    report(new Error(`Event stream error from ${url}.`));
  });

  return {
    url,
    close: () => {
      source.close();
    },
  };
}
