/**
 * Story 2 — *"I designated one and chose no weight."* (INFRA-034 table)
 *
 * Regression for: **AGENT-059** — a weightless designation used to fall through
 * to the job table's judgment, and every listener launched at whatever the two
 * passes made of a conversation that had not happened yet. The user hit it as
 * ten-out-of-ten Sonnet listeners. The rule now is: a `null` weight launches at
 * the **strongest tier the workspace's table declares** — its last row, because
 * the table is written lightest first — logged `defaulted` on the designation's
 * own event.
 *
 * This is the suite's one **judgment**: the subject is an agent following
 * prose, so the result is the full distribution of what launched, printed
 * `k/N`. Before AGENT-059 this scorecard would have read `10/10 Sonnet`.
 * The threshold is N itself: the rule admits no exception, so any run that
 * launches elsewhere is a miss the distribution must show.
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
import { recordedModelMatches, strongestRow } from "../weight-table.js";
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
  const strongest = strongestRow(rows);

  const launchEventIds = [
    ...eventsOfType(record, "resident.designated", threadId).map((event) => event.id),
    ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
  ];
  const lines = launchEventIds.flatMap((eventId) => jobLogLines(record, eventId));
  const provenance = lines.some((entry) => entry.line.includes("defaulted"))
    ? "defaulted"
    : lines.some((entry) => entry.line.includes("stated"))
      ? "stated"
      : "unrecorded";

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
    strongest !== null &&
    matchedRow !== null &&
    matchedRow.key === strongest.key &&
    provenance === "defaulted" &&
    eventStatus(record, commentEventId) === "processed";

  return { kind: "judgment", pass, label };
}

export const weightlessDesignation: Scenario = {
  id: "02-weightless-designation",
  story: "I designated one and chose no weight.",
  regressionFor: "AGENT-059",
  grade: "judgment",
  runs: 10,
  threshold: 10,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
