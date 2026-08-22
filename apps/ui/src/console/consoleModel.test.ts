import type { IndexStatus, Job, QueueStatus } from "@corpus/contract";
import {
  AGENT_PRESENCE_WINDOW_SECONDS,
  QUEUE_EVENT_STATUSES,
  SEMANTIC_INDEX_STATES,
} from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  JOB_DOT_CLASSES,
  UNKNOWN_QUEUE_STATUS,
  agentDotClass,
  agentPillText,
  agentState,
  blockedOn,
  blockedOnDetailLabel,
  blockedOnLabel,
  consoleCounts,
  indexDotClass,
  indexPillText,
  isErrorLine,
  jobDotClass,
  jobLabel,
  jobStartedLabel,
  resolveSelectedJob,
} from "./consoleModel";

const IDLE: QueueStatus = {
  agent: { live: true, since: "2026-07-19T10:00:00.000Z" },
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

const label = (overrides: Pick<Job, "type" | "originTitle">): string => jobLabel(overrides);

describe("the six-to-five status mapping", () => {
  // The one that catches a status added to the contract with no console
  // treatment decided — the mapping is exhaustive by type, and by this test.
  it("maps every wire status the contract declares", () => {
    expect(Object.keys(JOB_DOT_CLASSES).sort()).toEqual([...QUEUE_EVENT_STATUSES].sort());
  });

  it.each([
    ["pending", "pending"],
    ["in-progress", "running"],
    // CONTRACT-021: parked while a person edits reads as waiting, under its own class.
    ["deferred", "deferred"],
    ["processed", "done"],
    ["failed", "failed"],
    // Sprint-010 adjudication 8: no prototype colour, so no borrowed meaning.
    ["abandoned", ""],
  ] as const)("maps %s to the %s dot", (status, expected) => {
    expect(jobDotClass(status)).toBe(expected);
  });

  // The mistake worth pinning: a deferred job is not a broken one, and it is
  // not the neutral tombstone either.
  it("gives deferred a class of its own rather than failed's or abandoned's", () => {
    expect(jobDotClass("deferred")).not.toBe(jobDotClass("failed"));
    expect(jobDotClass("deferred")).not.toBe(jobDotClass("abandoned"));
  });
});

// SERVER-030 eval FAIL-1 / TEST-356. The contract's own words: "a deferred job
// that names no document is indistinguishable from a stuck one."
describe("what a deferred job is waiting for", () => {
  const deferred = {
    status: "deferred",
    blockedOn: "doc_401k",
    blockedOnTitle: "401k rollover",
  } as const;

  it("names the blocking document, id kept beside the title", () => {
    expect(blockedOn(deferred)).toEqual({ name: "401k rollover", id: "doc_401k" });
  });

  it("has nothing to say about a job that is not deferred", () => {
    expect(blockedOn({ ...deferred, status: "failed" })).toBeNull();
    expect(blockedOn({ status: "pending", blockedOn: null, blockedOnTitle: null })).toBeNull();
  });

  // The contract's rule for the denormalised copy: a null title means the
  // document is gone, so the id is the only true name left.
  it("stands the id in as the name when the title is gone", () => {
    expect(blockedOn({ ...deferred, blockedOnTitle: null })).toEqual({
      name: "doc_401k",
      id: null,
    });
  });

  // The contract says this cannot happen. Rendering `blocked on ` if it does
  // would be worse than saying so, so it is never silently dropped.
  it("says so rather than rendering an empty name when the wire names nothing", () => {
    const blocker = blockedOn({ ...deferred, blockedOn: null, blockedOnTitle: null });
    expect(blocker).toEqual({ name: "an unnamed document", id: null });
    expect(blocker === null ? "" : blockedOnLabel(blocker)).toBe("blocked on an unnamed document");
  });

  it("reads as a hint in the row and carries the id in the detail pane", () => {
    const blocker = blockedOn(deferred);
    if (blocker === null) throw new Error("a deferred job has a blocker");
    expect(blockedOnLabel(blocker)).toBe("blocked on 401k rollover");
    expect(blockedOnDetailLabel(blocker)).toBe("blocked on 401k rollover · doc_401k");
  });

  it("does not repeat the id when the id is already the name", () => {
    const blocker = blockedOn({ ...deferred, blockedOnTitle: null });
    if (blocker === null) throw new Error("a deferred job has a blocker");
    expect(blockedOnDetailLabel(blocker)).toBe("blocked on doc_401k");
  });
});

describe("the job row's label", () => {
  it("is `<event type> · <origin title>`", () => {
    expect(label({ type: "comment.created", originTitle: "Insurance carrier choice" })).toBe(
      "comment.created · Insurance carrier choice",
    );
  });

  it("drops the separator with the title rather than rendering undefined", () => {
    expect(label({ type: "agent.done", originTitle: null })).toBe("agent.done");
  });

  it("keeps a plugin's own event type verbatim", () => {
    expect(label({ type: "x/todos.rollover", originTitle: "Today" })).toBe(
      "x/todos.rollover · Today",
    );
  });
});

describe("the started clock", () => {
  it("renders local wall time to the minute", () => {
    const at = new Date(2026, 6, 27, 9, 12, 30);
    expect(jobStartedLabel(at.toISOString())).toBe("09:12");
  });

  it("shows the raw value rather than `Invalid Date` when the wire is odd", () => {
    expect(jobStartedLabel("not-a-time")).toBe("not-a-time");
  });
});

/**
 * UI-098. `idle` used to be the else-branch — not halted, nothing in progress —
 * so a machine with no agent running at all reported an agent with nothing to
 * do. SPEC.md §10 now makes `idle` "a claim that requires evidence", and the
 * evidence is `QueueStatus.agent`.
 *
 * The ladder itself belongs to the contract (`agentActivity`, CONTRACT-045) and
 * is pinned by `packages/contract/src/schemas/queue.test.ts`; what these assert
 * is that the pill *reads* it — including in the two places a surface could
 * quietly build a second one: the precedence, and the unanswered read.
 */
describe("the agent pill", () => {
  const NOW = new Date("2026-07-19T10:01:00.000Z");
  /** Well past the grace window from `IDLE.agent.since`, computed from it. */
  const LATER = new Date(
    Date.parse("2026-07-19T10:00:00.000Z") + (AGENT_PRESENCE_WINDOW_SECONDS + 60) * 1000,
  );
  const AWAY: QueueStatus = { ...IDLE, agent: { live: false, since: null } };

  it("is idle with an agent parked and nothing in flight", () => {
    expect(agentState(IDLE, NOW)).toBe("idle");
    expect(agentPillText(IDLE, NOW)).toBe("agent: idle · queue 0");
  });

  it("is working while anything is in progress", () => {
    expect(agentPillText({ ...IDLE, inProgress: 1, pending: 2 }, NOW)).toBe(
      "agent: working · queue 2",
    );
  });

  // Halted outranks working: the sentinel is set, so nothing further is claimed
  // and calling the agent "working" because one job is finishing would mislead.
  it("is halted even with a job still in progress", () => {
    expect(agentState({ ...IDLE, halted: true, inProgress: 3 }, NOW)).toBe("halted");
  });

  // The bug this issue is named for: nothing in progress used to mean idle.
  it("says disconnected, not idle, when nobody is parked", () => {
    expect(agentState(AWAY, NOW)).toBe("disconnected");
    expect(agentPillText({ ...AWAY, pending: 3 }, NOW)).toBe("agent: disconnected · queue 3");
  });

  // CONTRACT-045's decision, not re-litigated here: `inProgress > 0` is a fact
  // about events, not about anybody holding them. An agent that claimed work and
  // died leaves the count standing forever, and `working` about a corpse is the
  // same unevidenced claim as `idle` about an empty machine.
  it("says disconnected rather than working when the holder of the work is gone", () => {
    expect(agentState({ ...AWAY, inProgress: 3 }, NOW)).toBe("disconnected");
  });

  it("still lets halted outrank disconnected", () => {
    expect(agentState({ ...AWAY, halted: true, inProgress: 3 }, NOW)).toBe("halted");
  });

  /*
   * The one that proves the pill is time-dependent at all: same status object,
   * two clocks. The threshold is the contract's window — derived there from the
   * idle timeout — so no duration is written down in the UI and a change to the
   * rearm carries this with it.
   */
  it("expires a presence it has been holding past the grace window", () => {
    expect(agentState(IDLE, NOW)).toBe("idle");
    expect(agentState(IDLE, LATER)).toBe("disconnected");
  });

  it("holds the presence right up to the window's edge", () => {
    const edge = new Date(
      Date.parse("2026-07-19T10:00:00.000Z") + AGENT_PRESENCE_WINDOW_SECONDS * 1000,
    );
    expect(agentState(IDLE, edge)).toBe("idle");
  });

  /*
   * The mistake this issue is most likely to be got wrong by: `unknown` is not
   * `disconnected`. A status that has not arrived is not a status reporting that
   * nobody is there, and `UNKNOWN_QUEUE_STATUS` carries `live: false` only
   * because the field is required — a pre-answer placeholder, not a verdict.
   */
  it("makes no claim at all before the server has answered", () => {
    expect(agentState(undefined, NOW)).toBe("unknown");
    expect(agentPillText(undefined, NOW)).toBe("agent: unknown");
  });

  /*
   * The same rule arriving by a different road: a response that omitted the
   * field (an older server, a proxy that trimmed it, a stub answering `{}`) has
   * not reported an absence either — and it must not take the shell down on its
   * way to saying so. `apps/ui/src/testing/boardFixture.ts` answers exactly this
   * for `/api/queue/status`, and before the guard the whole `Shell` suite threw
   * `Cannot read properties of undefined (reading 'live')`.
   */
  it("says unknown, and does not throw, when the response omitted the field", () => {
    const partial = { halted: false, pending: 2 } as unknown as QueueStatus;
    expect(agentState(partial, NOW)).toBe("unknown");
    expect(agentPillText(partial, NOW)).toBe("agent: unknown");
    expect(agentDotClass(agentState(partial, NOW))).toBe("dot unknown");
  });

  it("does not read the counts' placeholder as a report that nobody is there", () => {
    // Not `agentState(UNKNOWN_QUEUE_STATUS)`: the point is that the placeholder
    // never gets to be the argument. What stands in for the counts is a separate
    // decision from what the pill says, and only the counts have a stand-in.
    expect(UNKNOWN_QUEUE_STATUS.agent).toEqual({ live: false, since: null });
    expect(agentState(undefined, NOW)).not.toBe(agentState(UNKNOWN_QUEUE_STATUS, NOW));
  });

  it.each([
    ["idle", "dot"],
    ["working", "dot busy"],
    ["halted", "dot halted"],
    // §10: disconnected is not an error state and is not styled as a failure.
    ["disconnected", "dot away"],
    ["unknown", "dot unknown"],
  ] as const)("dresses %s in %s", (state, expected) => {
    expect(agentDotClass(state)).toBe(expected);
  });

  it("keeps disconnected off halted's dot and off the working pulse", () => {
    expect(agentDotClass("disconnected")).not.toBe(agentDotClass("halted"));
    expect(agentDotClass("disconnected")).not.toBe(agentDotClass("idle"));
    expect(agentDotClass("disconnected")).not.toContain("busy");
    // And `unknown` is not `disconnected`: the two say different things.
    expect(agentDotClass("unknown")).not.toBe(agentDotClass("disconnected"));
  });

  // The index pill borrows this pill's dot vocabulary (SPEC.md §10's index-pill
  // rider), so a state added here must not silently become an index treatment.
  it("leaves the index pill's own vocabulary alone", () => {
    const agentDots = (["idle", "working", "halted", "disconnected", "unknown"] as const).map(
      agentDotClass,
    );
    expect(agentDots).not.toContain(indexDotClass({ state: "stale" }));
    expect(agentDots).not.toContain(indexDotClass({ state: "disabled" }));
  });
});

describe("the index pill", () => {
  const CAUGHT_UP: IndexStatus = {
    indexed: 273,
    pending: 0,
    failed: 0,
    identity: "ollama/nomic-embed-text@768",
    rebuilding: false,
    state: "current",
  };

  it("says how much is searchable once it is caught up", () => {
    expect(indexPillText(CAUGHT_UP)).toBe("index: current · 273 indexed");
  });

  // `41/68` is `indexed` over `indexed + pending` — the total the contract
  // deliberately does not publish, computed here from the two numbers it does.
  it("shows the fraction of the corpus embedded while a rebuild drains", () => {
    expect(
      indexPillText({
        ...CAUGHT_UP,
        indexed: 41,
        pending: 27,
        rebuilding: true,
        state: "indexing",
      }),
    ).toBe("index: indexing · 41/68");
  });

  it("shows the same count shape for a backlog nobody is draining", () => {
    expect(indexPillText({ ...CAUGHT_UP, indexed: 41, pending: 27, state: "stale" })).toBe(
      "index: stale · 41/68",
    );
  });

  // `failed` is not progress — it never drains on its own — so it must not move
  // the fraction. The expanded row is where it gets said.
  it("keeps the failed count out of the fraction", () => {
    expect(
      indexPillText({ ...CAUGHT_UP, indexed: 41, pending: 27, failed: 9, state: "indexing" }),
    ).toBe("index: indexing · 41/68");
  });

  it("carries no count at all when there is no index", () => {
    expect(indexPillText({ ...CAUGHT_UP, indexed: 0, identity: null, state: "disabled" })).toBe(
      "index: disabled",
    );
  });

  it.each([
    ["current", "dot"],
    ["indexing", "dot busy"],
    ["stale", "dot stale"],
    ["disabled", "dot off"],
  ] as const)("dresses %s in %s", (state, expected) => {
    expect(indexDotClass({ state })).toBe(expected);
  });

  // The one that catches a state added to the contract with no dot decided.
  it("has a treatment for every state the contract declares", () => {
    for (const state of SEMANTIC_INDEX_STATES) {
      expect(indexDotClass({ state })).toMatch(/^dot/);
    }
  });
});

describe("the strip's counts", () => {
  it("omits the queued segment when nothing is pending", () => {
    expect(consoleCounts({ ...IDLE, inProgress: 1, processed: 4, failed: 1 })).toEqual({
      lead: "1 running · 4 done",
      failed: 1,
    });
  });

  it("includes it as soon as something is", () => {
    expect(consoleCounts({ ...IDLE, inProgress: 1, pending: 2, processed: 4 }).lead).toBe(
      "1 running · 2 queued · 4 done",
    );
  });

  it("still renders zeroes with no jobs at all", () => {
    expect(consoleCounts(IDLE)).toEqual({ lead: "0 running · 0 done", failed: 0 });
  });

  it("names deferred work rather than hiding it in queued or failed", () => {
    expect(consoleCounts({ ...IDLE, pending: 2, deferred: 1, processed: 4 })).toEqual({
      lead: "0 running · 2 queued · 1 deferred · 4 done",
      failed: 0,
    });
  });

  it("omits the deferred segment when nothing is deferred", () => {
    expect(consoleCounts({ ...IDLE, pending: 2 }).lead).toBe("0 running · 2 queued · 0 done");
  });
});

describe("ERR classification", () => {
  it.each([
    ["08:44:10 ERR subagent timeout", true],
    ["08:44:10 error: subagent timeout", false],
    ["reading ERROR.md", true],
    ["nothing to see", false],
  ])("classifies %s", (line, expected) => {
    expect(isErrorLine(line)).toBe(expected);
  });
});

describe("the selection policy", () => {
  const jobs = [{ eventId: "evt_c" }, { eventId: "evt_b" }, { eventId: "evt_a" }];

  it("follows the newest job when nothing was chosen", () => {
    expect(resolveSelectedJob(jobs, null)).toBe("evt_c");
  });

  it("keeps an explicit choice when a newer job arrives", () => {
    expect(resolveSelectedJob([{ eventId: "evt_d" }, ...jobs], "evt_b")).toBe("evt_b");
  });

  it("falls back to the newest when the chosen job is gone", () => {
    expect(resolveSelectedJob(jobs, "evt_gone")).toBe("evt_c");
  });

  it("has nothing to select in an empty list", () => {
    expect(resolveSelectedJob([], "evt_b")).toBeNull();
  });
});
