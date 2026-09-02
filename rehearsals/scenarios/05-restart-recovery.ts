/**
 * Story 5 — *"My agent restarted and my conversations still get answered."*
 * (INFRA-034 table)
 *
 * Regression for: AGENT-054 — designations live on their threads and survive a
 * restart; listeners are processes and do not. After a restart every designated
 * lane has no listener, and a listener that does start finds work already
 * waiting — which rider A (signed 2026-08-25) made the *ordinary* way one ever
 * starts. The old skill treated a backlog as an anomaly.
 *
 * Seed, all through the CLI:
 * - lane A: a standalone Ask — designation and one pending question together;
 * - lane B: a standalone note-only thread (its designation is silent), then
 *   `corpus thread designate` — the person's own verb for "start my listener
 *   again", which announces with nothing pending.
 *
 * The runner then starts cold, exactly as a restarted agent does: two
 * designations on threads, no listener anywhere, one pending message.
 *
 * Asserts (invariant, on what the corpus records):
 * - every announcement (`resident.designated` × 2, A's `lane.waiting`) settles
 *   `processed` on the first pass — nothing waits for a second designation;
 * - both lanes' launches are recorded (`defaulted`, AGENT-059);
 * - the pending question is answered: exactly one agent reply on lane A;
 * - lane B gains no turns at all — a listener with nothing to answer posts
 *   nothing, and never an apology or a status line into somebody's thread.
 */

import { z } from "zod";
import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";
import {
  corpusJson,
  eventsOfType,
  expectProcessed,
  launchProvenanceLogged,
  threadById,
  ThreadCreateResultSchema,
  turnsBy,
} from "./support.js";

const QUESTION =
  "What is a reasonable first-year budget for a 10 square metre allotment? " +
  "Please answer here in this thread.";

const NOTE_ONLY = "Keeping this thread as a running log of seed suppliers. Nothing to do yet.";

/** The designate verb's answer matters only by succeeding; nothing is read off it. */
const DesignateResultSchema = z.looseObject({});

async function seed(ctx: SeedContext) {
  const threadA = await corpusJson(
    ctx,
    ["thread", "create", "--title", "Allotment budget", "--requests-agent", "true", "-m", QUESTION],
    ThreadCreateResultSchema,
  );
  if (threadA.eventId === null) {
    throw new Error("the standalone Ask enqueued nothing — requestsAgent was not honoured");
  }
  const threadB = await corpusJson(
    ctx,
    ["thread", "create", "--title", "Seed suppliers", "--requests-agent", "false", "-m", NOTE_ONLY],
    ThreadCreateResultSchema,
  );
  // The person asks for lane B's listener the only way a person can: by
  // designating again. The verb answers with the thread; the announcement's
  // event id is not in any response, so the scorer finds it by type.
  await corpusJson(ctx, ["thread", "designate", threadB.thread.id], DesignateResultSchema);
  return {
    refs: {
      threadIdA: threadA.thread.id,
      commentEventIdA: threadA.eventId,
      threadIdB: threadB.thread.id,
    },
  };
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadIdA = record.seed.refs.threadIdA ?? "";
  const threadIdB = record.seed.refs.threadIdB ?? "";
  const commentEventIdA = record.seed.refs.commentEventIdA ?? "";

  for (const threadId of [threadIdA, threadIdB]) {
    const designated = eventsOfType(record, "resident.designated", threadId);
    if (designated.length === 0) {
      findings.push(`no resident.designated event exists for ${threadId}`);
    }
    for (const event of designated) {
      const settled = expectProcessed(record, event.id, `the designation for ${threadId}`);
      if (settled !== null) findings.push(settled);
    }
    const noticeIds = eventsOfType(record, "lane.waiting", threadId).map((event) => event.id);
    for (const noticeId of noticeIds) {
      const settled = expectProcessed(record, noticeId, `the waiting notice for ${threadId}`);
      if (settled !== null) findings.push(settled);
    }
    const launchEventIds = [...designated.map((event) => event.id), ...noticeIds];
    if (!launchProvenanceLogged(record, launchEventIds, "defaulted")) {
      findings.push(`no launch was recorded for ${threadId} (no \`defaulted\` on its logs)`);
    }
  }

  const settledComment = expectProcessed(record, commentEventIdA, "the pending question");
  if (settledComment !== null) findings.push(settledComment);

  const threadA = threadById(record, threadIdA);
  if (threadA === undefined) {
    findings.push(`the seeded thread ${threadIdA} has no file under data/threads/`);
  } else if (turnsBy(threadA, "agent").length !== 1) {
    findings.push(
      `expected exactly one agent reply on ${threadIdA}, found ${String(turnsBy(threadA, "agent").length)}`,
    );
  }

  const threadB = threadById(record, threadIdB);
  if (threadB === undefined) {
    findings.push(`the seeded thread ${threadIdB} has no file under data/threads/`);
  } else {
    if (turnsBy(threadB, "agent").length !== 0) {
      findings.push(
        `lane B had nothing pending and still gained ${String(turnsBy(threadB, "agent").length)} agent turn(s)`,
      );
    }
    if (turnsBy(threadB, "user").length !== 1) {
      findings.push(
        `the seeded note should be the only user turn on ${threadIdB}, found ${String(turnsBy(threadB, "user").length)}`,
      );
    }
  }
  return { kind: "invariant", findings };
}

export const restartRecovery: Scenario = {
  id: "05-restart-recovery",
  story: "My agent restarted and my conversations still get answered.",
  regressionFor: "AGENT-054",
  grade: "invariant",
  runs: 3,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
