import { describe, expect, it } from "vitest";
import type { ObservedEvent, ObservedThread, Observation } from "../observe.js";
import type { RunRecord } from "../scenario.js";
import { aListenerAnswersTwice } from "./10-a-listener-answers-twice.js";

const THREAD = "th_planter";
const LAUNCH_LINE =
  "launched a converse listener on th_planter — a general resident (Sonnet — judged: no weight chosen)";

function event(
  id: string,
  status: ObservedEvent["status"],
  type: string,
  payload: Record<string, unknown> = {},
): ObservedEvent {
  return { id, status, file: `${id}.json`, parsed: { type, payload }, parseError: null };
}

function turn(author: string, ts: string): ObservedThread["turns"][number] {
  return { author, ts, model: null };
}

function thread(turns: ObservedThread["turns"]): ObservedThread {
  return {
    path: `data/threads/${THREAD}.md`,
    raw: "",
    frontmatter: { id: THREAD },
    parseError: null,
    turns,
  };
}

function record(options: {
  events?: readonly ObservedEvent[];
  jobLogs?: Readonly<Record<string, readonly string[]>>;
  threads?: readonly ObservedThread[];
  refs?: Readonly<Record<string, string>>;
}): RunRecord {
  const byStatus: Record<ObservedEvent["status"], ObservedEvent[]> = {
    pending: [],
    "in-progress": [],
    deferred: [],
    processed: [],
    failed: [],
    abandoned: [],
  };
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
    scenarioId: aListenerAnswersTwice.id,
    runIndex: 0,
    seed: { refs: options.refs ?? {} },
    seedSnapshot: {
      head: "h",
      headTree: "t",
      headParent: "seedparent".padEnd(40, "0"),
      queue: {
        pending: [],
        "in-progress": [],
        deferred: [],
        processed: [],
        failed: [],
        abandoned: [],
      },
    },
    observation,
    meta: {
      startedAt: "2026-09-05T00:00:00Z",
      endedAt: "2026-09-05T00:10:00Z",
      durationMs: 600_000,
      overBudget: false,
      cutShort: false,
      endedBy: "quiescence",
      runnerExitCode: 0,
      followUps: 1,
    },
  };
}

const refs = { threadId: THREAD, firstEventId: "evt_first", secondEventId: "evt_second" };

/** The healthy shape: one launch, two exchanges in order, both events settled. */
function healthy(): Parameters<typeof record>[0] {
  return {
    refs,
    events: [
      event("evt_designated", "processed", "resident.designated", { threadId: THREAD }),
      event("evt_first", "processed", "comment.created", { threadId: THREAD }),
      event("evt_second", "processed", "comment.created", { threadId: THREAD }),
    ],
    jobLogs: {
      evt_designated: [JSON.stringify({ ts: "t", source: "agent", line: LAUNCH_LINE })],
    },
    threads: [
      thread([turn("user", "1"), turn("agent", "2"), turn("user", "3"), turn("agent", "4")]),
    ],
  };
}

describe("10-a-listener-answers-twice score", () => {
  it("passes when the second message was answered and exactly one launch is recorded", () => {
    const score = aListenerAnswersTwice.score(record(healthy()));
    expect(score).toEqual({
      kind: "judgment",
      pass: true,
      label: "second answered live · 1 launch",
    });
  });

  it("fails an answer that arrived after a relaunch, with the launch count in the label", () => {
    const base = healthy();
    const relaunched = {
      ...base,
      events: [
        ...(base.events ?? []),
        event("evt_notice", "processed", "lane.waiting", { lane: THREAD }),
      ],
      jobLogs: {
        ...base.jobLogs,
        evt_notice: [JSON.stringify({ ts: "t", source: "agent", line: LAUNCH_LINE })],
      },
    };
    const score = aListenerAnswersTwice.score(record(relaunched));
    expect(score).toEqual({
      kind: "judgment",
      pass: false,
      label: "second answered after a relaunch · 2 launches",
    });
  });

  it("fails an unanswered second message distinctly", () => {
    const base = healthy();
    const unanswered = {
      ...base,
      events: [
        event("evt_designated", "processed", "resident.designated", { threadId: THREAD }),
        event("evt_first", "processed", "comment.created", { threadId: THREAD }),
        event("evt_second", "pending", "comment.created", { threadId: THREAD }),
      ],
      threads: [thread([turn("user", "1"), turn("agent", "2"), turn("user", "3")])],
    };
    const score = aListenerAnswersTwice.score(record(unanswered));
    expect(score).toEqual({
      kind: "judgment",
      pass: false,
      label: "second message unanswered",
    });
  });

  it("fails a settled second event whose answer never appears in the thread", () => {
    const base = healthy();
    const settledButSilent = {
      ...base,
      threads: [thread([turn("user", "1"), turn("agent", "2"), turn("user", "3")])],
    };
    expect(aListenerAnswersTwice.score(record(settledButSilent))).toEqual({
      kind: "judgment",
      pass: false,
      label: "second message unanswered",
    });
  });

  it("fails an answered run whose lane recorded no launch at all", () => {
    const base = healthy();
    const unrecorded = { ...base, jobLogs: {} };
    expect(aListenerAnswersTwice.score(record(unrecorded))).toEqual({
      kind: "judgment",
      pass: false,
      label: "second answered · no launch recorded",
    });
  });

  it("fails a run the runner ended before the follow-up could land, distinctly", () => {
    const base = healthy();
    const noSecond = {
      ...base,
      refs: { threadId: THREAD, firstEventId: "evt_first" },
    };
    expect(aListenerAnswersTwice.score(record(noSecond))).toEqual({
      kind: "judgment",
      pass: false,
      label: "no second message — the runner ended before the gap",
    });
  });
});
