import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runHalt, runReapStale, runResume, runStatus } from "./control.js";

const RUNNING = {
  halted: false,
  pending: 2,
  inProgress: 1,
  processed: 7,
  failed: 0,
  abandoned: 3,
};

const HALTED = { ...RUNNING, halted: true };

afterEach(closeStubServers);

describe("corpus queue halt", () => {
  it("sends no body for a bare halt", async () => {
    const stub = await startStubServer(jsonResponder(200, HALTED));

    const harness = stubContext(stub);
    await runHalt(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/queue/halt");
    expect(stub.requests[0]?.body).toBe("");
    expect(harness.stdout()).toContain("queue halted —");
  });

  it("passes --reason through to the sentinel", async () => {
    const stub = await startStubServer(jsonResponder(200, HALTED));

    const harness = stubContext(stub, { flags: { reason: "maintenance window" } });
    await runHalt(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ reason: "maintenance window" });
    expect(harness.stdout()).toContain("queue halted (maintenance window)");
  });

  it("treats a blank reason as no reason", async () => {
    const stub = await startStubServer(jsonResponder(200, HALTED));

    await runHalt(stubContext(stub, { flags: { reason: "" } }).context);

    expect(stub.requests[0]?.body).toBe("");
  });

  it("emits the queue status under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, HALTED));

    const harness = stubContext(stub, { json: true });
    await runHalt(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(HALTED);
  });
});

describe("corpus queue resume", () => {
  it("posts to resume and reports the queue depth", async () => {
    const stub = await startStubServer(jsonResponder(200, RUNNING));

    const harness = stubContext(stub);
    await runResume(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/queue/resume");
    expect(harness.stdout()).toBe(
      "queue resumed — pending 2, in-progress 1, processed 7, failed 0, abandoned 3\n",
    );
  });
});

describe("corpus queue status", () => {
  it("names the halt state in its one human line", async () => {
    const halted = await startStubServer(jsonResponder(200, HALTED));
    const haltedHarness = stubContext(halted);
    await runStatus(haltedHarness.context);
    expect(haltedHarness.stdout()).toContain("queue halted —");

    const running = await startStubServer(jsonResponder(200, RUNNING));
    const runningHarness = stubContext(running);
    await runStatus(runningHarness.context);
    expect(runningHarness.stdout()).toContain("queue running —");
    expect(running.requests[0]?.method).toBe("GET");
    expect(running.requests[0]?.path).toBe("/api/queue/status");
  });

  it("emits the five counts and the halt flag under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, RUNNING));

    const harness = stubContext(stub, { json: true });
    await runStatus(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(RUNNING);
  });
});

describe("corpus queue reap-stale", () => {
  it("is silent when nothing was stale", async () => {
    const stub = await startStubServer(jsonResponder(200, { reaped: [] }));

    const harness = stubContext(stub);
    await runReapStale(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/queue/reap-stale");
    expect(harness.stdout()).toBe("");
  });

  it("names what it recovered", async () => {
    const stub = await startStubServer(jsonResponder(200, { reaped: ["evt_1111", "evt_2222"] }));

    const harness = stubContext(stub);
    await runReapStale(harness.context);

    expect(harness.stdout()).toBe("returned 2 stale event(s) to pending: evt_1111, evt_2222\n");
  });

  it("emits the reaped list under --json, empty included", async () => {
    const stub = await startStubServer(jsonResponder(200, { reaped: [] }));

    const harness = stubContext(stub, { json: true });
    await runReapStale(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ reaped: [] });
  });

  it("sends no query parameters: the staleness threshold is the server's", async () => {
    const stub = await startStubServer(jsonResponder(200, { reaped: [] }));

    await runReapStale(stubContext(stub).context);

    expect(stub.requests[0]?.url).toBe("/api/queue/reap-stale");
  });
});
