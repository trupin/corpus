import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_PRESENCE_WINDOW_SECONDS, ORCHESTRATOR_LANE } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { collectRegistryProblems } from "../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../testing/stub-server.js";
import { agentsCommand, GRACE_WINDOW, presenceOf, renderLane, runAgents } from "./agents.js";
import { formatAge } from "./age.js";

/**
 * `corpus agents` is a **read** and this file's job is to keep it one: nothing
 * below sends anything, and the rendering is asserted against rows the server
 * produced rather than against anything derived here (SPEC.md §7 — presence is
 * the parked request and nothing else).
 */

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

/** `n` seconds before {@link NOW}, as the instant the wire carries. */
function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

const ORCHESTRATOR_ROW = {
  lane: ORCHESTRATOR_LANE,
  resident: null,
  live: true,
  since: ago(120),
  summary: "working the Q3 draft",
  origin: null,
};

const LIVE_LANE = {
  lane: "th_4b8e2c",
  resident: { name: "researcher", docId: "doc_r1" },
  live: true,
  since: ago(12),
  summary: "reading the mortgage docs",
  origin: { id: "th_4b8e2c", title: "Q3 planning" },
};

const LAPSED_LANE = {
  lane: "th_9f1a2b",
  resident: { name: "analyst", docId: "doc_a7" },
  live: false,
  since: ago(41 * 60),
  summary: null,
  origin: { id: "th_9f1a2b", title: "Rate check" },
};

const WAITING_LANE = {
  lane: "th_c0ffee",
  resident: { name: "scribe", docId: "doc_s3" },
  live: false,
  since: null,
  summary: null,
  origin: { id: "th_c0ffee", title: "New idea" },
};

afterEach(closeStubServers);

