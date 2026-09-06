import { describe, expect, it } from "vitest";
import type { ObservedEvent, ObservedThread, Observation } from "../observe.js";
import type { CorpusResult, RunRecord, SeedContext } from "../scenario.js";
import { twoLanesTwoWeights } from "./11-two-lanes-two-weights.js";

// --- Seeding (TEST-1156): the fixture produces the two lanes it claims ------

const THREE_TIER_TABLE = [
  "| Weight | Key | Model | What falls here |",
  "| --- | --- | --- | --- |",
  "| Quick | quick | Haiku | Lookups |",
  "| Standard | standard | Sonnet | Most work |",
  "| Deep | deep | **Opus 5** | Judgment calls |",
].join("\n");

const ONE_TIER_TABLE = [
  "| Weight | Key | Model | What falls here |",
  "| --- | --- | --- | --- |",
  "| Standard | standard | Sonnet | Everything |",
].join("\n");

function seedContext(options: {
  table: string;
  threads: readonly { threadId: string; eventId: string | null }[];
}): { ctx: SeedContext; creates: string[][] } {
  const creates: string[][] = [];
  const remaining = [...options.threads];
  const corpus = (args: readonly string[]): Promise<CorpusResult> => {
    if (args[0] === "doc" && args[1] === "show") {
      const stdout = JSON.stringify({ body: options.table, key: "k" });
      return Promise.resolve({ code: 0, stdout, stderr: "" });
    }
    if (args[0] === "thread" && args[1] === "create") {
      creates.push([...args]);
      const next = remaining.shift();
      if (next === undefined) throw new Error("unexpected extra thread create");
      const stdout = JSON.stringify({
        thread: { id: next.threadId },
        eventId: next.eventId,
      });
      return Promise.resolve({ code: 0, stdout, stderr: "" });
    }
    throw new Error(`unexpected corpus invocation: ${args.join(" ")}`);
  };
  const composer = (): Promise<never> => {
    throw new Error("this scenario's seed never uses the composer");
  };
  return { ctx: { workspaceRoot: "/nowhere", corpus, composer }, creates };
}

describe("11-two-lanes-two-weights seed", () => {
  it("seeds the two lanes it claims: a lookup and a weighed decision, both designating", async () => {
    const { ctx, creates } = seedContext({
      table: THREE_TIER_TABLE,
      threads: [
        { threadId: "th_lookup", eventId: "evt_lookup" },
        { threadId: "th_decision", eventId: "evt_decision" },
      ],
    });
    const seed = await twoLanesTwoWeights.seed(ctx);

    expect(creates).toHaveLength(2);
    const [lookup = [], decision = []] = creates;

    // The fetch-and-relay lane: one flat factual question.
    expect(lookup).toContain("Last frost");
    const lookupBody = lookup[lookup.indexOf("-m") + 1] ?? "";
    expect(lookupBody).toContain("last spring frost");

    // The working-something-out lane: trade-offs weighed, wording that will
    // leave the corpus.
    expect(decision).toContain("Greenhouse or raised beds");
    const decisionBody = decision[decision.indexOf("-m") + 1] ?? "";
    expect(decisionBody).toContain("Weigh the trade-offs");
    expect(decisionBody).toContain("they will read it verbatim");

    // Both are weightless designations — no weight named anywhere.
    for (const create of creates) {
      expect(create).toContain("--requests-agent");
      expect(create).not.toContain("--weight");
    }

    expect(seed.refs).toMatchObject({
      lookupThreadId: "th_lookup",
      lookupEventId: "evt_lookup",
      decisionThreadId: "th_decision",
      decisionEventId: "evt_decision",
    });
    const storedTable: unknown = JSON.parse(seed.refs.weightTable ?? "[]");
    expect(storedTable).toHaveLength(3);
  });

  it("refuses a workspace declaring fewer than two tiers", async () => {
    const { ctx } = seedContext({ table: ONE_TIER_TABLE, threads: [] });
    await expect(twoLanesTwoWeights.seed(ctx)).rejects.toThrow(/fewer than two tiers/);
  });

  it("refuses when an Ask enqueues nothing", async () => {
    const { ctx } = seedContext({
      table: THREE_TIER_TABLE,
      threads: [{ threadId: "th_lookup", eventId: null }],
    });
    await expect(twoLanesTwoWeights.seed(ctx)).rejects.toThrow(/enqueued nothing/);
  });
});

// --- Scoring: the comparison is the test ------------------------------------

const LOOKUP_THREAD = "th_lookup";
const DECISION_THREAD = "th_decision";

const ROWS = [
  { label: "Quick", key: "quick", model: "Haiku" },
  { label: "Standard", key: "standard", model: "Sonnet" },
  { label: "Deep", key: "deep", model: "Opus 5" },
];

function launchLine(threadId: string, model: string, provenance: string): string {
  return JSON.stringify({
    ts: "t",
    source: "agent",
    line: `launched a converse listener on ${threadId} — a general resident (${model} — ${provenance}: no weight chosen)`,
  });
}

