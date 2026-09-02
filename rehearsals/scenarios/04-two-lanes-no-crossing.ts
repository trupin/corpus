/**
 * Story 4 — *"Two conversations, two residents, nobody crosses."*
 * (INFRA-034 table)
 *
 * Regression for: AGENT-056 — the loop used to reap before reading the roster,
 * which stripped `working` off a busy lane and made a resident mid-turn read
 * exactly like a dead one, so lanes collected second listeners and one
 * conversation got answered by two agents that could not see each other.
 *
 * Seed: two standalone Asks through the CLI, each designating its own general
 * resident and enqueuing one question on its own lane.
 *
 * Asserts (invariant, on what the corpus records):
 * - each question's event settles `processed`;
 * - each thread carries exactly one agent reply and only its own user turn —
 *   an answer in the wrong thread shows up as a count on both sides;
 * - each lane's launch is recorded exactly once (AGENT-059's `defaulted` on
 *   the lane's own designation/notice log) — a duplicated listener is a
 *   duplicated launch record;
 * - no thread beyond the two seeded ones exists.
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

const QUESTIONS = [
  {
    title: "Compost timing",
    body: "When in the year should a small compost heap be started? Please answer here in this thread.",
  },
  {
    title: "Watering schedule",
    body: "How often should tomato seedlings be watered in their first month? Please answer here in this thread.",
  },
] as const;

async function seed(ctx: SeedContext) {
  const refs: Record<string, string> = {};
  for (const [index, question] of QUESTIONS.entries()) {
    const thread = await corpusJson(
      ctx,
      [
        "thread",
        "create",
        "--title",
        question.title,
        "--requests-agent",
        "true",
        "-m",
        question.body,
      ],
      ThreadCreateResultSchema,
    );
    if (thread.eventId === null) {
      throw new Error(`the standalone Ask "${question.title}" enqueued nothing`);
    }
    refs[`threadId${String(index)}`] = thread.thread.id;
    refs[`commentEventId${String(index)}`] = thread.eventId;
  }
  return { refs };
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadIds = [record.seed.refs.threadId0 ?? "", record.seed.refs.threadId1 ?? ""];

  for (const [index, threadId] of threadIds.entries()) {
    const commentEventId = record.seed.refs[`commentEventId${String(index)}`] ?? "";
    const settled = expectProcessed(record, commentEventId, `the question on ${threadId}`);
    if (settled !== null) findings.push(settled);

    const thread = threadById(record, threadId);
    if (thread === undefined) {
      findings.push(`the seeded thread ${threadId} has no file under data/threads/`);
      continue;
    }
    const replies = turnsBy(thread, "agent");
    const userTurns = turnsBy(thread, "user");
    if (replies.length !== 1) {
      findings.push(
        `expected exactly one agent reply on ${threadId}, found ${String(replies.length)}`,
      );
    }
    if (userTurns.length !== 1) {
      findings.push(
        `the seeded question should be the only user turn on ${threadId}, found ${String(userTurns.length)}`,
      );
    }

    const launchEventIds = [
      ...eventsOfType(record, "resident.designated", threadId).map((event) => event.id),
      ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
    ];
    const launchLines = launchEventIds
      .flatMap((eventId) => jobLogLines(record, eventId))
      .filter((entry) => entry.line.includes("defaulted"));
    if (launchLines.length !== 1) {
      findings.push(
        `expected exactly one recorded launch for ${threadId}, found ${String(launchLines.length)} ` +
          "`defaulted` lines on its designation/notice logs",
      );
    }
  }

  const seeded = new Set(threadIds);
  const strays = record.observation.threads.filter((thread) => {
    const id = thread.frontmatter?.id;
    return typeof id !== "string" || !seeded.has(id);
  });
  for (const stray of strays) {
    findings.push(`an unseeded thread appeared: ${stray.path}`);
  }
  return { kind: "invariant", findings };
}

export const twoLanesNoCrossing: Scenario = {
  id: "04-two-lanes-no-crossing",
  story: "Two conversations, two residents, nobody crosses.",
  regressionFor: "AGENT-056",
  grade: "invariant",
  runs: 3,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
