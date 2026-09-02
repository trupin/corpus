import { describe, expect, it } from "vitest";
import type { ObservedEvent, ObservedThread, Observation } from "../observe.js";
import type { RunRecord } from "../scenario.js";
import {
  eventStatus,
  eventsOfType,
  expectProcessed,
  jobLogLines,
  launchProvenanceLogged,
  threadById,
  turnsBy,
  weightTableFromRefs,
  weightTableRefs,
} from "./support.js";

function event(
  id: string,
  status: ObservedEvent["status"],
  type: string,
  payload: Record<string, unknown> = {},
): ObservedEvent {
  return { id, status, file: `${id}.json`, parsed: { type, payload }, parseError: null };
}

function mutableByStatus(): Record<ObservedEvent["status"], ObservedEvent[]> {
  return {
    pending: [],
    "in-progress": [],
    deferred: [],
    processed: [],
    failed: [],
    abandoned: [],
  };
}

function emptySeedQueue(): RunRecord["seedSnapshot"]["queue"] {
  return {
    pending: [],
    "in-progress": [],
    deferred: [],
    processed: [],
    failed: [],
    abandoned: [],
  };
}

function record(options: {
  events?: readonly ObservedEvent[];
  jobLogs?: Readonly<Record<string, readonly string[]>>;
  threads?: readonly ObservedThread[];
  refs?: Readonly<Record<string, string>>;
}): RunRecord {
  const byStatus = mutableByStatus();
  for (const observed of options.events ?? []) {
    byStatus[observed.status].push(observed);
  }
  const observation: Observation = {
    docCheck: { code: 0, stdout: "{}" },
    baseDirEntries: [".corpus-run.json", "bin", "workspace"],
    commitsSinceSeed: [],
    gitStatus: [],
    queue: { byStatus, malformed: [] },
    jobLogs: options.jobLogs ?? {},
    threads: options.threads ?? [],
    docs: [],
  };
  return {
    scenarioId: "s",
    runIndex: 0,
    seed: { refs: options.refs ?? {} },
    seedSnapshot: {
      head: "h",
      headTree: "t",
      queue: emptySeedQueue(),
    },
    observation,
    meta: {
      startedAt: "2026-09-01T00:00:00Z",
      endedAt: "2026-09-01T00:05:00Z",
      durationMs: 300_000,
      overBudget: false,
      endedBy: "quiescence",
      runnerExitCode: 0,
    },
  };
}

function thread(id: string, turns: ObservedThread["turns"]): ObservedThread {
  return {
    path: `data/threads/${id}.md`,
    raw: "",
    frontmatter: { id },
    parseError: null,
    turns,
  };
}

describe("eventStatus and eventsOfType", () => {
  const rec = record({
    events: [
      event("evt_a", "processed", "comment.created", { threadId: "th_1" }),
      event("evt_b", "processed", "resident.designated", { threadId: "th_1" }),
      event("evt_c", "pending", "lane.waiting", { lane: "th_1" }),
      event("evt_d", "processed", "resident.designated", { threadId: "th_2" }),
    ],
  });

  it("finds an event's status directory, or null", () => {
    expect(eventStatus(rec, "evt_a")).toBe("processed");
    expect(eventStatus(rec, "evt_missing")).toBeNull();
  });

  it("filters by type", () => {
    expect(eventsOfType(rec, "resident.designated").map((e) => e.id)).toEqual(["evt_b", "evt_d"]);
  });

  it("narrows by the thread a payload names — threadId or lane", () => {
    expect(eventsOfType(rec, "resident.designated", "th_1").map((e) => e.id)).toEqual(["evt_b"]);
    expect(eventsOfType(rec, "lane.waiting", "th_1").map((e) => e.id)).toEqual(["evt_c"]);
    expect(eventsOfType(rec, "resident.designated", "th_2").map((e) => e.id)).toEqual(["evt_d"]);
  });
});

describe("jobLogLines and launchProvenanceLogged", () => {
  const rec = record({
    jobLogs: {
      evt_a: [
        JSON.stringify({
          ts: "t1",
          source: "server",
          line: "weight stated by the request: colossal",
        }),
        JSON.stringify({
          ts: "t2",
          source: "cli",
          line: "launched a listener (Opus 5 — defaulted: no weight chosen)",
        }),
        "not json at all",
      ],
    },
  });

  it("parses each JSONL line and keeps a non-JSON line verbatim", () => {
    const lines = jobLogLines(rec, "evt_a");
    expect(lines[0]).toEqual({
      ts: "t1",
      source: "server",
      line: "weight stated by the request: colossal",
    });
    expect(lines[1]?.source).toBe("cli");
    expect(lines[2]).toEqual({ ts: null, source: null, line: "not json at all" });
  });

  it("reads the launch provenance word across the named events", () => {
    expect(launchProvenanceLogged(rec, ["evt_a"], "defaulted")).toBe(true);
    expect(launchProvenanceLogged(rec, ["evt_a"], "stated")).toBe(true);
    expect(launchProvenanceLogged(rec, ["evt_missing"], "defaulted")).toBe(false);
  });
});

describe("threads and refs helpers", () => {
  it("finds a thread by id and counts its turns by author", () => {
    const rec = record({
      threads: [
        thread("th_1", [
          { author: "user", ts: "t1", model: null },
          { author: "agent", ts: "t2", model: "claude-opus-4-1" },
        ]),
      ],
    });
    const found = threadById(rec, "th_1");
    if (found === undefined) throw new Error("expected th_1 to be found");
    expect(turnsBy(found, "agent")).toHaveLength(1);
    expect(turnsBy(found, "user")).toHaveLength(1);
  });

  it("round-trips a weight table through refs", () => {
    const rows = [{ label: "Light", key: "light", model: "Haiku" }];
    const rec = record({ refs: { weightTable: weightTableRefs(rows) } });
    expect(weightTableFromRefs(rec)).toEqual(rows);
    expect(weightTableFromRefs(record({}))).toEqual([]);
  });
});

describe("expectProcessed", () => {
  it("is silent for a processed event and a sentence otherwise", () => {
    const rec = record({
      events: [
        event("evt_ok", "processed", "comment.created"),
        event("evt_bad", "failed", "comment.created"),
      ],
    });
    expect(expectProcessed(rec, "evt_ok", "x")).toBeNull();
    expect(expectProcessed(rec, "evt_bad", "x")).toContain("failed");
    expect(expectProcessed(rec, "evt_gone", "x")).toContain("no queue status directory");
  });
});
