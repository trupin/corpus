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

const NO_HELD_EVENTS = { events: [], total: 0, truncated: false };

/** `n` held rows, all claimed a few minutes ago so the ages render stably. */
function heldOf(count: number, total = count): Record<string, unknown> {
  const heldSince = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  return {
    events: Array.from({ length: count }, (_unused, index) => ({
      id: `evt_h${String(index).padStart(3, "0")}`,
      type: "comment.created",
      heldSince,
      originId: "doc_r8",
      originTitle: "Re: the rate assumption",
    })),
    total,
    truncated: total > count,
  };
}

afterEach(closeStubServers);

describe("corpus queue claim-all", () => {
  it("prints the empty batch as one JSON line and nothing else", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { events: [], inProgress: NO_HELD_EVENTS }),
    );

    const harness = stubContext(stub);
    await runClaimAll(harness.context);

    expect(harness.stdout()).toBe(
      '{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}\n',
    );
    // Nothing held, nothing said — this runs on every iteration of the loop.
    expect(harness.stderr()).toBe("");
  });

  it("prints byte-identical stdout in both modes", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { events: eventsOf(2), inProgress: NO_HELD_EVENTS }),
    );

    const human = stubContext(stub);
    await runClaimAll(human.context);
    const machine = stubContext(stub, { json: true });
    await runClaimAll(machine.context);

    expect(human.stdout()).toBe(machine.stdout());
    expect(human.stdout().split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("claims through the contract's path, with no query and no body", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { events: [], inProgress: NO_HELD_EVENTS }),
    );

    await runClaimAll(stubContext(stub).context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/queue/claim-all");
    expect(request?.body).toBe("");
  });

  it("keeps a large batch on one unwrapped, unpaginated line", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { events: eventsOf(200), inProgress: NO_HELD_EVENTS }),
    );

    const harness = stubContext(stub);
    await runClaimAll(harness.context);

    const lines = harness.stdout().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed: { events: unknown[] } = JSON.parse(harness.stdout()) as { events: unknown[] };
    expect(parsed.events).toHaveLength(200);
  });

  it("passes the in-progress set through as its own key, never mixed into the batch", async () => {
    const inProgress = heldOf(2);
    const stub = await startStubServer(jsonResponder(200, { events: eventsOf(1), inProgress }));

    const harness = stubContext(stub, { json: true });
    await runClaimAll(harness.context);

    const parsed = JSON.parse(harness.stdout()) as {
      events: { id: string }[];
      inProgress: typeof inProgress;
    };
    expect(parsed.events.map((event) => event.id)).toEqual(["evt_0000"]);
    expect(parsed.inProgress).toEqual(inProgress);
    // The instant survives to the agent, which computes the age itself.
    expect(parsed.inProgress.events).toHaveLength(2);
    // `--json` says everything on stdout; stderr stays the failure channel.
    expect(harness.stderr()).toBe("");
  });

  it("renders the held events readably on stderr in human mode", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { events: eventsOf(1), inProgress: heldOf(2) }),
    );

    const harness = stubContext(stub);
    await runClaimAll(harness.context);

    // stdout is untouched: still exactly one JSON line, still pipeable.
    expect(harness.stdout().split("\n").filter(Boolean)).toHaveLength(1);
    const stderr = harness.stderr().split("\n").filter(Boolean);
    expect(stderr[0]).toBe(
      "the server still holds 2 events in-progress — not claimed by this call:",
    );
    expect(stderr[1]).toContain("evt_h000  comment.created  held 3m  Re: the rate assumption");
    expect(stderr).toHaveLength(3);
  });

  it("carries the overflow signal to both surfaces", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { events: [], inProgress: heldOf(20, 24) }),
    );

    const human = stubContext(stub);
    await runClaimAll(human.context);
    expect(human.stderr()).toContain("… and 4 more held, not shown (24 in total)");

    const machine = stubContext(stub, { json: true });
    await runClaimAll(machine.context);
    const parsed = JSON.parse(machine.stdout()) as {
      inProgress: { total: number; truncated: boolean; events: unknown[] };
    };
    expect(parsed.inProgress.total).toBe(24);
    expect(parsed.inProgress.truncated).toBe(true);
    expect(parsed.inProgress.events).toHaveLength(20);
  });

  it("still prints the claimed batch when the server omits the report", async () => {
    // The events have already left `pending/` by then: a throw would strand them.
    const stub = await startStubServer(jsonResponder(200, { events: eventsOf(1) }));

    const harness = stubContext(stub);
    await runClaimAll(harness.context);

    expect(harness.stdout()).toContain('"evt_0000"');
    expect(harness.stderr()).toBe("");
  });

  it("is a valid registry entry", () => {
    expect(claimAllCommand.args).toEqual([]);
    expect(claimAllCommand.flags).toEqual([]);
  });
});
