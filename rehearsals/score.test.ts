import { describe, expect, it } from "vitest";
import type { Observation } from "./observe.js";
import type { RunRecord, Scenario, ScenarioRunScore } from "./scenario.js";
import { renderScorecard, scoreScenario, universalFindings, type PassInfo } from "./score.js";

const emptyQueue = (): Observation["queue"] => ({
  byStatus: {
    pending: [],
    "in-progress": [],
    deferred: [],
    processed: [],
    failed: [],
    abandoned: [],
  },
  malformed: [],
});

const cleanObservation = (): Observation => ({
  docCheck: { code: 0, stdout: "{}" },
  baseDirEntries: [".corpus-run.json", "bin", "workspace"],
  commitsSinceSeed: [
    {
      hash: "a".repeat(40),
      tree: "t".repeat(40),
      parents: ["p".repeat(40)],
      authorName: "agent",
      authorEmail: "agent@corpus.local",
      subject: "x",
    },
  ],
  gitStatus: [],
  queue: emptyQueue(),
  jobLogs: {},
  threads: [],
  docs: [],
});

const record = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  scenarioId: "s",
  runIndex: 0,
  seed: { refs: {} },
  seedSnapshot: {
    head: "h",
    headTree: "seedtree".padEnd(40, "0"),
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
  observation: cleanObservation(),
  meta: {
    startedAt: "2026-09-01T00:00:00Z",
    endedAt: "2026-09-01T00:05:00Z",
    durationMs: 300_000,
    overBudget: false,
    endedBy: "quiescence",
    runnerExitCode: 0,
  },
  ...overrides,
});

