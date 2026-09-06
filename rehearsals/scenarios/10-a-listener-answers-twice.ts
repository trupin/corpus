/**
 * Story 10 — *"I asked again, and the same listener answered."* (INFRA-039)
 *
 * Regression for: the defect reported 2026-09-05 — a listener answers one
 * message and stops, so every later message on its lane is answered only after
 * the orchestrator notices a dead lane and launches a second listener. The
 * conversation still gets its answers, which is exactly why nobody saw it: the
 * symptom was slow replies, not missing ones. CLI-078 and AGENT-065 are the two
 * halves of the fix, both prose, so this scenario is their only measurement.
 *
 * Seed: one standalone Ask through the CLI — a designated lane with one pending
 * question, the ordinary way a listener is launched with work already waiting.
 *
 * Second act (the harness's `followUp`, added for this scenario): once the
 * queue has read quiet for the driver's full quiescence hold — the first
 * question settled, and the hold's worth of time for the listener to re-park —
 * the person posts a follow-up message on the same thread through the
 * composer's own `POST /api/threads/{id}/turns`, with `requestsAgent` omitted:
 * the thread is engaged, so the server enqueues `comment.created` on the lane,
 * exactly as a typed follow-up does. **The gap is derived from the settle, not
 * from a sleep**: it is "the first answer settled and stayed settled for the
 * hold", which is the earliest moment "the listener has answered once and gone
 * back to waiting" is true on the record, and it adds no fixed cost to the run.
 *
 * Scored as a judgment (k/N): the subject is whether a model keeps a promise
 * made in prose, which is stochastic, and the ratio is the measurement CLI-078
 * and AGENT-065 are judged on. A run passes only when the corpus records both:
 *
 * - **the second message was answered** — the thread's turns hold an agent
 *   reply after the second user turn, and the follow-up's event settled
 *   `processed`;
 * - **nobody was launched in between** — exactly one launch line on the lane's
 *   launch-prompting events (`resident.designated`, `lane.waiting`). The
 *   orchestrate skill requires every launch to be logged on the event that
 *   prompted it, naming the weight and its provenance (`stated`/`judged`), so
 *   a relaunch is a second such line. A lane with **no** recorded launch fails
 *   too: without the record, "same listener" cannot be established.
 *
 * An answer that arrived after a relaunch is a fail with its own label, and an
 * unanswered second message is a fail with another — the scorecard's
 * distribution keeps the failure shapes apart, which is what the baseline
 * measurement needs.
 */

import type { RunRecord, Scenario, ScenarioRunScore, Seed, SeedContext } from "../scenario.js";
import {
  ComposerTurnResponseSchema,
  corpusJson,
  eventsOfType,
  eventStatus,
  jobLogLines,
  threadById,
  ThreadCreateResultSchema,
  turnsBy,
} from "./support.js";

const FIRST_QUESTION =
  "Which herbs grow well together in one planter box? Please answer here in this thread.";

const SECOND_QUESTION =
  "Thanks. And which of those herbs should be kept out of full afternoon sun? " +
  "Please answer here in this thread.";

async function seed(ctx: SeedContext) {
  const thread = await corpusJson(
    ctx,
    [
      "thread",
      "create",
      "--title",
      "Herb planter",
      "--requests-agent",
      "true",
      "-m",
      FIRST_QUESTION,
    ],
    ThreadCreateResultSchema,
  );
  if (thread.eventId === null) {
    throw new Error("the standalone Ask enqueued nothing — requestsAgent was not honoured");
  }
  return { refs: { threadId: thread.thread.id, firstEventId: thread.eventId } };
}

async function followUp(ctx: SeedContext, current: Seed): Promise<Seed> {
  const threadId = current.refs.threadId;
  if (threadId === undefined) throw new Error("the seed recorded no threadId to follow up on");
  // The composer's request is the person's path for a typed message
  // (`x-corpus-author` defaults to `user`). `requestsAgent` is omitted on
  // purpose: the thread is engaged, so omission enqueues — a person's ordinary
  // follow-up, not a specially marked one.
  const response = await ctx.composer(`/api/threads/${threadId}/turns`, {
    body: SECOND_QUESTION,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `follow-up POST /api/threads/${threadId}/turns answered ${String(response.status)}`,
    );
  }
  const parsed = ComposerTurnResponseSchema.parse(response.json);
  if (parsed.eventId === null) {
    throw new Error(
      "the follow-up enqueued nothing — the engaged thread did not request the agent",
    );
  }
  return { refs: { secondEventId: parsed.eventId } };
}

function score(record: RunRecord): ScenarioRunScore {
  const threadId = record.seed.refs.threadId ?? "";
  const secondEventId = record.seed.refs.secondEventId;

  // The follow-up never fired: the runner ended (queue drained) before the
  // settled-and-held gap completed, so nothing was listening to measure.
  if (secondEventId === undefined) {
    return {
      kind: "judgment",
      pass: false,
      label: "no second message — the runner ended before the gap",
    };
  }

  // Every launch the skill records for this lane, on the events that prompt
  // launches. One line is the seeded listener; a second is a relaunch.
  const launchEventIds = [
    ...eventsOfType(record, "resident.designated", threadId).map((event) => event.id),
    ...eventsOfType(record, "lane.waiting", threadId).map((event) => event.id),
  ];
  const launches = launchEventIds
    .flatMap((eventId) => jobLogLines(record, eventId))
    .filter((entry) => entry.line.includes("judged") || entry.line.includes("stated")).length;

  const thread = threadById(record, threadId);
  const turns = thread?.turns ?? [];
  const lastUserIndex = turns.reduce(
    (last, turn, index) => (turn.author === "user" ? index : last),
    -1,
  );
  const answeredAfterSecond =
    thread !== undefined &&
    turnsBy(thread, "user").length === 2 &&
    turns.some((turn, index) => turn.author === "agent" && index > lastUserIndex);
  const secondSettled = eventStatus(record, secondEventId) === "processed";
  const answered = answeredAfterSecond && secondSettled;

  if (!answered) {
    return { kind: "judgment", pass: false, label: "second message unanswered" };
  }
  if (launches === 0) {
    return { kind: "judgment", pass: false, label: "second answered · no launch recorded" };
  }
  if (launches > 1) {
    return {
      kind: "judgment",
      pass: false,
      label: `second answered after a relaunch · ${String(launches)} launches`,
    };
  }
  return { kind: "judgment", pass: true, label: "second answered live · 1 launch" };
}

export const aListenerAnswersTwice: Scenario = {
  id: "10-a-listener-answers-twice",
  story: "I asked again, and the same listener answered.",
  regressionFor: "CLI-078",
  grade: "judgment",
  runs: 5,
  threshold: 5,
  // Two full answer cycles plus, on the failure path, a park window before the
  // relaunch machinery can notice the dead lane — 15 minutes was scenario 03's
  // single cycle, and the second act needs its own headroom.
  budgetMs: 25 * 60_000,
  seed,
  followUp,
  score,
};
