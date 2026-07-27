import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runAcquire, runList, runReap, runRelease } from "./manage.js";

const LOCK = {
  docId: "doc_a1b2c3",
  holder: "agent",
  acquired: "2026-07-27T10:00:00.000Z",
  ttl: 300,
};

const ARGS = { "doc-id": "doc_a1b2c3" };

afterEach(closeStubServers);

describe("corpus lock acquire", () => {
  it("takes the default lease with no body", async () => {
    const stub = await startStubServer(jsonResponder(201, LOCK));

    const harness = stubContext(stub, { args: ARGS });
    await runAcquire(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/locks/doc_a1b2c3");
    expect(stub.requests[0]?.body).toBe("");
    expect(harness.stdout()).toBe("locked doc_a1b2c3 for agent, lease 300s.\n");
  });

  it("sends --ttl as the lease override", async () => {
    const stub = await startStubServer(jsonResponder(201, { ...LOCK, ttl: 60 }));

    const harness = stubContext(stub, { args: ARGS, flags: { ttl: 60 }, json: true });
    await runAcquire(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ ttl: 60 });
    expect(JSON.parse(harness.stdout())).toEqual({ ...LOCK, ttl: 60 });
  });
});

describe("corpus lock release", () => {
  it("deletes the lock and names its holder", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { docId: "doc_a1b2c3", released: true, holder: "agent" }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runRelease(harness.context);

    expect(stub.requests[0]?.method).toBe("DELETE");
    expect(stub.requests[0]?.path).toBe("/api/locks/doc_a1b2c3");
    expect(harness.stdout()).toBe("released the agent lock on doc_a1b2c3.\n");
  });
});

describe("corpus lock list", () => {
  it("says so plainly when nothing is held", async () => {
    const stub = await startStubServer(jsonResponder(200, { locks: [] }));

    const harness = stubContext(stub);
    await runList(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(harness.stdout()).toBe("no locks held.\n");
  });

  it("prints one line per lock and emits the list under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, { locks: [LOCK] }));

    const human = stubContext(stub);
    await runList(human.context);
    expect(human.stdout()).toBe(
      "doc_a1b2c3 — agent, acquired 2026-07-27T10:00:00.000Z, lease 300s\n",
    );

    const machine = stubContext(stub, { json: true });
    await runList(machine.context);
    expect(JSON.parse(machine.stdout())).toEqual({ locks: [LOCK] });
  });
});

describe("corpus lock reap", () => {
  it("reports nothing cleared, and exits 0 doing it", async () => {
    const stub = await startStubServer(jsonResponder(200, { reaped: [] }));

    const harness = stubContext(stub);
    await runReap(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/locks/reap");
    expect(harness.stdout()).toBe("no expired locks.\n");
  });

  it("names the documents whose leases it cleared", async () => {
    const stub = await startStubServer(jsonResponder(200, { reaped: ["doc_a1b2c3"] }));

    const human = stubContext(stub);
    await runReap(human.context);
    expect(human.stdout()).toBe("cleared 1 expired lock(s): doc_a1b2c3\n");

    const machine = stubContext(stub, { json: true });
    await runReap(machine.context);
    expect(JSON.parse(machine.stdout())).toEqual({ reaped: ["doc_a1b2c3"] });
  });
});
