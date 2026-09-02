/**
 * Grading and the scorecard (INFRA-033).
 *
 * Two grades, and they are not the same test (rule 3): an invariant fails its
 * scenario on a single breach; a judgment is a ratio `k/N` against a declared
 * threshold. The three universal invariants run on every run of every
 * scenario, whatever it is about.
 *
 * Everything here is pure over {@link RunRecord}s, so it is testable without
 * an agent anywhere near.
 */

import type { RunRecord, Scenario, ScenarioRunScore } from "./scenario.js";

/** The only author a post-seed commit may carry (apps/server/src/git/commit.ts). */
export const AGENT_AUTHOR = { name: "agent", email: "agent@corpus.local" } as const;

/**
 * The three checks every run gets. A breach is reported even on an over-budget
 * run: a hand-edit or a lost event is real evidence however the run ended, and
 * none of these can be caused by the harness stopping a parked agent.
 */
export function universalFindings(record: RunRecord): readonly string[] {
  const findings: string[] = [];
  const { observation, seedSnapshot } = record;

  // 1. No event lost or double-worked: every seeded event still exists, every
  //    event id lives in exactly one status directory, and every queue file is
  //    readable.
  const seen = new Map<string, string[]>();
  for (const events of Object.values(observation.queue.byStatus)) {
    for (const event of events) {
      const statuses = seen.get(event.id) ?? [];
      statuses.push(event.status);
      seen.set(event.id, statuses);
      if (event.parseError !== null) {
        findings.push(`queue event ${event.id} is unreadable: ${event.parseError}`);
      }
    }
  }
  for (const [id, statuses] of seen) {
    if (statuses.length > 1) {
      findings.push(
        `event ${id} exists in ${statuses.length} status directories: ${statuses.join(", ")}`,
      );
    }
  }
  for (const ids of Object.values(seedSnapshot.queue)) {
    for (const id of ids) {
      if (!seen.has(id)) findings.push(`event ${id} existed at seed time and is gone`);
    }
  }
  for (const file of observation.queue.malformed) {
    findings.push(`unrecognisable file in a queue status directory: ${file}`);
  }

  // 2. Every commit is the server's, acting for the agent. A `user` author
  //    after the seed is the watcher committing a hand edit; any other author
  //    is worse. Uncommitted bytes are bytes nobody accounted for.
  //
  //    One precise exception: the seed's own commit does not stay put. The
  //    server closes a commit window lazily, so the run's first agent write
  //    *amends* the seed's `user` commit into its "editing session" relabel —
  //    same content, new hash, on the run's side of the boundary (measured
  //    2026-09-01, three runs out of three). The amend changes no content, so
  //    a `user` commit whose tree equals the boundary's tree is the seed
  //    itself. A real hand edit changes the tree and is still flagged.
  for (const commit of observation.commitsSinceSeed) {
    if (commit.authorName !== AGENT_AUTHOR.name || commit.authorEmail !== AGENT_AUTHOR.email) {
      const isSeedRelabel = commit.authorName === "user" && commit.tree === seedSnapshot.headTree;
      if (isSeedRelabel) continue;
      findings.push(
        `commit ${commit.hash.slice(0, 10)} is authored "${commit.authorName} <${commit.authorEmail}>", not the agent acting through the server`,
      );
    }
  }
  for (const line of observation.gitStatus) {
    findings.push(`work tree not clean after the run: ${line}`);
  }

  // 3. Every document still parses — by the product's own validator, and by
  //    the observer's read of every thread file.
  if (observation.docCheck.code !== 0) {
    findings.push(`corpus doc check exited ${observation.docCheck.code}`);
  }
  for (const thread of observation.threads) {
    if (thread.parseError !== null) {
      findings.push(`thread file ${thread.path} does not parse: ${thread.parseError}`);
    }
  }
  return findings;
}

export interface RunOutcome {
  readonly runIndex: number;
  readonly overBudget: boolean;
  readonly endedBy: RunRecord["meta"]["endedBy"];
  readonly durationMs: number;
  readonly universalFindings: readonly string[];
  /** Absent on an over-budget run: the scenario was not given its full chance. */
  readonly score: ScenarioRunScore | null;
}

export type ScenarioGrade = "pass" | "fail" | "over-budget";

export interface JudgmentSummary {
  readonly k: number;
  readonly n: number;
  readonly declaredRuns: number;
  readonly threshold: number;
  readonly distribution: Readonly<Record<string, number>>;
}

export interface ScenarioResult {
  readonly scenario: Pick<Scenario, "id" | "story" | "regressionFor" | "grade" | "runs">;
  readonly outcomes: readonly RunOutcome[];
  readonly grade: ScenarioGrade;
  readonly judgment: JudgmentSummary | null;
}

/**
 * Grade one scenario over its runs.
 *
 * - Any universal breach fails the scenario, whatever its grade.
 * - Invariant: any finding on a scored run fails; every run over budget grades
 *   `over-budget`; otherwise pass.
 * - Judgment: `k` over the scored runs against the declared threshold. Runs
 *   lost to the budget are visible in the summary (`n` < declared N) and the
 *   scenario cannot pass unless every declared run was scored — a ratio over a
 *   sample that quietly shrank would be the scorecard lying about its own N.
 */
