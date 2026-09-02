/**
 * Story 8 — *"I asked for a weight this workspace does not have."*
 * (INFRA-034 table)
 *
 * Regression for: SPEC.md §7, untested. A stated weight that **cannot be
 * honoured** — here a level the workspace's table does not declare — must not
 * drop the work: it is done at what the orchestrator judges best, and the
 * deviation is *"stated twice"*, in the job's log while it runs and in the
 * reply the request receives. Both are prose obligations on an agent, so only
 * this suite can check them. AGENT-059's provenance and SERVER-069's server
 * line are the records this reads.
 *
 * Seed: one composer comment on a note, stating `weight: "colossal"` — a level
 * the shipped guidance never declares. The composer path is the product's
 * only one for a stated message weight (SHARED-022 Q5 keeps it off the CLI).
 *
 * Asserts (invariant, on what the corpus records — the fact, not the sentence,
 * per rule 4's named exception for this story):
 * - the work is done: the event settled `processed` and got exactly one reply;
 * - the log names what was asked: the server writes `weight stated by the
 *   request: colossal` onto the event's job log (SERVER-069), verbatim and
 *   before any dispatch line — an independent record of the ask;
 * - the reply names the unmeetable weight: the token `colossal` appears in the
 *   stored thread, and it can only have got there in the agent's reply, since
 *   the weight rode a request field and never the body.
 */

import type { RunRecord, Scenario, ScenarioRunScore, SeedContext } from "../scenario.js";
import {
  ComposerThreadResponseSchema,
  expectProcessed,
  jobLogLines,
  seedNote,
  readServedWeightTable,
  threadById,
  turnsBy,
} from "./support.js";

const UNMEETABLE_WEIGHT = "colossal";

const QUESTION =
  "Could you suggest a better one-line title for this note? Please answer here in this thread.";

async function seed(ctx: SeedContext) {
  const noteId = await seedNote(
    ctx,
    "Untitled thoughts",
    "Some scattered notes about starting a reading habit.\n",
  );
  const response = await ctx.composer("/api/threads", {
    parent: noteId,
    title: "A better title?",
    body: QUESTION,
    requestsAgent: true,
    weight: UNMEETABLE_WEIGHT,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`seeding POST /api/threads answered ${String(response.status)}`);
  }
  const parsed = ComposerThreadResponseSchema.parse(response.json);
  if (parsed.eventId === null) {
    throw new Error("the weighted comment enqueued nothing — requestsAgent was not honoured");
  }
  // The declared levels travel with the seed so the scorer can ask what ran
  // instead without re-reading the workspace, and without hardcoding a name.
  const table = await readServedWeightTable(ctx);
  return {
    refs: {
      threadId: parsed.thread.id,
      commentEventId: parsed.eventId,
      declaredKeys: table.rows.map((row) => row.key).join(","),
    },
  };
}

function score(record: RunRecord): ScenarioRunScore {
  const findings: string[] = [];
  const threadId = record.seed.refs.threadId ?? "";
  const commentEventId = record.seed.refs.commentEventId ?? "";

  const settled = expectProcessed(record, commentEventId, "the weighted comment's event");
  if (settled !== null) findings.push(settled);

  // The server's independent record of what the request asked.
  const serverStated = jobLogLines(record, commentEventId).some(
    (entry) => entry.source === "server" && entry.line.includes(UNMEETABLE_WEIGHT),
  );
  if (!serverStated) {
    findings.push(
      `no server line on ${commentEventId}'s job log records the stated weight "${UNMEETABLE_WEIGHT}"`,
    );
  }

  // …and what ran instead, which §7 requires the deviation to name alongside
  // what was asked and that it could not be met. Checking only that `colossal`
  // appears proves the first two thirds of the promise (pr-reviewer, PR #71).
  // The substitute is a recorded fact, not prose: the dispatch line names the
  // level the work actually went out at, and it must be one the table declares.
  const declared = record.seed.refs.declaredKeys?.split(",").filter((key) => key !== "") ?? [];
  const namesSubstitute = jobLogLines(record, commentEventId).some((entry) =>
    declared.some((key) => entry.line.includes(key)),
  );
  if (declared.length === 0) {
    findings.push("the seed recorded no declared weight keys — cannot check what ran instead");
  } else if (!namesSubstitute) {
    findings.push(
      `no line on ${commentEventId}'s job log names what ran instead — none of the declared levels (${declared.join(", ")}) appears`,
    );
  }

  const thread = threadById(record, threadId);
  if (thread === undefined) {
    findings.push(`the seeded thread ${threadId} has no file under data/threads/`);
  } else {
    if (turnsBy(thread, "agent").length !== 1) {
      findings.push(
        `expected exactly one agent reply on ${threadId}, found ${String(turnsBy(thread, "agent").length)}`,
      );
    }
    // The weight rode a request field, never the body, so the only way its
    // token reaches the stored thread is the reply naming it.
    if (!thread.raw.includes(UNMEETABLE_WEIGHT)) {
      findings.push(
        `the reply on ${threadId} does not name the unmeetable weight "${UNMEETABLE_WEIGHT}"`,
      );
    }
  }
  return { kind: "invariant", findings };
}

export const unmeetableWeight: Scenario = {
  id: "08-unmeetable-weight",
  story: "I asked for a weight this workspace does not have.",
  regressionFor: "SPEC.md §7",
  grade: "invariant",
  runs: 3,
  budgetMs: 15 * 60_000,
  seed,
  score,
};