describe("universalFindings", () => {
  it("passes a clean run", () => {
    expect(universalFindings(record())).toEqual([]);
  });

  it("flags a post-seed commit not authored by the agent through the server", () => {
    const observation = {
      ...cleanObservation(),
      commitsSinceSeed: [
        {
          hash: "b".repeat(40),
          tree: "u".repeat(40),
          parents: ["p".repeat(40)],
          authorName: "user",
          authorEmail: "user@corpus.local",
          subject: "hand edit",
        },
      ],
    };
    const findings = universalFindings(record({ observation }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("user <user@corpus.local>");
  });

  it("excuses the seed window's relabel — a user commit with the boundary's own tree", () => {
    const base = record();
    const observation = {
      ...cleanObservation(),
      commitsSinceSeed: [
        {
          hash: "c".repeat(40),
          tree: base.seedSnapshot.headTree,
          parents: [base.seedSnapshot.headParent],
          authorName: "user",
          authorEmail: "user@corpus.local",
          subject: "editing session: 2 documents by user",
        },
      ],
    };
    expect(universalFindings({ ...base, observation })).toEqual([]);
  });

  /**
   * The two shapes the tree-only excusal let through (pr-reviewer, PR #71).
   * Both carry the boundary's tree and neither is the amend, so both must be
   * flagged — the second one especially, because it destroys the agent's work
   * and would otherwise leave every row green.
   */
  it("flags an empty user commit that merely carries the boundary's tree", () => {
    const base = record();
    const observation = {
      ...cleanObservation(),
      commitsSinceSeed: [
        {
          hash: "e".repeat(40),
          tree: base.seedSnapshot.headTree,
          // Sits on the boundary itself, not on the boundary's parent — so it
          // is a commit added after the seed, not an amend of it.
          parents: [base.seedSnapshot.head],
          authorName: "user",
          authorEmail: "user@corpus.local",
          subject: "editing session: 0 documents by user",
        },
      ],
    };
    expect(universalFindings({ ...base, observation })).toHaveLength(1);
  });

  it("flags a hand revert that restores the seed tree after the agent worked", () => {
    const base = record();
    const observation = {
      ...cleanObservation(),
      commitsSinceSeed: [
        {
          hash: "f".repeat(40),
          tree: "agentwork".padEnd(40, "2"),
          parents: [base.seedSnapshot.head],
          authorName: "agent",
          authorEmail: "agent@corpus.local",
          subject: "reply by agent",
        },
        {
          hash: "9".repeat(40),
          tree: base.seedSnapshot.headTree,
          parents: ["f".repeat(40)],
          authorName: "user",
          authorEmail: "user@corpus.local",
          subject: "editing session: 1 document by user",
        },
      ],
    };
    expect(universalFindings({ ...base, observation })).toHaveLength(1);
  });

  it("still flags a user commit whose tree moved — a real hand edit", () => {
    const observation = {
      ...cleanObservation(),
      commitsSinceSeed: [
        {
          hash: "d".repeat(40),
          tree: "moved".padEnd(40, "1"),
          parents: ["p".repeat(40)],
          authorName: "user",
          authorEmail: "user@corpus.local",
          subject: "editing session: 1 document by user",
        },
      ],
    };
    expect(universalFindings(record({ observation }))).toHaveLength(1);
  });

  it("flags a seeded event that vanished", () => {
    const seeded = record();
    const withSeed: RunRecord = {
      ...seeded,
      seedSnapshot: {
        ...seeded.seedSnapshot,
        queue: { ...seeded.seedSnapshot.queue, pending: ["evt_gone"] },
      },
    };
    expect(universalFindings(withSeed).some((f) => f.includes("evt_gone"))).toBe(true);
  });

  it("flags an event present in two status directories", () => {
    const observation = cleanObservation();
    const twice: Observation = {
      ...observation,
      queue: {
        ...observation.queue,
        byStatus: {
          ...observation.queue.byStatus,
          pending: [{ id: "evt_x", status: "pending", file: "p", parsed: {}, parseError: null }],
          processed: [
            { id: "evt_x", status: "processed", file: "q", parsed: {}, parseError: null },
          ],
        },
      },
    };
    expect(
      universalFindings(record({ observation: twice })).some((f) =>
        f.includes("2 status directories"),
      ),
    ).toBe(true);
  });

  it("flags a dirty work tree, a failed doc check, and an unparseable thread", () => {
    const observation: Observation = {
      ...cleanObservation(),
      gitStatus: [" M data/docs/x.md"],
      docCheck: { code: 6, stdout: "" },
      threads: [
        { path: "t", raw: "", frontmatter: null, parseError: "no frontmatter block", turns: [] },
      ],
    };
    const findings = universalFindings(record({ observation }));
    expect(findings).toHaveLength(3);
  });
});

const scenarioWith = (
  grade: Scenario["grade"],
  runs: number,
  score: (r: RunRecord) => ScenarioRunScore,
  threshold?: number,
): Scenario => ({
  id: "s",
  story: "story",
  regressionFor: null,
  grade,
  runs,
  ...(threshold === undefined ? {} : { threshold }),
  budgetMs: 1,
  seed: () => Promise.resolve({ refs: {} }),
  score,
});

describe("scoreScenario — the two grades are different tests", () => {
  it("an invariant fails on a single breach across its runs", () => {
    const scenario = scenarioWith("invariant", 3, (r) => ({
      kind: "invariant",
      findings: r.runIndex === 1 ? ["breach"] : [],
    }));
    const result = scoreScenario(scenario, [
      record({ runIndex: 0 }),
      record({ runIndex: 1 }),
      record({ runIndex: 2 }),
    ]);
    expect(result.grade).toBe("fail");
  });

  it("a judgment is k/N against its threshold, with the distribution kept", () => {
    const scenario = scenarioWith(
      "judgment",
      4,
      (r) => ({
        kind: "judgment",
        pass: r.runIndex < 3,
        label: r.runIndex < 3 ? "sonnet" : "haiku",
      }),
      3,
    );
    const result = scoreScenario(
      scenario,
      [0, 1, 2, 3].map((runIndex) => record({ runIndex })),
    );
    expect(result.grade).toBe("pass");
    expect(result.judgment).toMatchObject({ k: 3, n: 4, threshold: 3 });
    expect(result.judgment?.distribution).toEqual({ sonnet: 3, haiku: 1 });
  });

  it("a judgment below threshold fails", () => {
    const scenario = scenarioWith(
      "judgment",
      2,
      () => ({ kind: "judgment", pass: false, label: "haiku" }),
      2,
    );
    expect(scoreScenario(scenario, [record({ runIndex: 0 }), record({ runIndex: 1 })]).grade).toBe(
      "fail",
    );
  });

  it("an over-budget run is recorded, not failed — and never scored for the scenario", () => {
    const scenario = scenarioWith("invariant", 1, () => ({
      kind: "invariant",
      findings: ["would-have-breached"],
    }));
    const overBudget = record({
      meta: { ...record().meta, overBudget: true, endedBy: "budget" },
    });
    const result = scoreScenario(scenario, [overBudget]);
    expect(result.grade).toBe("over-budget");
    expect(result.outcomes[0]?.score).toBeNull();
  });

  it("a universal breach fails even a judgment scenario", () => {
    const scenario = scenarioWith("judgment", 1, () => ({
      kind: "judgment",
      pass: true,
      label: "ok",
    }));
    const observation = {
      ...cleanObservation(),
      gitStatus: ["?? data/docs/stray.md"],
    };
    expect(scoreScenario(scenario, [record({ observation })]).grade).toBe("fail");
  });
});

describe("renderScorecard", () => {
  const info: PassInfo = {
    release: "v0.31.0",
    date: "2026-09-01T00:00:00Z",
    treeVersion: "0.30.0",
    treeCommit: "abc1234",
    runnerModel: "sonnet",
  };

  it("prints a judgment as k/N and an invariant's findings", () => {
    const judgment = scoreScenario(
      scenarioWith(
        "judgment",
        2,
        (r) => ({
          kind: "judgment",
          pass: r.runIndex === 0,
          label: r.runIndex === 0 ? "sonnet" : "haiku",
        }),
        2,
      ),
      [record({ runIndex: 0 }), record({ runIndex: 1 })],
    );
    const card = renderScorecard(info, [judgment]);
    expect(card).toContain("1/2");
    expect(card).toContain("sonnet: 1");
    expect(card).toContain("Release: v0.31.0");
    expect(card.endsWith("\n")).toBe(true);
  });
});
