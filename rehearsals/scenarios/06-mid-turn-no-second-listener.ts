/**
 * Story 6 — *"Someone is mid-turn — do not start a second one."*
 * (INFRA-034 table)
 *
 * Regression for: AGENT-029 — a resident working longer than the grace window
 * holds no park, so its lane reads not-`live` while it works, and the loop used
 * to read that as a dead lane and launch a second listener onto a conversation
 * already being answered. The fix was `working` (a lane holding claimed work),
 * read *before* the reap, plus a lane that absorbs a duplicate harmlessly.
 *
 * The record-based observation of "did not start a second one": a listener
 * holds its claimed event in-progress for the whole of its turn, so every real
 * listener spends a window reading `working · not live`. Across the run the
 * loop wakes and re-reads the roster inside that window, and the assertion is
 * that it stands down there — which shows up as **exactly one launch recorded**
 * for the lane, never two. The issue's "the console line reads *standing down*"
 * is that fact, and rule 4 has us assert the fact, not the sentence.
 *
 * Seed: one standalone Ask through the CLI — a designated lane with one pending
 * question, the ordinary way a listener is launched with work already waiting.
 *
 * Asserts (invariant, on what the corpus records):
 * - exactly one launch recorded for the lane (`judged`, AGENT-063) — a
 *   second listener launched mid-turn is a second launch line;
 * - exactly one agent reply, and only the seeded user turn;
 * - the question's event settled `processed`.
 */

import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";
import {
  corpusJson,
  eventsOfType,
  expectProcessed,
  jobLogLines,
  threadById,
  ThreadCreateResultSchema,
  turnsBy,
} from "./support.js";

const QUESTION =
  "What is a good companion plant for carrots, and why? Please answer here in this thread.";

async function seed(ctx: SeedContext) {
  const thread = await corpusJson(
    ctx,
    [
      "thread",
      "create",
      "--title",
      "Companion planting",
      "--requests-agent",
      "true",
      "-m",
      QUESTION,
    ],
    ThreadCreateResultSchema,
  );
  if (thread.eventId === null) {
    throw new Error("the standalone Ask enqueued nothing — requestsAgent was not honoured");
  }
  return { refs: { threadId: thread.thread.id, commentEventId: thread.eventId } };
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadId = record.seed.refs.threadId ?? "";
  const commentEventId = record.seed.refs.commentEventId ?? "";

  const launchEventIds = [
    ...eventsOfType(record, "resident.designated", threadId).map((event) => event.id),
    ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
  ];
  const launchLines = launchEventIds
    .flatMap((eventId) => jobLogLines(record, eventId))
    .filter((entry) => entry.line.includes("judged"));
  if (launchLines.length !== 1) {
    findings.push(
      `expected exactly one recorded launch for ${threadId}, found ${String(launchLines.length)} ` +
        "`judged` launch lines — a second one is a listener started onto a lane mid-turn",
    );
  }

  const settled = expectProcessed(record, commentEventId, "the question's event");
  if (settled !== null) findings.push(settled);

  const thread = threadById(record, threadId);
  if (thread === undefined) {
    findings.push(`the seeded thread ${threadId} has no file under data/threads/`);
  } else {
    if (turnsBy(thread, "agent").length !== 1) {
      findings.push(
        `expected exactly one agent reply on ${threadId}, found ${String(turnsBy(thread, "agent").length)}`,
      );
    }
    if (turnsBy(thread, "user").length !== 1) {
      findings.push(
        `the seeded question should be the only user turn on ${threadId}, found ${String(turnsBy(thread, "user").length)}`,
      );
    }
  }
  return { kind: "invariant", findings };
}

export const midTurnNoSecondListener: Scenario = {
  id: "06-mid-turn-no-second-listener",
  story: "Someone is mid-turn — do not start a second one.",
  regressionFor: "AGENT-029",
  grade: "invariant",
  runs: 3,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