function event(
  id: string,
  status: ObservedEvent["status"],
  type: string,
  payload: Record<string, unknown> = {},
): ObservedEvent {
  return { id, status, file: `${id}.json`, parsed: { type, payload }, parseError: null };
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

function turn(author: string, model: string | null = null): ObservedThread["turns"][number] {
  return { author, ts: "t", model };
}

function record(options: {
  events?: readonly ObservedEvent[];
  jobLogs?: Readonly<Record<string, readonly string[]>>;
  threads?: readonly ObservedThread[];
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
    scenarioId: twoLanesTwoWeights.id,
    runIndex: 0,
    seed: {
      refs: {
        lookupThreadId: LOOKUP_THREAD,
        lookupEventId: "evt_lookup",
        decisionThreadId: DECISION_THREAD,
        decisionEventId: "evt_decision",
        weightTable: JSON.stringify(ROWS),
      },
    },
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
      startedAt: "2026-09-06T00:00:00Z",
      endedAt: "2026-09-06T00:10:00Z",
      durationMs: 600_000,
      overBudget: false,
      cutShort: false,
      endedBy: "quiescence",
      runnerExitCode: 0,
      followUps: 0,
    },
  };
}

/** The discriminating shape: Haiku on the lookup, Opus on the decision. */
function healthy(): Parameters<typeof record>[0] {
  return {
    events: [
      event("evt_dl", "processed", "resident.designated", { threadId: LOOKUP_THREAD }),
      event("evt_dd", "processed", "resident.designated", { threadId: DECISION_THREAD }),
      event("evt_lookup", "processed", "comment.created", { threadId: LOOKUP_THREAD }),
      event("evt_decision", "processed", "comment.created", { threadId: DECISION_THREAD }),
    ],
    jobLogs: {
      evt_dl: [launchLine(LOOKUP_THREAD, "Haiku", "judged")],
      evt_dd: [launchLine(DECISION_THREAD, "Opus 5", "judged")],
    },
    threads: [
      thread(LOOKUP_THREAD, [turn("user"), turn("agent", "claude-haiku-4-5")]),
      thread(DECISION_THREAD, [turn("user"), turn("agent", "claude-opus-4-1")]),
    ],
  };
}

describe("11-two-lanes-two-weights score", () => {
  it("passes when both launches are judged truthfully and the tiers differ", () => {
    expect(twoLanesTwoWeights.score(record(healthy()))).toEqual({
      kind: "judgment",
      pass: true,
      label: "lookup Haiku ≠ decision Opus 5 · judged/judged",
    });
  });

  it("fails one read for two lanes — both landing on the same tier", () => {
    const base = healthy();
    const flattened = {
      ...base,
      jobLogs: {
        evt_dl: [launchLine(LOOKUP_THREAD, "Sonnet", "judged")],
        evt_dd: [launchLine(DECISION_THREAD, "Sonnet", "judged")],
      },
      threads: [
        thread(LOOKUP_THREAD, [turn("user"), turn("agent", "claude-sonnet-4-5")]),
        thread(DECISION_THREAD, [turn("user"), turn("agent", "claude-sonnet-4-5")]),
      ],
    };
    expect(twoLanesTwoWeights.score(record(flattened))).toEqual({
      kind: "judgment",
      pass: false,
      label: "lookup Sonnet = decision Sonnet · judged/judged",
    });
  });

  it("fails a lane whose launch was not a judgment, and says which", () => {
    const base = healthy();
    const stated = {
      ...base,
      jobLogs: {
        ...base.jobLogs,
        evt_dd: [launchLine(DECISION_THREAD, "Opus 5", "stated")],
      },
    };
    expect(twoLanesTwoWeights.score(record(stated))).toEqual({
      kind: "judgment",
      pass: false,
      label: "lookup Haiku ≠ decision Opus 5 · judged/stated",
    });
  });

  it("fails a lane whose log and reply disagree, even though the tiers differ", () => {
    const base = healthy();
    const lying = {
      ...base,
      jobLogs: {
        ...base.jobLogs,
        evt_dd: [launchLine(DECISION_THREAD, "Sonnet", "judged")],
      },
    };
    expect(twoLanesTwoWeights.score(record(lying))).toEqual({
      kind: "judgment",
      pass: false,
      label: "lookup Haiku ≠ decision Opus 5 · judged/judged",
    });
  });

  it("fails an unanswered lane distinctly — no comparison can be made", () => {
    const base = healthy();
    const unanswered = {
      ...base,
      threads: [
        thread(LOOKUP_THREAD, [turn("user"), turn("agent", "claude-haiku-4-5")]),
        thread(DECISION_THREAD, [turn("user")]),
      ],
    };
    expect(twoLanesTwoWeights.score(record(unanswered))).toEqual({
      kind: "judgment",
      pass: false,
      label: "lookup Haiku · decision (no reply) · judged/judged",
    });
  });

  it("fails when a lane's event did not settle processed", () => {
    const base = healthy();
    const unsettled = {
      ...base,
      events: (base.events ?? []).map((observed) =>
        observed.id === "evt_decision" ? { ...observed, status: "pending" as const } : observed,
      ),
    };
    expect(twoLanesTwoWeights.score(record(unsettled))).toEqual({
      kind: "judgment",
      pass: false,
      label: "lookup Haiku ≠ decision Opus 5 · judged/judged",
    });
  });
});
