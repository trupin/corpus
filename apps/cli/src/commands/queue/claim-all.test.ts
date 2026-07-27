import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { claimAllCommand, runClaimAll } from "./claim-all.js";

function eventsOf(count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `evt_${String(index).padStart(4, "0")}`,
    type: "comment.created",
    created: "2026-07-27T10:00:00.000Z",
    source: "ui",
    payload: { threadId: `th_${String(index)}` },
  }));
}

afterEach(closeStubServers);

describe("corpus queue claim-all", () => {
  it("prints the empty batch as one JSON line and nothing else", async () => {
    const stub = await startStubServer(jsonResponder(200, { events: [] }));

    const harness = stubContext(stub);
    await runClaimAll(harness.context);

    expect(harness.stdout()).toBe('{"events":[]}\n');
    expect(harness.stderr()).toBe("");
  });

  it("prints byte-identical output in both modes", async () => {
    const stub = await startStubServer(jsonResponder(200, { events: eventsOf(2) }));

    const human = stubContext(stub);
    await runClaimAll(human.context);
    const machine = stubContext(stub, { json: true });
    await runClaimAll(machine.context);

    expect(human.stdout()).toBe(machine.stdout());
    expect(human.stdout().split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("claims through the contract's path, with no query and no body", async () => {
    const stub = await startStubServer(jsonResponder(200, { events: [] }));

    await runClaimAll(stubContext(stub).context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/queue/claim-all");
    expect(request?.body).toBe("");
  });

  it("keeps a large batch on one unwrapped, unpaginated line", async () => {
    const stub = await startStubServer(jsonResponder(200, { events: eventsOf(200) }));

    const harness = stubContext(stub);
    await runClaimAll(harness.context);

    const lines = harness.stdout().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed: { events: unknown[] } = JSON.parse(harness.stdout()) as { events: unknown[] };
    expect(parsed.events).toHaveLength(200);
  });

  it("is a valid registry entry", () => {
    expect(claimAllCommand.args).toEqual([]);
    expect(claimAllCommand.flags).toEqual([]);
  });
});
