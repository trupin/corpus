// The one line the *server* writes about a weight, on the job's log
// (SPEC.md §7's console bullet, rider signed 2026-08-06; SERVER-069).
//
// ## What this is for, and why the server writes anything at all
//
// The dispatch lines are the orchestrator's — it is the thing that dispatches,
// and §7's bullet asks a dispatch to name the tier it went out at and where that
// tier came from (`stated by the request`, `judged, difficulty`,
// `judged, consequence`). The skill emits them, one per stage.
//
// But a log written *only* by the orchestrator can only be read as the
// orchestrator's own account: "the request stated Haiku, so I dispatched Haiku"
// is one party asserting both halves of §7's guarantee that a stated weight is
// **honoured, not weighed again**. There is nothing in the file to check it
// against, and "honoured" then means whatever the agent says it means.
//
// So the server writes down the one fact it actually holds — **what the request
// stated**, verbatim, at the moment it created the job — and writes it before
// any dispatch line can exist. A reader (or an evaluator with nothing but SPEC
// and the log) then has two independent records side by side and can tell an
// honoured request from an unhonoured one without believing either party:
//
// ```text
//   {"ts":"…","source":"server","line":"weight stated by the request: light"}
//   {"ts":"…","source":"cli","line":"claimed comment.created on th_4b8e2c"}
//   {"ts":"…","source":"cli","line":"dispatched to a comment-skill subagent (Haiku — stated by the request)"}
// ```
//
// ## The shape, and why it holds a *staged* job
//
// A job's record of weights is **the log's lines**, not a field: the log is
// append-only JSONL and every writer appends to the same file, so one job
// already carries as many weight-bearing lines as its run produced. That is what
// SHARED-023 needs — a job split into stages shows a dispatch line **per stage**,
// in order — and it needs nothing new here to get it. A field ("the weight this
// job ran at") would have held exactly one value and made the per-stage rule
// unobservable; this line does not compete with the dispatch lines, it precedes
// them.
//
// The server contributes **exactly one** line, because it has exactly one fact:
// what the request said. It never writes a dispatch line, because it does not
// dispatch, and it never writes "no weight stated" — silence is what stating no
// weight looks like everywhere else in this feature (§7: absence means the
// orchestrator decides), and a line announcing the ordinary case on every job
// would be noise in the one surface an operator watches live.
//
// ## Recording, never interpreting
//
// The value is copied out of the payload and into the line unchanged. Nothing
// here knows what a level *means*: §7 keeps model names in the orchestrate skill
// and §2.4 lets a workspace edit that document on its own schedule, so a server
// that checked the value against a list of known levels would reject a workspace
// for agreeing with its own guidance. Shape was checked at the request boundary
// (`RequestedWeightSchema` — non-blank, single line, bounded); there is nothing
// left to decide.

import { readRequestedWeight } from "@corpus/contract";
import type { Logger } from "../logger.js";
import type { StoredEvent } from "../queue/index.js";
import type { JobService } from "./service.js";

/**
 * How the line names what it is. Deliberately the same words the orchestrate
 * skill's dispatch grammar uses for the same provenance — `stated by the
 * request` — so the server's line and the agent's line read as one story rather
 * than two vocabularies for one fact.
 */
export const STATED_WEIGHT_PREFIX = "weight stated by the request: ";

/** The line as it lands in `.corpus/jobs/<eventId>.jsonl`. */
export function statedWeightLine(weight: string): string {
  return `${STATED_WEIGHT_PREFIX}${weight}`;
}

/**
 * What {@link createStatedWeightRecorder} produces: the seam `QueueService`
 * calls once per enqueue, having no opinion about job logs itself.
 */
export type StatedWeightRecorder = (event: StoredEvent) => Promise<void>;

export interface StatedWeightRecorderOptions {
  readonly jobs: JobService;
  readonly logger: Logger;
}

/**
 * Records the weight a newly enqueued event's request stated, on that event's
 * job log — and does nothing at all when it stated none.
 *
 * Reads the payload rather than the event type, because a weight belongs to no
 * particular type (`REQUESTED_WEIGHT_PAYLOAD_KEY` is event-type-agnostic by
 * design): an event type this recorder has never heard of carrying one is
 * logged by it without a line of change here or in the contract.
 *
 * **A log line may never cost the caller its event.** The event is on disk and
 * mirrored by the time this runs; a failed append is a missing line in a runtime
 * file that is reaped with the job, and turning it into a failed
 * `POST /api/threads` would trade the durable thing for the ephemeral one. So
 * the failure is logged for the operator and swallowed — the same trade
 * `JobService.appendLine` already makes when the file has hit its size cap.
 */
export function createStatedWeightRecorder(
  options: StatedWeightRecorderOptions,
): StatedWeightRecorder {
  return async (event: StoredEvent): Promise<void> => {
    const weight = readRequestedWeight(event.payload);
    if (weight === undefined) return;
    try {
      await options.jobs.appendLine(event.id, statedWeightLine(weight), "server");
    } catch (error) {
      options.logger.error("could not record the stated weight on a job log", {
        eventId: event.id,
        error: String(error),
      });
    }
  };
}
