import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidatePayloadSchema } from "@corpus/contract";
import { createServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { createLogger, silentLogger, type LogSink } from "../logger.js";
import { createInvalidationBus } from "./bus.js";
import { DOCS_KEY, QUEUE_KEY, REFLECT_KEY, docKey } from "./keys.js";
import {
  GREETING_FRAME,
  HEARTBEAT_FRAME,
  createSseHub,
  invalidateFrame,
  type SseConnection,
} from "./sse.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s007-sse-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.useRealTimers();
});

function makeConfig(): ServerConfig {
  const workspaceRoot = join(root, "ws");
  return {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    embedding: { kind: "absent" },
    warnings: [],
  };
}

/** A stand-in stream that records what it was sent and can be made to fail. */
function fakeConnection(): SseConnection & { chunks: string[]; closes: number; fail: boolean } {
  const state = {
    chunks: [] as string[],
    closes: 0,
    fail: false,
    write(chunk: string) {
      if (state.fail) throw new Error("EPIPE");
      state.chunks.push(chunk);
    },
    close() {
      state.closes += 1;
    },
  };
  return state;
}

describe("invalidateFrame", () => {
  it("emits one `invalidate` event with a single-line JSON payload", () => {
    const frame = invalidateFrame([DOCS_KEY, docKey("doc_a1b2c3")]);
    expect(frame).toBe('event: invalidate\ndata: {"keys":[["docs"],["docs","doc_a1b2c3"]]}\n\n');
    const [, data] = frame.split("\n");
    expect(
      InvalidatePayloadSchema.safeParse(JSON.parse(data?.slice("data: ".length) ?? "")).success,
    ).toBe(true);
  });

  it("keeps a key containing newlines on one `data:` line", () => {
    const frame = invalidateFrame([["docs", "a\nb"]]);
    expect(frame.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
  });
});

describe("createSseHub", () => {
  it("greets a new subscriber so the response headers flush immediately", async () => {
    const hub = createSseHub({ bus: createInvalidationBus(), heartbeatMs: 0 });
    const connection = fakeConnection();

    hub.attach(connection);

    await vi.waitFor(() => expect(connection.chunks).toEqual([GREETING_FRAME]));
    expect(hub.size).toBe(1);
  });

  it("broadcasts every published batch to every subscriber", async () => {
    const bus = createInvalidationBus();
    const hub = createSseHub({ bus, heartbeatMs: 0 });
    const first = fakeConnection();
    const second = fakeConnection();
    hub.attach(first);
    hub.attach(second);

    bus.invalidate([DOCS_KEY]);
    bus.invalidate([QUEUE_KEY]);
    await vi.waitFor(() => {
      expect(first.chunks).toHaveLength(3);
      expect(second.chunks).toHaveLength(3);
    });

    // Each frame carries `["reflect"]` beside the key the test published: the
    // bus applies CONTRACT-076's rule on the way out (SERVER-137).
    expect(first.chunks.slice(1)).toEqual([
      invalidateFrame([DOCS_KEY, REFLECT_KEY]),
      invalidateFrame([QUEUE_KEY, REFLECT_KEY]),
    ]);
    expect(second.chunks).toEqual(first.chunks);
  });

  it("stops writing to a detached subscriber", async () => {
    const bus = createInvalidationBus();
    const hub = createSseHub({ bus, heartbeatMs: 0 });
    const connection = fakeConnection();
    const detach = hub.attach(connection);

    await vi.waitFor(() => expect(connection.chunks).toEqual([GREETING_FRAME]));
    detach();
    detach();
    bus.invalidate([DOCS_KEY]);
    expect(hub.size).toBe(0);

    await vi.waitFor(() => expect(connection.chunks).toEqual([GREETING_FRAME]));
  });

  it("prunes a writer that fails, without logging an error", async () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const bus = createInvalidationBus();
    const hub = createSseHub({ bus, heartbeatMs: 0, logger: createLogger("debug", sink) });
    const broken = fakeConnection();
    const healthy = fakeConnection();
    hub.attach(broken);
    hub.attach(healthy);

    broken.fail = true;
    bus.invalidate([DOCS_KEY]);
    await vi.waitFor(() => expect(hub.size).toBe(1));

    expect(healthy.chunks).toHaveLength(2);
    expect(broken.closes).toBe(1);
    // A peer that went away is a prune, not a fault.
    expect(lines.filter((line) => line.includes('"level":"error"'))).toEqual([]);
    expect(lines.join("\n")).toContain("sse subscriber pruned");

    // A second broadcast reaches the survivor and does not resurrect the dead.
    bus.invalidate([QUEUE_KEY]);
    await vi.waitFor(() => expect(healthy.chunks).toHaveLength(3));
  });

  it("writes a heartbeat comment on the interval, and only while someone listens", async () => {
    vi.useFakeTimers();
    const hub = createSseHub({ bus: createInvalidationBus(), heartbeatMs: 25_000 });
    const connection = fakeConnection();
    const detach = hub.attach(connection);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(connection.chunks).toEqual([GREETING_FRAME, HEARTBEAT_FRAME, HEARTBEAT_FRAME]);

    detach();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(connection.chunks).toHaveLength(3);
  });

  it("closes every stream on shutdown and refuses later attachments", async () => {
    const bus = createInvalidationBus();
    const hub = createSseHub({ bus, heartbeatMs: 0 });
    const connection = fakeConnection();
    hub.attach(connection);
    await vi.waitFor(() => expect(connection.chunks).toEqual([GREETING_FRAME]));

    await hub.close();

    expect(connection.closes).toBe(1);
    expect(hub.size).toBe(0);
    bus.invalidate([DOCS_KEY]);
    expect(connection.chunks).toEqual([GREETING_FRAME]);

    const late = fakeConnection();
    const detach = hub.attach(late);
    detach();
    await vi.waitFor(() => expect(late.closes).toBe(1));
    expect(hub.size).toBe(0);
  });

  it("tolerates a connection whose close throws", async () => {
    const bus = createInvalidationBus();
    const hub = createSseHub({ bus, heartbeatMs: 0 });
    hub.attach({
      write: () => undefined,
      close: () => {
        throw new Error("already destroyed");
      },
    });

    await expect(hub.close()).resolves.toBeUndefined();
  });
});

