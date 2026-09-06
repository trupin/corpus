/**
 * Story 2 — *"I designated one and chose no weight."* (INFRA-034 table)
 *
 * Regression for: **AGENT-063** — a weightless designation is **judged on the
 * conversation** at launch, never defaulted. Two rules preceded this one, and
 * both are what the scorer must catch coming back. AGENT-059's report: the
 * launch fell through to the job table's two passes, which have no purchase on
 * a conversation, so every listener landed on the middle tier — landing, not
 * judging. AGENT-059's fix: a fixed strongest-tier default, which v0.31.0
 * shipped and the user reversed the next day (*"orchestrator picks based on
 * the task"*). What §7 promises now, and what every run must show:
 *
 * - the launch **logged a weight**, naming a tier the workspace's own table
 *   declares — never a level of the agent's invention;
 * - the log says the weight was **`judged`** — a judgment named as such, not
 *   `stated` (nobody stated one) and not `defaulted` (there is no default);
 * - the reply's recorded model matches the tier the log named — the log tells
 *   the truth about what ran;
 * - the question's event settled `processed`.
 *
 * **Which tier the judgment picks is deliberately not asserted.** A judged
 * pick is allowed to vary, and pinning one tier would re-impose a default
 * through the test. The distribution is the signal instead: every run's label
 * names the tier that ran, so the scorecard shows where the judgment lands —
 * and a scorecard reading 10/10 on one tier is the "landing, not judging"
 * symptom AGENT-063 exists to end, visible rather than asserted away.
 *
 * Seed: one standalone Ask through the CLI — `corpus thread create` with a
 * question and `--requests-agent true` — which designates a general resident
 * with no weight (SPEC.md §7's rider signed 2026-08-25) and enqueues the
 * question on the new lane.
 *
 * Each run's label names the tier row the reply's recorded model matches, and
 * the provenance word the launch record carries.
 */

import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";
import {
  corpusJson,
  eventStatus,
  laneJudgedTruthfully,
  readLaneLaunch,
  readServedWeightTable,
  ThreadCreateResultSchema,
  weightTableFromRefs,
  weightTableRefs,
} from "./support.js";

const QUESTION =
  "Which three vegetables are the most forgiving for a first-time gardener? " +
  "Please answer here in this thread.";

async function seed(ctx: SeedContext) {
  const table = await readServedWeightTable(ctx);
  if (table.rows.length === 0) {
    throw new Error("the workspace's orchestrate skill declares no tier table — cannot seed");
  }
  const thread = await corpusJson(
    ctx,
    ["thread", "create", "--title", "First vegetables", "--requests-agent", "true", "-m", QUESTION],
    ThreadCreateResultSchema,
  );
  if (thread.eventId === null) {
    throw new Error("the standalone Ask enqueued nothing — requestsAgent was not honoured");
  }
  return {
    refs: {
      threadId: thread.thread.id,
      commentEventId: thread.eventId,
      weightTable: weightTableRefs(table.rows),
    },
  };
}

function score(record: RunRecord): ScenarioRunScore {
  const threadId = record.seed.refs.threadId ?? "";
  const commentEventId = record.seed.refs.commentEventId ?? "";

  // The lane read lives in support.ts (`readLaneLaunch`), shared verbatim with
  // story 11 — which seeds a second, working-something-out lane beside this
  // story's fetch-and-relay one and asserts the two launches *differ*. This
  // story keeps owning the single-lane promise: judged, logged truthfully,
  // settled.
  const lane = readLaneLaunch(record, threadId, weightTableFromRefs(record));
  const label = `${lane.tier} · ${lane.provenance}`;
  const pass = laneJudgedTruthfully(lane) && eventStatus(record, commentEventId) === "processed";

  return { kind: "judgment", pass, label };
}

export const weightlessDesignation: Scenario = {
  id: "02-weightless-designation",
  story: "I designated one and chose no weight.",
  regressionFor: "AGENT-063",
  grade: "judgment",
  runs: 10,
  threshold: 10,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
