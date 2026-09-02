/**
 * Story 1 — *"I designated a resident at heavy, and it answers at heavy."*
 * (INFRA-034 table)
 *
 * Regression for: AGENT-041 — nothing told a listener's launch what model to
 * run at, so a designation's weight selected nothing. SPEC.md §7's promise —
 * a stated weight is *"honoured, not weighed again"* — is a prose obligation
 * on an agent, so only this suite can check it. AGENT-059 added the half this
 * scorer reads: the launch is logged on the designation's own event, with its
 * provenance word — `stated` for a weight the designation named.
 *
 * Seed: one composer request — `POST /api/threads` with a question,
 * `requestsAgent: true`, and `resident: {weight: <key>}`. The key is read off
 * the workspace's own tier table (its last row — the issue's `heavy` in the
 * shipped guidance), never hardcoded, so the assertion and the fixture cannot
 * disagree about what the workspace declares. The composer path is used
 * because designating-with-weight at creation has no CLI spelling on purpose
 * (SHARED-022 Q5) — this request is the product's own Ask.
 *
 * Asserts (invariant, on what the corpus records):
 * - exactly one `resident.designated` for the thread, settled `processed`;
 * - the launch record carries `stated`, and never `judged`;
 * - the question got exactly one agent reply, and that turn's recorded model
 *   (SPEC.md §10) is the stated row's model — read from the seed's own table.
 */

import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";
import { nonStrongestRow, recordedModelMatches } from "../weight-table.js";
import {
  ComposerThreadResponseSchema,
  eventsOfType,
  expectProcessed,
  jobLogLines,
  readServedWeightTable,
  threadById,
  turnsBy,
  weightTableFromRefs,
  weightTableRefs,
} from "./support.js";

const QUESTION =
  "What would be a sensible outline for a short note about preparing raised garden beds? " +
  "Please answer here in this thread.";

async function seed(ctx: SeedContext) {
  const table = await readServedWeightTable(ctx);
  // Deliberately not the strongest row. A weightless designation is judged
  // (AGENT-063), and the judgment's stated lean is to the stronger end, so a
  // strongest stated key would often coincide with what a judgment picks and
  // the turn's own record — the durable one — would prove little. A weaker
  // stated key keeps the model discriminating as well as the log's provenance
  // word (pr-reviewer, PR #71).
  const stated = nonStrongestRow(table.rows);
  if (stated === null) {
    throw new Error(
      "the workspace's orchestrate skill declares fewer than two tiers — cannot seed a stated weight that differs from the default",
    );
  }
  const response = await ctx.composer("/api/threads", {
    title: "Raised bed preparation",
    body: QUESTION,
    requestsAgent: true,
    resident: { weight: stated.key },
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`seeding POST /api/threads answered ${String(response.status)}`);
  }
  const parsed = ComposerThreadResponseSchema.parse(response.json);
  if (parsed.eventId === null) {
    throw new Error("the composer's Ask enqueued nothing — requestsAgent was not honoured");
  }
  return {
    refs: {
      threadId: parsed.thread.id,
      commentEventId: parsed.eventId,
      statedKey: stated.key,
      weightTable: weightTableRefs(table.rows),
    },
  };
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadId = record.seed.refs.threadId ?? "";
  const commentEventId = record.seed.refs.commentEventId ?? "";
  const statedKey = record.seed.refs.statedKey ?? "";
  const rows = weightTableFromRefs(record);
  const statedRow = rows.find((row) => row.key === statedKey);

  if (statedRow === undefined) {
    findings.push(`the seed's refs carry no row for the stated key "${statedKey}"`);
    return { kind: "invariant", findings };
  }

  const designated = eventsOfType(record, "resident.designated", threadId);
  if (designated.length !== 1) {
    findings.push(
      `expected exactly one resident.designated for ${threadId}, found ${String(designated.length)}`,
    );
  }
  for (const event of designated) {
    const settled = expectProcessed(record, event.id, "the designation announcement");
    if (settled !== null) findings.push(settled);
  }

  // The launch record (AGENT-059/063): logged on the designation's own event,
  // or on the lane.waiting the pass claimed for the lane — with `stated` as
  // the provenance, because the designation chose. A `judged` anywhere on
  // those logs is a launch that discarded the person's choice.
  const launchEventIds = [
    ...designated.map((event) => event.id),
    ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
  ];
  const lines = launchEventIds.flatMap((eventId) => jobLogLines(record, eventId));
  if (!lines.some((entry) => entry.line.includes("stated"))) {
    findings.push(`no launch record on ${launchEventIds.join(", ")} says the weight was stated`);
  }
  if (lines.some((entry) => entry.line.includes("judged"))) {
    findings.push("a launch record says `judged` on a lane whose designation stated a weight");
  }

  const commentSettled = expectProcessed(record, commentEventId, "the question's event");
  if (commentSettled !== null) findings.push(commentSettled);

  const thread = threadById(record, threadId);
  if (thread === undefined) {
    findings.push(`the seeded thread ${threadId} has no file under data/threads/`);
  } else {
    const replies = turnsBy(thread, "agent");
    if (replies.length !== 1) {
      findings.push(
        `expected exactly one agent reply on ${threadId}, found ${String(replies.length)}`,
      );
    }
    for (const reply of replies) {
      if (!recordedModelMatches(statedRow.model, reply.model)) {
        findings.push(
          `the reply's recorded model "${reply.model ?? "(none)"}" is not the stated row's ` +
            `("${statedRow.model}", key ${statedRow.key})`,
        );
      }
    }
  }
  return { kind: "invariant", findings };
}

export const statedWeight: Scenario = {
  id: "01-stated-weight",
  story: "I designated a resident at heavy, and it answers at heavy.",
  regressionFor: "AGENT-041",
  grade: "invariant",
  runs: 3,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
