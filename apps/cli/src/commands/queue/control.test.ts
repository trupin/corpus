import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_PRESENCE_WINDOW_SECONDS, QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { formatAge } from "../age.js";
import {
  presenceLine,
  runHalt,
  runReapStale,
  runResume,
  runStatus,
  statusCommand,
} from "./control.js";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

const PRESENT = { live: true, since: "2026-08-16T11:58:00.000Z" };

const RUNNING = {
  agent: PRESENT,
  halted: false,
  pending: 2,
  inProgress: 1,
  deferred: 4,
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
    // Every status the contract declares appears, in its lifecycle order —
    // `deferred` between the live and the terminal states, never beside
    // `failed`, because it is work that resumes by itself (CONTRACT-021).
    expect(harness.stdout()).toBe(
      "queue resumed — pending 2, in-progress 1, deferred 4, processed 7, failed 0, abandoned 3\n",
    );
  });

  it("names every status the contract declares, so a new one cannot go unreported", async () => {
    const stub = await startStubServer(jsonResponder(200, RUNNING));

    const harness = stubContext(stub);
    await runResume(harness.context);

    for (const status of QUEUE_EVENT_STATUSES) {
      expect(harness.stdout()).toContain(status);
    }
  });
});

describe("corpus queue status", () => {
  it("names the halt state in its depth line", async () => {
    const halted = await startStubServer(jsonResponder(200, HALTED));
    const haltedHarness = stubContext(halted);
    await runStatus(haltedHarness.context, NOW);
    expect(haltedHarness.stdout()).toContain("queue halted —");

    const running = await startStubServer(jsonResponder(200, RUNNING));
    const runningHarness = stubContext(running);
    await runStatus(runningHarness.context, NOW);
    expect(runningHarness.stdout()).toContain("queue running —");
    expect(running.requests[0]?.method).toBe("GET");
    expect(running.requests[0]?.path).toBe("/api/queue/status");
  });

  it("says whether an agent is there, and since when, beneath the depth", async () => {
    const stub = await startStubServer(jsonResponder(200, RUNNING));

    const harness = stubContext(stub);
    await runStatus(harness.context, NOW);

    expect(harness.stdout().split("\n").filter(Boolean)).toEqual([
      "queue running — pending 2, in-progress 1, deferred 4, processed 7, failed 0, abandoned 3",
      "agent present, parked 2m ago",
    ]);
  });

  it("asks the queue and nothing else: presence is not corroborated against the roster", async () => {
    // CONTRACT-053 — `QueueStatus.agent` and `GET /api/agents` can legitimately
    // disagree for one grace window, so a second read here would produce a line
    // that is two facts pretending to be one.
    const stub = await startStubServer(jsonResponder(200, RUNNING));

    await runStatus(stubContext(stub).context, NOW);

    expect(stub.requests.map((request) => request.path)).toEqual(["/api/queue/status"]);
  });

  it("emits the counts, the halt flag and the presence under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, RUNNING));

    const harness = stubContext(stub, { json: true });
    await runStatus(harness.context, NOW);

    // Verbatim, `since` still an instant: the age is this CLI's rendering and
    // never something a machine reader has to un-render.
    expect(JSON.parse(harness.stdout())).toEqual(RUNNING);
    expect(harness.stdout()).toContain('"agent"');
  });
});

describe("the presence line", () => {
  it("distinguishes a listener that has gone from one that was never seen", () => {
    expect(presenceLine({ ...RUNNING, agent: { live: false, since: null } }, NOW)).toBe(
      "no agent — none has parked since the server started",
    );
    expect(
      presenceLine({ ...RUNNING, agent: { live: false, since: "2026-08-16T09:00:00.000Z" } }, NOW),
    ).toBe("no agent — last parked 3h ago");
  });

  it("refuses to read a status that did not answer as a status saying nobody is there", () => {
    // Required on the wire (CONTRACT-045), so this shape cannot be typed —
    // and it still arrives, from a server built before the field existed or a
    // proxy that trimmed it. It must degrade to *unknown*, never to a claim
    // and never to a TypeError (UI-098's rule, in the surface an agent reads).
    const { agent: _agent, ...withoutPresence } = RUNNING;
    const status = withoutPresence as unknown as typeof RUNNING;

    expect(presenceLine(status, NOW)).toBe(
      "agent presence unknown — this server did not report it",
    );
    expect(presenceLine(status, NOW)).not.toContain("no agent");
  });

  it("prints the bare verdict rather than an age it cannot compute", () => {
    expect(presenceLine({ ...RUNNING, agent: { live: true, since: "not an instant" } }, NOW)).toBe(
      "agent present",
    );
    expect(presenceLine({ ...RUNNING, agent: { live: false, since: "not an instant" } }, NOW)).toBe(
      "no agent",
    );
  });

  it("reaches the end of the whole command's output", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { ...RUNNING, agent: { live: false, since: null } }),
    );

    const harness = stubContext(stub);
    await runStatus(harness.context, NOW);

    expect(harness.stdout()).toContain("no agent — none has parked since the server started");
  });
});

describe("halt and resume", () => {
  it("report what the act did and say nothing about presence", async () => {
    // The status verb answers "why is nothing happening"; these two are acts.
    const halted = await startStubServer(jsonResponder(200, HALTED));
    const haltedHarness = stubContext(halted);
    await runHalt(haltedHarness.context);
    expect(haltedHarness.stdout().split("\n").filter(Boolean)).toHaveLength(1);

    const resumed = await startStubServer(jsonResponder(200, RUNNING));
    const resumedHarness = stubContext(resumed);
    await runResume(resumedHarness.context);
    expect(resumedHarness.stdout().split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("the status command spec", () => {
  it("documents the grace window from the contract's constant rather than a literal", async () => {
    expect(statusCommand.description).toContain(
      `grace window (${formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000)})`,
    );

    // Value equality cannot tell a derivation from a literal that happens to
    // agree with it today (CLI-043's lapse note makes the same point), so the
    // module is required to reach the constant rather than restate it. It does
    // so through `agents.ts`'s `GRACE_WINDOW`, which names it.
    const source = await readFile(join(import.meta.dirname, "control.ts"), "utf8");
    expect(source).toMatch(/import \{[^}]*GRACE_WINDOW[^}]*\} from "\.\.\/agents\.js"/);
    expect(source).not.toMatch(/grace window \(\d/);
  });

  it("keeps the queue's own presence and the roster apart", () => {
    expect(statusCommand.description).toContain("corpus agents");
    expect(statusCommand.description).toContain("honestly disagree");
  });

  it("shows `agent` in the --json example, since the route returns it", () => {
    const example = statusCommand.examples.find((one) => one.command.endsWith("--json"));
    expect(example?.description).toContain('"agent":{"live":true');
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
