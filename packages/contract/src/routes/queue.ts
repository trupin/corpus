import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { EventIdSchema } from "../schemas/id.js";
import {
  ClaimBatchSchema,
  ClaimScopeQuerySchema,
  DeferEventRequestSchema,
  FailEventRequestSchema,
  HaltQueueRequestSchema,
  IdleQuerySchema,
  IdleResultSchema,
  MAX_IDLE_TIMEOUT_SECONDS,
  QueueEventSchema,
  QueueStatusSchema,
  ReapStaleResultSchema,
} from "../schemas/queue.js";
import {
  CONFLICT_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  UNKNOWN_SCOPE_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

const EventIdParamSchema = z.object({
  id: openapi(EventIdSchema, { param: { name: "id", in: "path", required: true } }),
});

/**
 * Read on load by the console strip: SSE only announces invalidation, so the
 * halted dot, the queue depth and the agent pill need a plain fetch (SPEC.md
 * §2.2 rule 3).
 *
 * Since CONTRACT-045 it answers the pill's question directly instead of leaving
 * it to be guessed from the counts. That is why a `["queue"]` frame is owed on
 * a presence change as well as on a queue transition (`../query-keys.ts`): a
 * status the strip never refetches is a pill that never notices the agent left.
 */
export const getQueueStatus = createRoute({
  method: "get",
  path: "/api/queue/status",
  tags: ["queue"],
  summary: "Whether an agent is there, halted state, and per-status event counts",
  description:
    "What the console strip reads (SPEC.md §10): the counts describe the work, and `agent` " +
    "describes the worker. **`agent` is the roster's own liveness aggregated** — the same " +
    "observation `GET /api/agents` reports per lane, so the strip and the recipient picker " +
    "cannot disagree about whether anybody is listening — and it is here so that `idle` can be " +
    "a claim with evidence behind it rather than the else-branch of the counts. An empty queue " +
    "means nobody asked for anything; it has never meant somebody is waiting to be asked.",
  responses: {
    200: jsonContent(QueueStatusSchema, "Agent presence, current queue depth and halt state."),
    401: UNAUTHORIZED_RESPONSE,
  },
});

/**
 * The parking primitive behind `corpus queue idle` (CLAUDE.md Architecture
 * Decision 4). It replaces the spec's `fs.watch` with a long poll: same
 * zero-token parking, but it works against a server the agent may not share a
 * filesystem with.
 */
export const idleQueue = createRoute({
  method: "get",
  path: "/api/queue/idle",
  tags: ["queue"],
  summary: "Long-poll until work is available",
  description:
    "Returns `200` the instant pending work exists or arrives, and `204` with no body when the " +
    `window expires (default and maximum ${MAX_IDLE_TIMEOUT_SECONDS} s) so the skill loop re-invokes ` +
    "it. Both outcomes are normal; `204` is not an error. **Idle reports availability and never " +
    "claims** — follow a `200` with `POST /api/queue/claim-all`. While the queue is halted, idle " +
    "parks for the full window and never returns events (SPEC.md §7).\n\n" +
    "A `200` also carries `inProgress`: what the server still thinks the agent is doing. It is " +
    "reported here and on `claim-all` — the loop's two entry points — and nowhere else; the `204` " +
    "that ends an empty window has no body and therefore no list. See `claim-all` for the " +
    "reconciliation contract.\n\n" +
    "**Parking here is what presence *is*** (SPEC.md §7). A resident is live exactly while it " +
    "holds a parked scoped `idle` — there is no heartbeat to send and no registration to keep " +
    "fresh — so `scope` decides both which lane's work this call waits for and which lane " +
    "`GET /api/agents` reports as live. An agent that stops parking stops being present, and its " +
    "lane's pending work falls back to the orchestrator's unscoped claim once the grace window " +
    "has passed.\n\n" +
    "**Because parking is presence, a `scope` that names no lane is refused** with `422`, before " +
    "the park is admitted and therefore before it can be observed (SPEC.md §7). A thread id is a " +
    "thread id on the wire, so this is a refusal only the workspace can make: the value must name " +
    "a standalone thread that holds a resident. Omitting `scope` is always fine — it means the " +
    "orchestrator's lane — and a lane whose resident is released *while its listener is parked* " +
    "keeps that park to its end; what is refused is a value that was never a lane, not one that " +
    "has stopped being one. `claim-all` deliberately does not refuse it: draining a lapsed lane's " +
    "already-stamped events is the listener's job, and refusing there would strand them.",
  request: { query: IdleQuerySchema },
  responses: {
    200: jsonContent(IdleResultSchema, "Pending events exist; claim them next."),
    204: { description: "The window expired with nothing pending. Re-invoke to park again." },
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    422: UNKNOWN_SCOPE_RESPONSE,
  },
});

/**
 * The loop's entry point, and — since CONTRACT-033 — the place the agent finds
 * out what the server believes it is already doing.
 *
 * That second half answers a failure the queue had no path out of. An event gets
 * stranded in `in-progress/` two ways: the session died holding it (`reap-stale`
 * recovers that, by *requeueing* it), or the agent is alive, did the work, and
 * simply never called `complete`. The second is the common one, and for it the
 * agent is not merely *a* source of truth but the only one — the work happened
 * in its context. Nothing in the loop ever showed it the server's view, so the
 * discrepancy was invisible to the one party able to resolve it (SPEC.md §7,
 * SHARED-015).
 */
export const claimAll = createRoute({
  method: "post",
  path: "/api/queue/claim-all",
  tags: ["queue"],
  summary: "Atomically claim every pending event, and report what is already held",
  description:
    "Moves all `pending/*` events to `in-progress/` in one call and returns them as a batch; concurrent " +
    "claims never hand the same event to two callers. Returns an empty batch while halted (SPEC.md §7).\n\n" +
    "**The response also reports what the server still thinks the agent is doing**, as `inProgress` " +
    "— its own field, never mixed into `events`. The two answer different questions, and an agent " +
    "that confused them would either redo settled work or settle work it never did. Nothing in " +
    "`inProgress` was claimed by this call: those events were already in `in-progress/` when it " +
    "arrived.\n\n" +
    "**The loop is expected to reconcile it** (SPEC.md §7). An event whose work this agent has " +
    "already done is settled on the spot with the ordinary verbs; one it is genuinely still " +
    "working is left alone; and an event it **cannot account for is never settled** — closing an " +
    "unfamiliar event to tidy the list would silently kill a concurrent run's work. Reconciliation " +
    "is the agent's judgement and never an inference the server draws on its behalf: this endpoint " +
    "reports, and settles nothing by itself. `reap-stale` remains the recovery for the other case " +
    "— a session that died with its context — and stays a requeue.\n\n" +
    "**The list is capped, and says so.** Past the cap it reports the true `total` and sets " +
    "`truncated`; the complete set is `GET /api/jobs?status=in-progress`. A short list that looked " +
    "complete would defeat the whole field.\n\n" +
    "**A claim takes a lane** (SPEC.md §7). `scope` names it, and omitting it means the " +
    "orchestrator's — so a caller written before lanes existed keeps its meaning exactly. A " +
    "scoped claim sees only its own lane's events; the orchestrator's claim never sees a live " +
    "lane's events, and picks up a lapsed lane's pending work. Two agents claiming at once are " +
    "therefore reading disjoint sets rather than racing, and **one consumer per lane** still " +
    "holds: a second concurrent claim on one lane is refused exactly as a second claim on the " +
    "whole queue always was.",
  request: { query: ClaimScopeQuerySchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      ClaimBatchSchema,
      "The claimed events — empty while halted or when nothing is pending — beside the events the " +
        "server already holds `in-progress`.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const reapStale = createRoute({
  method: "post",
  path: "/api/queue/reap-stale",
  tags: ["queue"],
  summary: "Recover stuck in-progress events",
  description:
    "Moves events left in `in-progress/` by a crashed run back to `pending/`, so a dead agent session " +
    "cannot strand work (SPEC.md §7).",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(ReapStaleResultSchema, "The events returned to `pending/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const haltQueue = createRoute({
  method: "post",
  path: "/api/queue/halt",
  tags: ["queue"],
  summary: "Halt the queue",
  description:
    "Writes the `.corpus/HALT` sentinel. While halted, `claim-all` returns empty and `idle` parks for " +
    "its full window (SPEC.md §7). The console strip's HALT toggle and `corpus queue halt` both land " +
    "here. The body is optional in full: a bare `POST` halts, and a `reason`, when given, is recorded " +
    "in the sentinel beside the halt timestamp. Halting an already-halted queue is not an error — it " +
    "re-records the sentinel, so a second call may replace, add, or clear the reason: a bare re-halt " +
    "rewrites the sentinel without one.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description: "Optional halt annotation; omit the body entirely to halt without a reason.",
      content: { "application/json": { schema: HaltQueueRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(QueueStatusSchema, "The queue status, now halted."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const resumeQueue = createRoute({
  method: "post",
  path: "/api/queue/resume",
  tags: ["queue"],
  summary: "Resume the queue",
  description: "Removes the `.corpus/HALT` sentinel; parked `idle` calls become live again.",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(QueueStatusSchema, "The queue status, no longer halted."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const completeEvent = createRoute({
  method: "post",
  path: "/api/queue/{id}/complete",
  tags: ["queue"],
  summary: "Mark a claimed event processed",
  description:
    "Moves the event from `in-progress/` to `processed/`: the agent reporting that the work it " +
    "claimed is done (SPEC.md §7).\n\n" +
    "`409` when the event is not `in-progress`: only claimed work can be completed, because " +
    "nobody settles work they did not claim — an event still `pending` was never worked on, and " +
    "one already in a terminal state was settled once already. A repeat is refused too, and says " +
    "`already`, so a duplicated call learns that the outcome it wanted is the one on record " +
    "rather than going to look for a fault. `404` when there is no such event.",
  request: { params: EventIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `processed/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});

export const failEvent = createRoute({
  method: "post",
  path: "/api/queue/{id}/fail",
  tags: ["queue"],
  summary: "Mark a claimed event failed",
  description:
    "Moves the event from `in-progress/` to `failed/`: the agent reporting that the work it " +
    "claimed could not be done (SPEC.md §7). `failed/` is the recoverable half of giving up — " +
    "`POST /api/jobs/{id}/retry` picks it up again, where `abandoned/` is the end.\n\n" +
    "`409` when the event is not `in-progress`: only claimed work can be failed, because nobody " +
    "settles work they did not claim — an event still `pending` was never worked on, and one " +
    "already in a terminal state was settled once already. A repeat is refused too, and says " +
    "`already`, so a duplicated call learns that the outcome it wanted is the one on record " +
    "rather than going to look for a fault. It is also what stops a second `fail` quietly " +
    "discarding the `reason` it carried, since the first one's annotation was never going to be " +
    "overwritten. `404` when there is no such event.",
  request: {
    params: EventIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description: "Optional failure annotation; omit the body entirely to fail without a reason.",
      content: { "application/json": { schema: FailEventRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `failed/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});

/**
 * The defer/requeue transition SPEC.md §7 names as the successor to the
 * `deferred:`-prefixed failure (CONTRACT-021; SERVER-030 implements it).
 *
 * It is a queue verb because what changes is the *event's* state and nothing
 * else — the document is untouched, and the caller has taken nothing on it: an
 * agent that defers has read the document, seen a person editing it, and decided
 * to come back. The reverse transition has no route at all, deliberately:
 * re-entry is the server's own reaction to that edit session ending, not
 * something a client asks for. `POST /api/jobs/{id}/retry` remains the manual
 * override for a deferral automatic re-entry never reached.
 */
export const deferEvent = createRoute({
  method: "post",
  path: "/api/queue/{id}/defer",
  tags: ["queue"],
  summary: "Defer a claimed event while a person is editing that document",
  description:
    "Moves a claimed event to `deferred/` — waiting, not failed (SPEC.md §7). The agent calls it " +
    "when the work it claimed needs a document a **person** has an edit session open on " +
    "(`userEditing` on the document read): it replies to the waiting thread, defers the event, " +
    "and moves on. **A judgement, not a refusal** — nothing stopped it writing; the key would " +
    "have let the write through. It deferred because it saw.\n\n" +
    "**The event comes back on its own.** The end of that edit session on `blockedOn` returns it " +
    "to `pending`, and `corpus queue idle` unparks — no retry call, no operator. Until then it is " +
    "not claimable: `claim-all` skips deferred events, because handing back work while the person " +
    "is still typing would put the agent straight back where it decided not to be.\n\n" +
    "**Nothing is ever silently dropped** (SPEC.md §7). A deferral whose document is never put " +
    "down stays on disk, stays visible in the queue counts and the console, survives a restart, " +
    "and stays retryable by hand through `POST /api/jobs/{id}/retry`.\n\n" +
    "`409` when the event is not `in-progress`: only claimed work can be deferred, since nothing " +
    "else has looked at the document yet, exactly as only a finished job can be retried. `404` " +
    "when there is no such event.",
  request: {
    params: EventIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The document being waited on, and optionally why. A deferral that named no document " +
        "could never re-enter, so the body is mandatory.",
      content: { "application/json": { schema: DeferEventRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `deferred/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});

export const abandonEvent = createRoute({
  method: "delete",
  path: "/api/queue/{id}",
  tags: ["queue"],
  summary: "Abandon an event",
  description:
    "Moves the event to `abandoned/` — the give-up terminal state, distinct from `failed/` which a " +
    "retry can pick up again (SPEC.md §7). The event file is kept; nothing is deleted.\n\n" +
    "`409` when the event is `processed` or already `abandoned`: only outstanding work can be " +
    "abandoned, because there is nothing left to give up on once it is done, and " +
    "`processed/` → `abandoned/` would rewrite the history the kept file exists to be. This is " +
    "the one settle that is **not** restricted to claimed work — abandoning is the operator's " +
    "give-up rather than the agent's report, so `pending`, `in-progress`, `deferred` and " +
    "`failed` events may all be abandoned, which is what lets the console offer it beside " +
    "`retry` on a failed job. A repeat says `already`. `404` when there is no such event.",
  request: { params: EventIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `abandoned/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});
