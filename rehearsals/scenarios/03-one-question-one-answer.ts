/**
 * Story 3 — *"I asked one question and got one answer."* (INFRA-034 table)
 *
 * Regression for: nothing — this is the loop's baseline story, implemented
 * with the harness (INFRA-033) to prove it end to end. It needs nothing from
 * AGENT-059, which is why it is the first one.
 *
 * Seed: one note, and one thread on it whose first turn asks the agent one
 * question — `corpus thread create --parent … --requests-agent true`, which
 * enqueues the one `comment.created` the story is about, on the orchestrator's
 * lane. Deliberately **not** a standalone ask: asking on a standalone thread
 * designates a resident (measured 2026-09-01: it enqueues
 * `resident.designated` and `lane.waiting` beside the comment), and this story
 * was chosen exactly because it needs nothing from that path (AGENT-059).
 *
 * Asserts (invariant, on what the corpus records and nothing else):
 * - exactly one reply turn was appended to the thread, authored `agent`;
 * - that `comment.created` event ended in `processed/`.
 */

import { z } from "zod";
import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";

const DocCreateResultSchema = z.object({
  doc: z.object({ frontmatter: z.object({ id: z.string() }) }),
});

const ThreadCreateResultSchema = z.object({
  thread: z.object({ id: z.string() }),
  eventId: z.string(),
});

const NOTE_BODY = "A note about planning a small vegetable garden.\n";

const QUESTION = "What would be a better title for this note? Please answer here in this thread.";

async function seed(ctx: SeedContext) {
  const doc = await ctx.corpus([
    "doc",
    "create",
    "--type",
    "note",
    "--title",
    "Garden note",
    "-m",
    NOTE_BODY,
    "--json",
  ]);
  if (doc.code !== 0) {
    throw new Error(`seeding doc create failed (exit ${String(doc.code)}): ${doc.stderr}`);
  }
  const docId = DocCreateResultSchema.parse(JSON.parse(doc.stdout)).doc.frontmatter.id;

  const thread = await ctx.corpus([
    "thread",
    "create",
    "--parent",
    docId,
    "--title",
    "A question about the title",
    "--requests-agent",
    "true",
    "-m",
    QUESTION,
    "--json",
  ]);
  if (thread.code !== 0) {
    throw new Error(`seeding thread create failed (exit ${String(thread.code)}): ${thread.stderr}`);
  }
  const parsed = ThreadCreateResultSchema.parse(JSON.parse(thread.stdout));
  return { refs: { docId, threadId: parsed.thread.id, eventId: parsed.eventId } };
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadId = record.seed.refs.threadId ?? "";
  const eventId = record.seed.refs.eventId ?? "";

  const thread = record.observation.threads.find(
    (candidate) => candidate.frontmatter?.id === threadId,
  );
  if (thread === undefined) {
    findings.push(`the seeded thread ${threadId} has no file under data/threads/`);
  } else {
    const replies = thread.turns.filter((turn) => turn.author === "agent");
    const userTurns = thread.turns.filter((turn) => turn.author === "user");
    if (replies.length !== 1) {
      findings.push(
        `expected exactly one agent reply turn on ${threadId}, found ${String(replies.length)}`,
      );
    }
    if (userTurns.length !== 1) {
      findings.push(
        `the seeded question should be the only user turn on ${threadId}, found ${String(userTurns.length)}`,
      );
    }
  }

  const processed = record.observation.queue.byStatus.processed.some(
    (event) => event.id === eventId,
  );
  if (!processed) {
    const elsewhere = Object.values(record.observation.queue.byStatus)
      .flat()
      .find((event) => event.id === eventId);
    findings.push(
      elsewhere === undefined
        ? `event ${eventId} is in no queue status directory`
        : `event ${eventId} ended ${elsewhere.status}, not processed`,
    );
  }
  return { kind: "invariant", findings };
}

export const oneQuestionOneAnswer: Scenario = {
  id: "03-one-question-one-answer",
  story: "I asked one question and got one answer.",
  regressionFor: null,
  grade: "invariant",
  runs: 3,
  // The agent parks `corpus queue idle` for its default 480 s window before it
  // settles, and the product has no knob to shorten it (CLI-075) — the budget
  // has to clear one full park plus the work around it.
  budgetMs: 15 * 60_000,
  seed,
  score,
};
