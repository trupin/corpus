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
import { modelFamilyOf, recordedModelMatches } from "../weight-table.js";
import {
  corpusJson,
  eventsOfType,
  eventStatus,
  jobLogLines,
  readServedWeightTable,
  threadById,
  ThreadCreateResultSchema,
  turnsBy,
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
  const rows = weightTableFromRefs(record);

  const launchEventIds = [
    ...eventsOfType(record, "resident.designated", threadId).map((event) => event.id),
    ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
  ];
  const lines = launchEventIds.flatMap((eventId) => jobLogLines(record, eventId));
  // `defaulted` is dead vocabulary (AGENT-063), kept detectable so a revert to
  // the fixed rule shows up in the label rather than as a mute "unrecorded".
  const provenance = lines.some((entry) => entry.line.includes("judged"))
    ? "judged"
    : lines.some((entry) => entry.line.includes("defaulted"))
      ? "defaulted"
      : lines.some((entry) => entry.line.includes("stated"))
        ? "stated"
        : "unrecorded";

  // The weight the launch *logged*: a declared row named on a judged line —
  // matched by model family, case-insensitively, the same tolerance
  // `recordedModelMatches` gives a turn's recorded model.
  const loggedRow =
    rows.find((row) =>
      lines.some(
        (entry) =>
          entry.line.includes("judged") &&
          entry.line.toLowerCase().includes(modelFamilyOf(row.model)),
      ),
    ) ?? null;

  const thread = threadById(record, threadId);
  const replies = thread === undefined ? [] : turnsBy(thread, "agent");
  const reply = replies.length === 1 ? (replies[0] ?? null) : null;
  const matchedRow =
    reply === null
      ? null
      : (rows.find((row) => recordedModelMatches(row.model, reply.model)) ?? null);

  const tier =
    reply === null
      ? replies.length === 0
        ? "(no reply)"
        : `(${String(replies.length)} replies)`
      : matchedRow === null
        ? `unmatched model "${reply.model ?? "(none)"}"`
        : matchedRow.model;
  const label = `${tier} · ${provenance}`;

  const pass =
    provenance === "judged" &&
    loggedRow !== null &&
    matchedRow !== null &&
    loggedRow.key === matchedRow.key &&
    eventStatus(record, commentEventId) === "processed";

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
