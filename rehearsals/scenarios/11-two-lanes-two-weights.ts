/**
 * Story 11 — *"I opened two lanes for different work, and each launched at
 * its own weight."* (INFRA-035)
 *
 * Regression for: **AGENT-063** — but the half story 2 cannot carry. Story 2's
 * ten runs all judging Haiku is the right answer for its seed and still proves
 * only reliability: a rule that answered "Haiku" to everything would score
 * identically. What AGENT-063 actually promises is that the orchestrator
 * weighs *what the person opened this lane for* — a **read that
 * discriminates**. Only a comparison can show that, so this scenario seeds two
 * lanes in one workspace and asserts the launches came out **different**.
 *
 * The two shapes INFRA-035 offered, and why this one. A second single-lane
 * scenario would put each distribution in its own scorecard section and leave
 * the finding — "the two land differently" — to a reader holding both rows in
 * their head, or to new cross-scenario grading machinery the harness does not
 * have (rule 3 grades one scenario at a time). Seeding both lanes in one
 * workspace tests the comparison directly and controlled: same session, same
 * declared table, same runner, so a difference between the launches can only
 * come from reading the lanes' purposes. Each run's label *is* the comparison,
 * stated in one place.
 *
 * Seed: two standalone Asks through the CLI, each a weightless designation.
 * Both directions are deliberately unambiguous, because a borderline lane
 * would make a same-tier run uninterpretable:
 *
 * - **lookup** — a fetch-and-relay question with one flat answer, story 2's
 *   register;
 * - **decision** — a choice being weighed between stated trade-offs, whose
 *   answer is wording that will leave the corpus verbatim.
 *
 * A run passes only when the corpus records, for **both** lanes, what story 2
 * requires of one — a `judged` launch whose logged weight matches the reply's
 * recorded model, and a `processed` event — **and** the two matched tiers
 * differ.
 *
 * Deliberately not asserted, both for AGENT-063's reason (pinning re-imposes
 * a default through the test):
 *
 * - **no tier is named** — only inequality is graded;
 * - **no direction is asserted** — "the decision lane must land heavier"
 *   would encode this file's own read of the two seeds into the grader. The
 *   label keeps the lanes in a fixed order, so an inverted read is visible in
 *   the distribution rather than asserted away.
 *
 * Needs a table declaring at least two tiers — on one tier the comparison
 * this scenario exists for cannot be expressed, so seeding refuses.
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

const LOOKUP_TITLE = "Last frost";
const LOOKUP_QUESTION =
  "When is the last spring frost usually expected in a temperate maritime climate? " +
  "Please answer here in this thread.";

const DECISION_TITLE = "Greenhouse or raised beds";
const DECISION_QUESTION =
  "I can afford one build this year: a small greenhouse, or three more raised beds. " +
  "The greenhouse extends the season but costs three times as much and would shade the " +
  "herb bed every afternoon. The raised beds are cheap and proven but give me nothing in " +
  "winter. Weigh the trade-offs, recommend one, and draft the short paragraph I will send " +
  "to the allotment association explaining the choice — they will read it verbatim. " +
  "Please answer here in this thread.";

async function ask(ctx: SeedContext, title: string, body: string): Promise<[string, string]> {
  const thread = await corpusJson(
    ctx,
    ["thread", "create", "--title", title, "--requests-agent", "true", "-m", body],
    ThreadCreateResultSchema,
  );
  if (thread.eventId === null) {
    throw new Error(`the standalone Ask "${title}" enqueued nothing`);
  }
  return [thread.thread.id, thread.eventId];
}

async function seed(ctx: SeedContext) {
  const table = await readServedWeightTable(ctx);
  if (table.rows.length < 2) {
    throw new Error(
      "the workspace declares fewer than two tiers — two lanes cannot launch differently",
    );
  }
  const [lookupThreadId, lookupEventId] = await ask(ctx, LOOKUP_TITLE, LOOKUP_QUESTION);
  const [decisionThreadId, decisionEventId] = await ask(ctx, DECISION_TITLE, DECISION_QUESTION);
  return {
    refs: {
      lookupThreadId,
      lookupEventId,
      decisionThreadId,
      decisionEventId,
      weightTable: weightTableRefs(table.rows),
    },
  };
}

function score(record: RunRecord): ScenarioRunScore {
  const rows = weightTableFromRefs(record);
  const lookup = readLaneLaunch(record, record.seed.refs.lookupThreadId ?? "", rows);
  const decision = readLaneLaunch(record, record.seed.refs.decisionThreadId ?? "", rows);

  // The comparison, which is the whole scenario: `≠` passes, `=` is one read
  // for two lanes — landing, not judging — and `·` says a side never resolved
  // to a declared tier at all.
  const differ =
    lookup.matchedRow !== null &&
    decision.matchedRow !== null &&
    lookup.matchedRow.key !== decision.matchedRow.key;
  const comparison =
    lookup.matchedRow === null || decision.matchedRow === null ? "·" : differ ? "≠" : "=";
  const label =
    `lookup ${lookup.tier} ${comparison} decision ${decision.tier}` +
    ` · ${lookup.provenance}/${decision.provenance}`;

  const pass =
    differ &&
    laneJudgedTruthfully(lookup) &&
    laneJudgedTruthfully(decision) &&
    eventStatus(record, record.seed.refs.lookupEventId ?? "") === "processed" &&
    eventStatus(record, record.seed.refs.decisionEventId ?? "") === "processed";

  return { kind: "judgment", pass, label };
}

export const twoLanesTwoWeights: Scenario = {
  id: "11-two-lanes-two-weights",
  story: "I opened two lanes for different work, and each launched at its own weight.",
  regressionFor: "AGENT-063",
  grade: "judgment",
  runs: 10,
  threshold: 10,
  // Two answer cycles in one session: story 2's single cycle fits 15 minutes,
  // and the second lane gets its own headroom rather than starving under the
  // first's park window.
  budgetMs: 20 * 60_000,
  seed,
  score,
};