export function scoreScenario(scenario: Scenario, records: readonly RunRecord[]): ScenarioResult {
  const outcomes: RunOutcome[] = records.map((record) => ({
    runIndex: record.runIndex,
    overBudget: record.meta.overBudget,
    endedBy: record.meta.endedBy,
    durationMs: record.meta.durationMs,
    universalFindings: universalFindings(record),
    score: record.meta.overBudget ? null : scenario.score(record),
  }));

  const universalBreached = outcomes.some((outcome) => outcome.universalFindings.length > 0);
  const scored = outcomes.filter((outcome) => outcome.score !== null);
  const allOverBudget = scored.length === 0;

  if (scenario.grade === "judgment") {
    const threshold = scenario.threshold ?? scenario.runs;
    const distribution: Record<string, number> = {};
    let k = 0;
    for (const outcome of scored) {
      if (outcome.score?.kind !== "judgment") continue;
      distribution[outcome.score.label] = (distribution[outcome.score.label] ?? 0) + 1;
      if (outcome.score.pass) k += 1;
    }
    const judgment: JudgmentSummary = {
      k,
      n: scored.length,
      declaredRuns: scenario.runs,
      threshold,
      distribution,
    };
    const grade: ScenarioGrade = universalBreached
      ? "fail"
      : allOverBudget
        ? "over-budget"
        : scored.length === scenario.runs && k >= threshold
          ? "pass"
          : scored.length < scenario.runs
            ? "over-budget"
            : "fail";
    return { scenario: pickMeta(scenario), outcomes, grade, judgment };
  }

  const breached = outcomes.some(
    (outcome) => outcome.score?.kind === "invariant" && outcome.score.findings.length > 0,
  );
  const grade: ScenarioGrade =
    universalBreached || breached ? "fail" : allOverBudget ? "over-budget" : "pass";
  return { scenario: pickMeta(scenario), outcomes, grade, judgment: null };
}

function pickMeta(scenario: Scenario): ScenarioResult["scenario"] {
  return {
    id: scenario.id,
    story: scenario.story,
    regressionFor: scenario.regressionFor,
    grade: scenario.grade,
    runs: scenario.runs,
  };
}

export interface PassInfo {
  /** What this pass was run for — usually the release about to be cut. */
  readonly release: string;
  readonly date: string;
  readonly treeVersion: string;
  readonly treeCommit: string;
  readonly runnerModel: string;
}

/** The committed artifact: one file per pass, diffable between releases. */
export function renderScorecard(info: PassInfo, results: readonly ScenarioResult[]): string {
  const lines: string[] = [];
  lines.push("# Rehearsal scorecard");
  lines.push("");
  lines.push("<!-- Generated by `npm run rehearse` (INFRA-033). Do not edit by hand. -->");
  lines.push("");
  lines.push(`- Release: ${info.release}`);
  lines.push(`- Date: ${info.date}`);
  lines.push(`- Tree: v${info.treeVersion} at ${info.treeCommit}`);
  lines.push(`- Runner model: ${info.runnerModel}`);
  lines.push("");
  lines.push("| Scenario | Grade | Result | Detail |");
  lines.push("| --- | --- | --- | --- |");
  for (const result of results) {
    const detail =
      result.judgment === null
        ? `${String(result.outcomes.filter((o) => o.score !== null).length)}/${String(result.scenario.runs)} runs scored`
        : `${String(result.judgment.k)}/${String(result.judgment.n)} against ≥${String(result.judgment.threshold)} of ${String(result.judgment.declaredRuns)}`;
    lines.push(
      `| ${result.scenario.id} | ${result.scenario.grade} | **${result.grade}** | ${detail} |`,
    );
  }
  lines.push("");
  for (const result of results) {
    lines.push(`## ${result.scenario.id}`);
    lines.push("");
    lines.push(`> ${result.scenario.story}`);
    lines.push("");
    lines.push(`- Regression for: ${result.scenario.regressionFor ?? "— (spec promise)"}`);
    lines.push(`- Declared runs: ${String(result.scenario.runs)}`);
    if (result.judgment !== null) {
      lines.push(
        `- Judgment: k/N = ${String(result.judgment.k)}/${String(result.judgment.n)}, threshold ${String(result.judgment.threshold)}`,
      );
      const entries = Object.entries(result.judgment.distribution).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [label, count] of entries) {
        lines.push(`  - ${label}: ${String(count)}`);
      }
    }
    for (const outcome of result.outcomes) {
      const seconds = `${String(Math.round(outcome.durationMs / 1000))}s`;
      const status = outcome.overBudget
        ? "over-budget"
        : outcome.score?.kind === "invariant"
          ? outcome.score.findings.length === 0
            ? "clean"
            : "breached"
          : outcome.score?.kind === "judgment"
            ? outcome.score.label
            : "unscored";
      lines.push(
        `- Run ${String(outcome.runIndex + 1)}: ${status} (${seconds}, ended by ${outcome.endedBy})`,
      );
      for (const finding of outcome.universalFindings) {
        lines.push(`  - universal: ${finding}`);
      }
      if (outcome.score?.kind === "invariant") {
        for (const finding of outcome.score.findings) {
          lines.push(`  - ${finding}`);
        }
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
