import type { EventSourceFactory, EventSourceLike } from "@corpus/contract/client";

/**
 * An `EventSource` double. Unlike the contract's own single-listener fake, this
 * one keeps every listener for a type: the kit's bridge attaches its own `error`
 * handler alongside the one `createEventStream` registers, and a Map that
 * overwrote would silently drop one of them.
 */
export class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, ((event: { readonly data: string }) => void)[]>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { readonly data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** Delivers a frame to every listener for `type`, as the browser would. */
  emit(type: string, data = ""): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  /** Delivers a well-formed `invalidate` frame carrying the given keys. */
  invalidate(...keys: readonly unknown[]): void {
    this.emit("invalidate", JSON.stringify({ keys }));
  }
}

export interface RecordingEventSourceFactory {
  (url: string): EventSourceLike;
  /** Every source built, in order. Its length is the connection count. */
  readonly sources: FakeEventSource[];
  /** The most recent source, which is the only live one. */
  latest(): FakeEventSource;
}

/** A factory that records what it built, so a test can count connections. */
export function fakeEventSourceFactory(): RecordingEventSourceFactory {
  const sources: FakeEventSource[] = [];
  const factory = (url: string): EventSourceLike => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  };
  return Object.assign(factory, {
    sources,
    latest(): FakeEventSource {
      const source = sources.at(-1);
      if (source === undefined) throw new Error("no EventSource has been constructed yet");
      return source;
    },
  });
}

/** A factory that always throws, modelling a runtime with no `EventSource`. */
export function failingEventSourceFactory(message = "no EventSource here"): EventSourceFactory {
  return () => {
    throw new Error(message);
  };
}