/** Reads an SSE response until `predicate` is satisfied or the test times out. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!predicate(text)) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return text;
}

describe("GET /events over a real socket", () => {
  it("streams text/event-stream and only `invalidate` frames", async () => {
    const server = createServer(makeConfig(), { heartbeatMs: 0, logger: silentLogger });
    const address = await server.start();
    try {
      const response = await fetch(`${address.url}/events`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get("cache-control")).toContain("no-cache");
      const body = response.body;
      expect(body).not.toBeNull();
      if (body === null) return;

      // Published after the stream is open, from the same bus every write path
      // uses — there is no second emitter.
      const text = await readUntil(body, (seen) => {
        server.bus.invalidate([DOCS_KEY, docKey("doc_a1b2c3")]);
        return seen.includes("event: invalidate");
      });

      const frames = text.split("\n\n").filter((frame) => frame.trim() !== "");
      expect(frames[0]).toBe(":connected");
      const invalidations = frames.filter((frame) => frame.startsWith("event:"));
      expect(invalidations.length).toBeGreaterThan(0);
      for (const frame of invalidations) {
        const [event, data] = frame.split("\n");
        expect(event).toBe("event: invalidate");
        const payload: unknown = JSON.parse((data ?? "").slice("data: ".length));
        expect(InvalidatePayloadSchema.safeParse(payload).success).toBe(true);
        expect(Object.keys(payload as object)).toEqual(["keys"]);
      }
    } finally {
      await server.close();
    }
  });

  it("accepts the token as a query parameter, because EventSource cannot set headers", async () => {
    const server = createServer(makeConfig(), { heartbeatMs: 0, logger: silentLogger });
    const address = await server.start();
    try {
      const response = await fetch(`${address.url}/events?token=${TOKEN}`);
      expect(response.status).toBe(200);
      await response.body?.cancel();

      const rejected = await fetch(`${address.url}/events?token=nope`);
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get("content-type")).toContain("application/json");
      await rejected.body?.cancel();
    } finally {
      await server.close();
    }
  });

  it("prunes a client that hangs up, and keeps serving", async () => {
    const server = createServer(makeConfig(), { heartbeatMs: 0, logger: silentLogger });
    const address = await server.start();
    try {
      const controller = new AbortController();
      const response = await fetch(`${address.url}/events?token=${TOKEN}`, {
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      controller.abort();

      server.bus.invalidate([DOCS_KEY]);
      const health = await fetch(`${address.url}/api/health`);
      expect(health.status).toBe(200);
      await health.body?.cancel();
    } finally {
      await server.close();
    }
  });

  it("releases attached streams so shutdown does not hang on them", async () => {
    const server = createServer(makeConfig(), { heartbeatMs: 0, logger: silentLogger });
    const address = await server.start();
    const response = await fetch(`${address.url}/events?token=${TOKEN}`);
    expect(response.status).toBe(200);

    await server.close();
    // The stream ended because the server closed it, not because the client did.
    const rest = await readUntil(response.body as ReadableStream<Uint8Array>, () => false);
    expect(rest).not.toContain("event:");
  });
});
