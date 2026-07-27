import { afterEach, describe, expect, it } from "vitest";
import { MAX_IDLE_TIMEOUT_SECONDS } from "@corpus/contract";
import { ServerResponseError, ServerUnreachableError } from "../../errors.js";
import {
  closeStubServers,
  sendJson,
  sendNoContent,
  startStubServer,
  type StubServer,
} from "../../testing/stub-server.js";
import { pollWindow, IDLE_RETRY_BACKOFF_MS } from "./poll.js";

const EVENT = {
  id: "evt_1111",
  type: "comment.created",
  created: "2026-07-27T10:00:00.000Z",
  source: "ui",
  payload: { threadId: "th_2222" },
};

afterEach(closeStubServers);

function timeoutsAsked(stub: StubServer): readonly number[] {
  return stub.requestsTo("/api/queue/idle").map((request) => Number(request.query.get("timeout")));
}

describe("pollWindow", () => {
  it("returns the events the instant the server answers, well inside the window", async () => {
    const stub = await startStubServer((_request, response) => {
      setTimeout(() => sendJson(response, 200, { events: [EVENT] }), 20);
    });

    const started = Date.now();
    const outcome = await pollWindow({
      client: stub.client,
      windowMs: 60_000,
      signal: new AbortController().signal,
    });

    expect(outcome).toEqual({ kind: "events", events: [EVENT], requests: 1 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("asks the server for the whole window when it fits in one hold", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { events: [EVENT] });
    });

    await pollWindow({
      client: stub.client,
      windowMs: MAX_IDLE_TIMEOUT_SECONDS * 1000,
      signal: new AbortController().signal,
    });

    expect(timeoutsAsked(stub)).toEqual([MAX_IDLE_TIMEOUT_SECONDS]);
  });

  it("segments a window longer than the server's maximum, shrinking monotonically", async () => {
    // A fake clock advanced by exactly what each hold was asked for: the point
    // under test is which windows are requested, not how long the test sleeps.
    let clock = 0;
    const stub = await startStubServer((request, response) => {
      clock += Number(request.query.get("timeout")) * 1000;
      sendNoContent(response);
    });

    const outcome = await pollWindow({
      client: stub.client,
      windowMs: 900_000,
      signal: new AbortController().signal,
      now: () => clock,
    });

    expect(outcome).toEqual({ kind: "expired", requests: 2 });
    expect(timeoutsAsked(stub)).toEqual([MAX_IDLE_TIMEOUT_SECONDS, 900 - MAX_IDLE_TIMEOUT_SECONDS]);
  });

  it("hides intermediate server expiries: two 204s then an event is one outcome", async () => {
    let clock = 0;
    let answered = 0;
    const stub = await startStubServer((request, response) => {
      clock += Number(request.query.get("timeout")) * 1000;
      answered += 1;
      if (answered <= 2) return sendNoContent(response);
      sendJson(response, 200, { events: [EVENT] });
    });

    const outcome = await pollWindow({
      client: stub.client,
      windowMs: 30_000,
      signal: new AbortController().signal,
      now: () => clock,
      maxSegmentSeconds: 5,
    });

    expect(outcome).toEqual({ kind: "events", events: [EVENT], requests: 3 });
  });

  it("issues exactly one request for a zero window, asking for the schema's minimum", async () => {
    const stub = await startStubServer((_request, response) => {
      sendNoContent(response);
    });

    const outcome = await pollWindow({
      client: stub.client,
      windowMs: 0,
      signal: new AbortController().signal,
    });

    expect(outcome).toEqual({ kind: "expired", requests: 1 });
    expect(timeoutsAsked(stub)).toEqual([1]);
  });

  it("retries once when the connection is dropped mid-request", async () => {
    let attempts = 0;
    const stub = await startStubServer((_request, response) => {
      attempts += 1;
      if (attempts === 1) {
        response.destroy();
        return;
      }
      sendJson(response, 200, { events: [EVENT] });
    });

    const outcome = await pollWindow({
      client: stub.client,
      windowMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(outcome).toEqual({ kind: "events", events: [EVENT], requests: 2 });
  });

  it("gives up loudly on a second consecutive transport failure", async () => {
    const stub = await startStubServer((_request, response) => {
      response.destroy();
    });

    await expect(
      pollWindow({
        client: stub.client,
        windowMs: 30_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ServerUnreachableError);
    expect(stub.requestsTo("/api/queue/idle")).toHaveLength(2);
  });

  it("names the command to run when nothing is listening at all", async () => {
    const stub = await startStubServer((_request, response) => {
      sendNoContent(response);
    });
    await stub.close();

    await expect(
      pollWindow({ client: stub.client, windowMs: 30_000, signal: new AbortController().signal }),
    ).rejects.toThrow("run `corpus server start`");
  });

  it("does not retry a real answer: a server error propagates from the first request", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 500, { code: "internal_error", message: "boom" });
    });

    await expect(
      pollWindow({ client: stub.client, windowMs: 30_000, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(ServerResponseError);
    expect(stub.requestsTo("/api/queue/idle")).toHaveLength(1);
  });

  it("treats a 200 with no body as a server error rather than a park", async () => {
    const stub = await startStubServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("");
    });

    await expect(
      pollWindow({ client: stub.client, windowMs: 0, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(ServerResponseError);
  });

  it("resolves as interrupted when the signal aborts mid-hold, and prints nothing", async () => {
    const stub = await startStubServer(() => {
      // Held open: the abort is what ends this request.
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    await expect(
      pollWindow({ client: stub.client, windowMs: 60_000, signal: controller.signal }),
    ).resolves.toEqual({ kind: "interrupted", requests: 1 });
  });

  it("never issues a request when it starts already aborted", async () => {
    const stub = await startStubServer((_request, response) => {
      sendNoContent(response);
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      pollWindow({ client: stub.client, windowMs: 60_000, signal: controller.signal }),
    ).resolves.toEqual({ kind: "interrupted", requests: 0 });
    expect(stub.requests).toHaveLength(0);
  });

  it("does not wait out the retry backoff when the interrupt arrives inside it", async () => {
    const stub = await startStubServer((_request, response) => {
      response.destroy();
    });
    const controller = new AbortController();

    const started = Date.now();
    const outcome = await pollWindow({
      client: stub.client,
      windowMs: 60_000,
      signal: controller.signal,
      sleep: async (ms, signal) => {
        // The real backoff resolves early on abort; this asserts the loop asks
        // for that and then stops rather than issuing the retry.
        expect(ms).toBe(IDLE_RETRY_BACKOFF_MS);
        controller.abort();
        expect(signal.aborted).toBe(true);
        await Promise.resolve();
      },
    });

    expect(outcome).toEqual({ kind: "interrupted", requests: 1 });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
