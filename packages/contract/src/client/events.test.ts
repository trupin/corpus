import { describe, expect, it, vi } from "vitest";
import type { InvalidatePayload } from "../schemas/sse.js";
import { createEventStream, eventStreamUrl, redactedUrl, type EventSourceLike } from "./events.js";

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, (event: { readonly data: string }) => void>();
  closed = false;

  addEventListener(type: string, listener: (event: { readonly data: string }) => void): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    const listener = this.listeners.get(type);
    if (!listener) throw new Error(`nothing listening for ${type}`);
    listener({ data });
  }
}

function connect(onError?: (error: Error) => void) {
  const source = new FakeEventSource();
  const received: InvalidatePayload[] = [];
  const stream = createEventStream({
    baseUrl: "http://127.0.0.1:8765",
    token: "tok en",
    onInvalidate: (payload) => received.push(payload),
    ...(onError ? { onError } : {}),
    eventSourceFactory: () => source,
  });
  return { source, received, stream };
}

describe("eventStreamUrl", () => {
  it("targets /events and carries the token, which EventSource cannot send as a header", () => {
    expect(eventStreamUrl("http://127.0.0.1:8765", "s3cret")).toBe(
      "http://127.0.0.1:8765/events?token=s3cret",
    );
  });

  it("percent-encodes a token with URL-unsafe characters", () => {
    expect(eventStreamUrl("http://127.0.0.1:8765", "a b&c")).toBe(
      "http://127.0.0.1:8765/events?token=a+b%26c",
    );
  });

  it("ignores a path on the base URL, since /events is absolute on the origin", () => {
    expect(eventStreamUrl("http://127.0.0.1:8765/ui/", "t")).toBe(
      "http://127.0.0.1:8765/events?token=t",
    );
  });
});

describe("redactedUrl", () => {
  it("masks the token value and only the token value", () => {
    expect(redactedUrl("http://127.0.0.1:8765/events?token=s3cret")).toBe(
      "http://127.0.0.1:8765/events?token=REDACTED",
    );
  });

  it("leaves a URL without a token untouched", () => {
    expect(redactedUrl("http://127.0.0.1:8765/events")).toBe("http://127.0.0.1:8765/events");
  });
});

describe("createEventStream", () => {
  it("hands a parsed invalidate frame to the caller", () => {
    const { source, received } = connect();
    source.emit("invalidate", JSON.stringify({ keys: [["docs"], ["threads", "th_x9y8"]] }));
    expect(received).toEqual([{ keys: [["docs"], ["threads", "th_x9y8"]] }]);
  });

  it("exposes the URL it connected to", () => {
    const { stream } = connect();
    expect(stream.url).toBe("http://127.0.0.1:8765/events?token=tok+en");
  });

  it("closes the underlying source", () => {
    const { source, stream } = connect();
    stream.close();
    expect(source.closed).toBe(true);
  });

  it("reports a frame that is not JSON instead of throwing into the event loop", () => {
    const onError = vi.fn();
    const { source, received } = connect(onError);
    source.emit("invalidate", "not json");
    expect(received).toEqual([]);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(String(onError.mock.calls[0]?.[0])).toContain("not JSON");
  });

  it("reports a frame that does not match the contract", () => {
    const onError = vi.fn();
    const { source, received } = connect(onError);
    source.emit("invalidate", JSON.stringify({ keys: [] }));
    expect(received).toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("reports transport errors with the token redacted, since errors get logged", () => {
    const onError = vi.fn();
    const { source } = connect(onError);
    source.emit("error", "");
    const message = String(onError.mock.calls[0]?.[0]);
    expect(message).toContain("Event stream error");
    expect(message).toContain("token=REDACTED");
    expect(message).not.toContain("tok+en");
  });

  it("throws when no error handler was supplied, rather than swallowing the failure", () => {
    const { source } = connect();
    expect(() => source.emit("invalidate", "{")).toThrow(/not JSON/);
  });

  it("explains itself when the runtime has no global EventSource", () => {
    const globalWithSource = globalThis as { EventSource?: unknown };
    const original = globalWithSource.EventSource;
    delete globalWithSource.EventSource;
    try {
      expect(() =>
        createEventStream({
          baseUrl: "http://127.0.0.1:8765",
          token: "t",
          onInvalidate: () => undefined,
        }),
      ).toThrow(/No global EventSource/);
    } finally {
      if (original !== undefined) globalWithSource.EventSource = original;
    }
  });

  it("uses a global EventSource when the runtime provides one", () => {
    const globalWithSource = globalThis as { EventSource?: unknown };
    const original = globalWithSource.EventSource;
    const constructed: string[] = [];
    globalWithSource.EventSource = class {
      constructor(url: string) {
        constructed.push(url);
      }
      addEventListener(): void {}
      close(): void {}
    };
    try {
      createEventStream({
        baseUrl: "http://127.0.0.1:8765",
        token: "t",
        onInvalidate: () => undefined,
      });
      expect(constructed).toEqual(["http://127.0.0.1:8765/events?token=t"]);
    } finally {
      if (original === undefined) delete globalWithSource.EventSource;
      else globalWithSource.EventSource = original;
    }
  });
});
