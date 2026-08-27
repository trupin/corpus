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
  pending: 0,
  working: false,
  summary: "working the Q3 draft",
  origin: null,
};

const LIVE_LANE = {
  lane: "th_4b8e2c",
  resident: { name: "researcher", docId: "doc_r1", weight: null, designationId: null },
  live: true,
  since: ago(12),
  pending: 0,
  working: false,
  summary: "reading the mortgage docs",
  origin: { id: "th_4b8e2c", title: "Q3 planning" },
};

const LAPSED_LANE = {
  lane: "th_9f1a2b",
  resident: { name: "analyst", docId: "doc_a7", weight: null, designationId: null },
  live: false,
  since: ago(41 * 60),
  // The pair the orchestrate skill launches from: not live, and something
  // waiting (CLI-070). The lapsed fixture carries it because that is the row a
  // reader most needs to be able to act on.
  pending: 3,
  working: false,
  summary: null,
  origin: { id: "th_9f1a2b", title: "Rate check" },
};

const WAITING_LANE = {
  lane: "th_c0ffee",
  resident: { name: "scribe", docId: "doc_s3", weight: null, designationId: null },
  live: false,
  since: null,
  pending: 0,
  working: false,
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
      'th_4b8e2c "Q3 planning" · researcher (doc_r1) · live, parked 12s ago — reading the mortgage docs',
      // Not live, and something waiting: the pair the orchestrate skill launches
      // from, and the reason this cell exists (CLI-070).
      'th_9f1a2b "Rate check" · analyst (doc_a7) · lapsed, last parked 41m ago · 3 waiting',
      'th_c0ffee "New idea" · scribe (doc_s3) · waiting for a listener',
    ]);
  });

  /**
   * CLI-071. The third field of the launch decision, and the one that reads
   * strangest until you know why: it appears beside a **not-live** row, which
   * looks like a contradiction and is exactly the case it exists for.
   */
  describe("a lane that is holding work", () => {
    it("says so beside a not-live row, which is the pair that means patience", async () => {
      const busy = { ...LAPSED_LANE, working: true };
      const stub = await startStubServer(jsonResponder(200, { agents: [busy] }));

      const harness = stubContext(stub);
      await runAgents(harness.context, NOW);

      const row = harness.stdout().split("\n").filter(Boolean)[0] ?? "";
      expect(row).toContain("lapsed");
      expect(row).toContain("working");
      // Order is the order a reader decides in: is anybody there, is anything
      // being done, is anything waiting.
      expect(row.indexOf("working")).toBeLessThan(row.indexOf("3 waiting"));
    });

    it("says nothing for a lane holding nothing", async () => {
      const stub = await startStubServer(jsonResponder(200, { agents: [LAPSED_LANE] }));

      const harness = stubContext(stub);
      await runAgents(harness.context, NOW);

      expect(harness.stdout()).not.toContain("working");
    });

    /**
     * The three are three facts and the row keeps them apart. A reader that
     * took `working` for presence would leave a dead lane unlaunched forever,
     * since a listener that died mid-event holds its event until reap-stale.
     */
    it("keeps working and live as separate cells, never one verdict", async () => {
      const busy = { ...LAPSED_LANE, working: true };
      const stub = await startStubServer(jsonResponder(200, { agents: [busy] }));

      const harness = stubContext(stub);
      await runAgents(harness.context, NOW);

      const row = harness.stdout().split("\n").filter(Boolean)[0] ?? "";
      expect(row).not.toContain("live,");
      expect(row).toMatch(/lapsed[^·]*· working/u);
    });
  });

  /**
   * CLI-070. The orchestrate skill launches a listener for a lane that is not
   * live and has work waiting, and reads both off this row — so the cell has to
   * be here, and has to be absent when there is nothing to say.
   */
  it("prints the waiting count only for a lane that has one", async () => {
    const quiet = { ...LAPSED_LANE, pending: 0 };
    const stub = await startStubServer(jsonResponder(200, { agents: [LAPSED_LANE, quiet] }));

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    const [waiting, idle] = harness.stdout().split("\n").filter(Boolean);
    expect(waiting).toContain("3 waiting");
    // Absent, not `0 waiting`: a column of zeroes is a column nobody reads, and
    // the pair that matters is loud because it is rare.
    expect(idle).not.toContain("waiting");
  });

  it("prints a mixed roster legibly: the orchestrator, a general lane, a profiled lane", async () => {
    const general = {
      lane: "th_11aa22",
      resident: { name: null, docId: null, weight: null, designationId: null },
      live: true,
      since: ago(30),
      pending: 0,
      working: false,
      summary: null,
      origin: { id: "th_11aa22", title: "Kitchen rebuild" },
    };
    const stub = await startStubServer(
      jsonResponder(200, { agents: [ORCHESTRATOR_ROW, general, LIVE_LANE] }),
    );

    const harness = stubContext(stub);
    await runAgents(harness.context, NOW);

    expect(harness.stdout().split("\n").filter(Boolean)).toEqual([
      "orchestrator · live, parked 2m ago — working the Q3 draft",
      'th_11aa22 "Kitchen rebuild" · a general resident · live, parked 30s ago',
      'th_4b8e2c "Q3 planning" · researcher (doc_r1) · live, parked 12s ago — reading the mortgage docs',
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

  it("tells the three residents a lane can have apart, because they are three facts", () => {
    // SHARED-048. A reader of this one surface has to be able to say which of
    // these a conversation has: an agent with no profile, a profile they can
    // open, or a profile that has gone since it was designated.
    const general = {
      ...LIVE_LANE,
      resident: { name: null, docId: null, weight: null, designationId: null },
    };
    const profiled = LIVE_LANE;
    const orphaned = {
      ...LIVE_LANE,
      resident: { name: "researcher", docId: null, weight: null, designationId: null },
    };

    expect(renderLane(general, NOW)).toContain("· a general resident ·");
    expect(renderLane(profiled, NOW)).toContain("· researcher (doc_r1) ·");
    expect(renderLane(orphaned, NOW)).toContain("· researcher (profile missing) ·");

    // And no two of them render the same cell — the whole requirement.
    const cells = [general, profiled, orphaned].map((lane) => renderLane(lane, NOW));
    expect(new Set(cells).size).toBe(3);
    // A general resident is never dressed as a profile name: nothing in its cell
    // occupies the position `doc_r1` does, so a picker cannot confuse the two.
    expect(renderLane(general, NOW)).not.toContain("(");
    expect(renderLane(general, NOW)).not.toContain("null");
  });

  it("says what a lane runs at, in the resident's cell and not beside it", () => {
    // CLI-053. A row is cells joined by ` · `, and this output is read
    // positionally by an agent as well as by a person — so a weight given a cell
    // of its own would make one row four dot-separated fields and the next row
    // three. Inside the resident cell, every row has the same shape whether or
    // not a weight was chosen.
    const heavy = {
      ...LIVE_LANE,
      resident: { name: "researcher", docId: "doc_r1", weight: "heavy", designationId: null },
    };

    expect(renderLane(heavy, NOW)).toBe(
      'th_4b8e2c "Q3 planning" · researcher (doc_r1) at heavy · live, parked 12s ago — reading the mortgage docs',
    );
    expect(renderLane(heavy, NOW).split(" · ")).toHaveLength(
      renderLane(LIVE_LANE, NOW).split(" · ").length,
    );
  });

  it("shows nothing extra for a lane whose designation chose no weight", () => {
    // The acceptance criterion: no invented word for null, the same rule
    // `Resident.name` already carries.
    const row = renderLane(LIVE_LANE, NOW);
    expect(row).toBe(
      'th_4b8e2c "Q3 planning" · researcher (doc_r1) · live, parked 12s ago — reading the mortgage docs',
    );
    expect(row).not.toContain(" at ");
    expect(row).not.toContain("null");
  });

  it("carries a weight on a general resident too, since the two are independent", () => {
    // §7's rider: a general resident may run at a stated weight and a profiled
    // one at none, so all four combinations are ordinary rows.
    const general = {
      ...LIVE_LANE,
      resident: { name: null, docId: null, weight: "heavy", designationId: null },
    };
    expect(renderLane(general, NOW)).toContain("· a general resident at heavy ·");
    expect(renderLane(general, NOW)).not.toContain("(");
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
      'th_4b8e2c "Q3 planning" · researcher (doc_r1) · live — reading the mortgage docs',
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
    /*
     * **It must not promise the work will be picked up** (CLI-073). This note
     * used to end "…becomes visible to the orchestrator's own `corpus queue
     * claim-all` … never silently not done", which the rider signed 2026-08-25
     * deleted along with the fallback itself. An operator watching a
     * conversation go unanswered read it and waited out a grace window for
     * something that was never coming.
     *
     * What replaced it is the true thing and the actionable one: the work waits,
     * and the pending count is a launch instruction.
     */
    expect(stderr).toContain("waits");
    expect(stderr).toContain("launch** a listener");
    expect(stderr).not.toContain("claim-all");
    expect(stderr).not.toContain("never silently not done");
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

  it("explains the resident cell's three states, in the contract's words", () => {
    expect(agentsCommand.description).toContain("a general resident");
    expect(agentsCommand.description).toContain("researcher (doc_r1)");
    expect(agentsCommand.description).toContain("researcher (profile missing)");
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