describe("corpus agents", () => {
  it("prints one row per lane, the orchestrator's first", async () => {
    const roster = { agents: [ORCHESTRATOR_ROW, LIVE_LANE, LAPSED_LANE, WAITING_LANE] };
    const stub = await startStubServer(jsonResponder(200, roster));

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/agents");
    expect(harness.stdout().split("\n").filter(Boolean)).toEqual([
      "orchestrator · live, parked 2m ago — working the Q3 draft",
      'th_4b8e2c "Q3 planning" · researcher · live, parked 12s ago — reading the mortgage docs',
      'th_9f1a2b "Rate check" · analyst · lapsed, last parked 41m ago',
      'th_c0ffee "New idea" · scribe · waiting for a listener',
    ]);
  });

  it("names the three states apart, because they mean different things", () => {
    expect(presenceOf(LIVE_LANE)).toBe("live");
    // A listener was here and has gone: the lane has a history.
    expect(presenceOf(LAPSED_LANE)).toBe("lapsed");
    // Nothing has ever parked here: a designation nobody has started a listener
    // for, which is not the same fact as an agent that stopped.
    expect(presenceOf(WAITING_LANE)).toBe("waiting");
  });

  it("gives the orchestrator's row no resident cell at all", () => {
    // Nobody designates the orchestrator, so an em dash there would read as a
    // vacancy somebody could fill.
    expect(renderLane(ORCHESTRATOR_ROW, NOW)).toBe(
      "orchestrator · live, parked 2m ago — working the Q3 draft",
    );
  });

  it("says a designated lane it cannot name is owned, not unowned", () => {
    const nameless = { ...LIVE_LANE, resident: null };
    expect(renderLane(nameless, NOW)).toContain("· resident unknown ·");
  });

  it("quotes the server's summary verbatim, collapsed to the row's one line", () => {
    const chatty = { ...LIVE_LANE, summary: "reading\n  the   mortgage docs" };
    expect(renderLane(chatty, NOW).endsWith(" — reading the mortgage docs")).toBe(true);
  });

  it("prints the bare verdict when `since` is not an instant", () => {
    // A wrong-looking row is debuggable; `parked NaNs ago` is not.
    expect(renderLane({ ...LIVE_LANE, since: "not-a-date" }, NOW)).toBe(
      'th_4b8e2c "Q3 planning" · researcher · live — reading the mortgage docs',
    );
  });

  it("emits the roster verbatim under --json and derives nothing into it", async () => {
    const roster = { agents: [ORCHESTRATOR_ROW, LAPSED_LANE] };
    const stub = await startStubServer(jsonResponder(200, roster));

    const harness = stubContext(stub, { json: true });
    await runAgents(harness.context, NOW);

    expect(harness.stdout()).toBe(`${JSON.stringify(roster)}\n`);
    // `since` stays an ISO instant so the caller computes ages against its own
    // clock, and no rendered age leaks into the machine value.
    expect(harness.stdout()).toContain(LAPSED_LANE.since);
    expect(harness.stdout()).not.toContain("41m");
    expect(harness.stderr()).toBe("");
  });

  it("explains a lane with no listener once, as a state and not a failure", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { agents: [ORCHESTRATOR_ROW, LAPSED_LANE, WAITING_LANE] }),
    );

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    const stderr = harness.stderr();
    // One note for two unattended lanes, not one per row.
    expect(stderr.split("\n").filter(Boolean)).toHaveLength(1);
    expect(stderr).toContain("not a failure");
    expect(stderr).toContain("never silently not done");
    // The window is **the contract's** number, rendered — not a second copy of
    // it. Computed here from the same constant rather than written as `16m`, so
    // a literal in the command would fail this even if the contract moved.
    expect(stderr).toContain(`(${formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000)})`);
    expect(GRACE_WINDOW).toBe(formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000));
  });

  it("says nothing about fallback when every thread lane is live", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { agents: [ORCHESTRATOR_ROW, LIVE_LANE] }),
    );

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    expect(harness.stderr()).toBe("");
  });

  it("says nothing about fallback when only the orchestrator's lane is quiet", async () => {
    // The orchestrator's lane *is* the fallback: there is nowhere for its work
    // to fall back to, and a note claiming otherwise would be wrong.
    const stub = await startStubServer(
      jsonResponder(200, { agents: [{ ...ORCHESTRATOR_ROW, live: false, summary: null }] }),
    );

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    expect(harness.stdout()).toBe("orchestrator · lapsed, last parked 2m ago\n");
    expect(harness.stderr()).toBe("");
  });

  it("prints the orchestrator's row for a workspace with no designations at all", async () => {
    const stub = await startStubServer(jsonResponder(200, { agents: [ORCHESTRATOR_ROW] }));

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    expect(harness.stdout().split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("reports an empty roster as the server fault it is, rather than as an answer", async () => {
    const stub = await startStubServer(jsonResponder(200, { agents: [] }));

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toContain("The orchestrator's lane always exists");
  });

  it("sends nothing: presence is observed, never announced", async () => {
    const stub = await startStubServer(jsonResponder(200, { agents: [ORCHESTRATOR_ROW] }));

    await runAgents(stubContext(stub).context, NOW);

    // If this ever fails with a POST, something has grown a registration —
    // which SPEC.md §7 does not have and this CLI must never invent.
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(stub.requests.map((request) => request.path)).toEqual(["/api/agents"]);
  });
});

describe("the agents command spec", () => {
  it("is a valid top-level registry command taking no arguments and no flags", () => {
    expect(
      collectRegistryProblems({ summary: "s.", commands: [agentsCommand], topics: [] }),
    ).toEqual([]);
    expect(agentsCommand.args).toEqual([]);
    expect(agentsCommand.flags).toEqual([]);
    expect(agentsCommand.requiresWorkspace).not.toBe(false);
  });

  it("states the grace window from the contract's constant rather than a literal", async () => {
    expect(agentsCommand.description).toContain(
      `grace window (${formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000)})`,
    );

    // Value equality alone cannot tell a derivation from a literal that happens
    // to agree with it today, and the whole point of the constant living in the
    // contract is that the two processes move together. So the module is
    // required to *name* it — the same enforcement style `hygiene.test.ts` uses,
    // for the same reason: this is a rule that fails silently otherwise.
    const source = await readFile(join(import.meta.dirname, "agents.ts"), "utf8");
    expect(source).toContain("AGENT_PRESENCE_WINDOW_SECONDS");
    expect(source).not.toMatch(/GRACE_WINDOW = ["'`]/);
  });

  it("tells a reader not to parse the summary", () => {
    expect(agentsCommand.description).toContain("Never parse it");
  });

  it("keeps designation and presence apart in its own prose", () => {
    expect(agentsCommand.description).toContain("corpus thread show");
    expect(agentsCommand.description).toContain("may");
    expect(agentsCommand.description).toContain("honestly disagree");
  });
});
