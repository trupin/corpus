import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_IDLE_TIMEOUT_SECONDS } from "@corpus/contract";
import { collectRegistryProblems } from "../../registry/validate.js";
import type { InterruptSignal, SignalTarget } from "../../signals.js";
import {
  closeStubServers,
  sendJson,
  sendNoContent,
  startStubServer,
  stubContext,
  type StubServer,
} from "../../testing/stub-server.js";
import { idleCommand, runIdle } from "./idle.js";

const EVENT = {
  id: "evt_1111",
  type: "comment.created",
  created: "2026-07-27T10:00:00.000Z",
  source: "ui",
  payload: { threadId: "th_2222" },
};

const RUNNING = {
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

/** No held events — the normal case, and the one that must print nothing. */
const NO_HELD_EVENTS = { events: [], total: 0, truncated: false };

const HELD = {
  events: [
    {
      id: "evt_h000",
      type: "comment.created",
      heldSince: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      originId: "doc_r8",
      originTitle: "Re: the rate assumption",
    },
  ],
  total: 4,
  truncated: true,
};

afterEach(closeStubServers);

/** A fake `process` whose handlers a test can fire, and whose leaks it can see. */
function fakeSignals(): SignalTarget & { fire(): void; count(): number } {
  const listeners = new Set<() => void>();
  return {
    on: (_signal: InterruptSignal, listener: () => void) => listeners.add(listener),
    off: (_signal: InterruptSignal, listener: () => void) => listeners.delete(listener),
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
    // Two signals share one listener object, so the set counts installations.
    count: () => listeners.size,
  };
}

/** Answers `/api/queue/idle` per script and `/api/queue/status` with `halted`. */
async function idleStub(
  idle: (request: { query: URLSearchParams }) => "events" | "expire" | "hold",
  halted = false,
  inProgress: unknown = NO_HELD_EVENTS,
): Promise<StubServer> {
  return startStubServer((request, response) => {
    if (request.path === "/api/queue/status") {
      sendJson(response, 200, { ...RUNNING, halted });
      return;
    }
    const outcome = idle({ query: request.query });
    if (outcome === "events") sendJson(response, 200, { events: [EVENT], inProgress });
    else if (outcome === "expire") sendNoContent(response);
  });
}

describe("corpus queue idle", () => {
  it("prints one id/type line per event and emits the idle result under --json", async () => {
    const stub = await idleStub(() => "events");

    const human = stubContext(stub, { flags: { wait: 5 } });
    await runIdle(human.context, { signals: fakeSignals() });
    expect(human.stdout()).toBe("evt_1111 comment.created\n");
    // Nothing held: the report adds nothing to the loop's normal iteration.
    expect(human.stderr()).toBe("");

    const machine = stubContext(stub, { flags: { wait: 5 }, json: true });
    await runIdle(machine.context, { signals: fakeSignals() });
    expect(JSON.parse(machine.stdout())).toEqual({
      events: [EVENT],
      inProgress: NO_HELD_EVENTS,
    });
  });

  it("reports what the server still holds, as its own key and its own stream", async () => {
    const stub = await idleStub(() => "events", false, HELD);

    const human = stubContext(stub, { flags: { wait: 5 } });
    await runIdle(human.context, { signals: fakeSignals() });
    // Pending ids on stdout, the server's view on stderr: the two lists answer
    // different questions and never share a stream.
    expect(human.stdout()).toBe("evt_1111 comment.created\n");
    expect(human.stderr().split("\n").filter(Boolean)).toEqual([
      "the server still holds 4 events in-progress — not claimed by this call:",
      "  evt_h000  comment.created  held 3h  Re: the rate assumption",
      "  … and 3 more held, not shown (4 in total)",
    ]);

    const machine = stubContext(stub, { flags: { wait: 5 }, json: true });
    await runIdle(machine.context, { signals: fakeSignals() });
    expect(JSON.parse(machine.stdout())).toEqual({ events: [EVENT], inProgress: HELD });
    expect(machine.stderr()).toBe("");
  });

  it("writes nothing at all while parked", async () => {
    let release: (() => void) | undefined;
    const stub = await startStubServer((request, response) => {
      if (request.path === "/api/queue/status") return sendJson(response, 200, RUNNING);
      release = () => sendJson(response, 200, { events: [EVENT], inProgress: NO_HELD_EVENTS });
    });

    const harness = stubContext(stub, { flags: { wait: 30 }, json: true });
    const running = runIdle(harness.context, { signals: fakeSignals() });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toBe("");

    release?.();
    await running;
    expect(JSON.parse(harness.stdout())).toEqual({ events: [EVENT], inProgress: NO_HELD_EVENTS });
  });

  it("reports an expired window as a timeout, not an error", async () => {
    const stub = await idleStub(() => "expire");

    const harness = stubContext(stub, { flags: { wait: 0 }, json: true });
    await runIdle(harness.context, { signals: fakeSignals() });

    expect(JSON.parse(harness.stdout())).toEqual({ idle: true, reason: "timeout" });
  });

  it("distinguishes a halted queue from an empty one", async () => {
    const stub = await idleStub(() => "expire", true);

    const machine = stubContext(stub, { flags: { wait: 0 }, json: true });
    await runIdle(machine.context, { signals: fakeSignals() });
    expect(JSON.parse(machine.stdout())).toEqual({ idle: true, reason: "halted" });

    const human = stubContext(stub, { flags: { wait: 0 } });
    await runIdle(human.context, { signals: fakeSignals() });
    expect(human.stdout()).toBe("idle — no events (halted)\n");
  });

  it("probes the queue exactly once with a zero window", async () => {
    const stub = await idleStub(() => "expire");

    await runIdle(stubContext(stub, { flags: { wait: 0 } }).context, { signals: fakeSignals() });

    const polls = stub.requestsTo("/api/queue/idle");
    expect(polls).toHaveLength(1);
    // The schema's minimum is 1: a zero window cannot be sent as `timeout=0`.
    expect(polls[0]?.query.get("timeout")).toBe("1");
    // The reason for the expiry is the one extra request, and it is the only one.
    expect(stub.requestsTo("/api/queue/status")).toHaveLength(1);
  });

  it("parks for the contract's default window when --wait is absent", async () => {
    const stub = await idleStub(() => "events");

    await runIdle(stubContext(stub).context, { signals: fakeSignals() });

    expect(stub.requestsTo("/api/queue/idle")[0]?.query.get("timeout")).toBe(
      String(DEFAULT_IDLE_TIMEOUT_SECONDS),
    );
  });

  it("exits silently when interrupted, and leaves no handler behind", async () => {
    const stub = await startStubServer(() => {
      // Held open until the interrupt aborts it.
    });
    const signals = fakeSignals();

    const harness = stubContext(stub, { flags: { wait: 300 }, json: true });
    const running = runIdle(harness.context, { signals });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signals.count()).toBe(1);
    signals.fire();
    await running;

    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toBe("");
    expect(signals.count()).toBe(0);
  });

  it("removes its handlers when the window ends normally", async () => {
    const stub = await idleStub(() => "events");
    const signals = fakeSignals();

    await runIdle(stubContext(stub, { flags: { wait: 5 } }).context, { signals });

    expect(signals.count()).toBe(0);
  });

  it("declares a parking flag that does not shadow the global transport timeout", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [idleCommand], topics: [] })).toEqual(
      [],
    );
    expect(idleCommand.flags.map((flag) => flag.name)).toEqual(["wait"]);
  });
});
