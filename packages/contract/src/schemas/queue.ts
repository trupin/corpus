import { z } from "@hono/zod-openapi";
import { type AgentPresence, AgentPresenceSchema } from "./agents.js";
import { DocumentIdSchema, EventIdSchema } from "./id.js";
import { laneScopeParam } from "./lane.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * Event types the product itself handles (SPEC.md §7). The wire type stays an
 * open string because plugins define their own event types; consumers that only
 * handle core types narrow with {@link CoreQueueEventTypeSchema}.
 *
 * The set is exactly §7's "Core event types" sentence, and the order here is
 * **by producer, with the one type nothing produces last** rather than §7's
 * listing order:
 *
 * - `comment.created` — a turn that requests the agent (§8).
 * - `form.respond` — a form answer (§6); payload shape in `./form.ts`.
 * - `doc.edited` — a user edit session that ended (§4's edit-acknowledgment
 *   rider); payload and dedupe rule in `./edit.ts`.
 * - `resident.designated` — a standalone thread was given a resident (§7, rider
 *   SHARED-043). It lands on the **orchestrator's** lane whoever is designated,
 *   since a resident does not announce itself to itself; that carve-out is one
 *   of exactly two §7 names, the other being a message that stated a recipient.
 *   Payload shape in `./agents.ts` (`ResidentDesignatedPayloadSchema`).
 * - `resident.released` — a thread's resident was released (CONTRACT-069, the
 *   wire half of SERVER-128): by a person, by the thread resolving (§7), or by a
 *   new designation displacing it. It lands on the **orchestrator's** lane for
 *   the same reason and under the same carve-out as `resident.designated` — a
 *   released resident does not announce its own end to itself, and the
 *   orchestrator is what has to learn that a lane returned to it. A **lapse is
 *   not a release** and never produces one: §7's fallback is computed at claim
 *   time and writes nothing. Payload shape in `./agents.ts`
 *   (`ResidentReleasedPayloadSchema`).
 * - `agent.done` — background subagent wake-back, which §7 marks **reserved**:
 *   nothing produces it, and an arriving one is settled like a report. It is
 *   last because of that, not because it is newest.
 *
 * **`doc.edited` is a core type rather than a plugin one** because the core loop
 * owns both ends of it: the server emits it, and the shipped orchestrate skill
 * handles it. `resident.designated` is core for the same reason — designation is
 * a first-class act of the product, visible in the queue, the job log and the
 * history exactly as a comment is, and §7 makes it ordinary queue vocabulary
 * rather than a side channel — and `resident.released` is core because it is
 * the other half of that same act: the orchestrator that launched a listener on
 * a designation is the thing that has to stop it on a release, and an end that
 * travelled on a side channel would be the one event in the lifecycle nobody
 * could see in the queue. The generated document publishes the whole set
 * wherever an event type appears.
 *
 * **§7's "Core event types" sentence does not yet name `resident.released`.**
 * It joins the inventory's pending amendments (`../routes/inventory.ts`) rather
 * than the undocumented: this package never edits SPEC.md, and the amendment is
 * the orchestrator's to take to the user.
 */
export const CORE_QUEUE_EVENT_TYPES = [
  "comment.created",
  "form.respond",
  "doc.edited",
  "resident.designated",
  "resident.released",
  "agent.done",
] as const;

export const CoreQueueEventTypeSchema = z.enum(CORE_QUEUE_EVENT_TYPES);

/**
 * The status set SPEC.md §7 pins — `pending → in-progress → processed | failed`,
 * plus `abandoned` — and the one state §7 names as its own successor.
 *
 * **`deferred` is the queue state §7 names** (CONTRACT-021, the wire half of
 * SERVER-030). What it waits on was **re-based, not removed**, when the edit
 * lock was replaced by a key (SHARED-041, signed 2026-08-11): §7 now defines it
 * as "claimed work the agent parked because a person was editing the document
 * (§7 keys), returned to `pending` automatically when that session ends". The
 * shape is unchanged and so is every property below — what changed is only the
 * trigger, from a refusal to a judgement:
 *
 * - **Non-terminal, and not `pending`.** A deferred event is waiting on a person
 *   who is editing, so it is neither finished nor claimable — `claim-all` must
 *   not hand it out, or the agent comes straight back to a document somebody is
 *   still typing in.
 * - **Not a failure.** The distinction is the point: today a deferral renders
 *   in the console as a broken job, and §7 asks for *waiting*. Nothing refused
 *   the work — the agent saw a session open and chose to come back.
 * - **It leaves on its own.** The end of that edit session returns the event to
 *   `pending`. Which document it waits on is supplied at defer time
 *   (`DeferEventRequest.blockedOn`), because the event payload does not always
 *   carry it: `comment.created` has `parentId`, `form.respond` has no document
 *   at all.
 *
 * Ordered as the lifecycle runs, non-terminal states first: the constant is
 * what the server iterates to create `.corpus/queue/<status>/` and to count
 * queue depth, so the order is read by humans in more places than this file.
 */
export const QUEUE_EVENT_STATUSES = [
  "pending",
  "in-progress",
  "deferred",
  "processed",
  "failed",
  "abandoned",
] as const;

export const QueueEventStatusSchema = z.enum(QUEUE_EVENT_STATUSES).openapi({
  description:
    "Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in. " +
    "`pending` and `in-progress` are the live states; `processed`, `failed` and `abandoned` are " +
    "terminal. **`deferred` is neither** (SPEC.md §7): the event was claimed and the agent " +
    "parked it because a person had an edit session open on the document it needs, so it waits — " +
    "not claimable, not failed — and returns to `pending` automatically when that session ends. " +
    "Nothing refused it: the agent deferred because it saw, not because it was blocked.",
});

/**
 * One event file in `.corpus/queue/<status>/<id>.json`, written and moved only
 * by the server.
 *
 * **There is no `lane` field, and that is deliberate** (CONTRACT-051; SPEC.md §7
 * as amended by SHARED-043). Every event *is* stamped with a lane when it is
 * enqueued, but the stamp is server-side bookkeeping of the same class as the
 * event's status and its attempt count: it decides who the event is handed to,
 * and by the time a consumer holds one it has already been handed to them.
 * Publishing it would put a routing decision in the hands of the party the
 * routing was *for*, and the honest answer to "which lane is this?" is "the one
 * you asked for" — the `scope` you claimed with. The lane is reachable where it
 * is actually a question: `GET /api/agents` lists the lanes, and the scoped
 * queue verbs consume one.
 */
export const QueueEventSchema = z
  .object({
    id: EventIdSchema,
    type: z
      .string()
      .min(1)
      .describe(
        `Event type. Core values: ${CORE_QUEUE_EVENT_TYPES.join(", ")}. Plugins define their own.`,
      ),
    created: IsoDateTimeSchema,
    source: z.string().min(1).describe("What produced the event, e.g. `ui` or `cli`."),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        "Type-specific payload; plugins own the shape of their own event types, which is why this " +
          "stays open rather than becoming a union keyed on `type` (SPEC.md §7). The core payloads " +
          "are declared beside their features: `form.respond` carries " +
          "`{threadId, formTs, answers, note}`, where `answers` holds one entry per field of the " +
          "answered form (SPEC.md §6, §7); `doc.edited` carries `{docId, sessionId, actor, " +
          "endedBy, from, to, stats}` (SPEC.md §4); `resident.designated` carries " +
          "`{threadId, resident}` and `resident.released` carries `{threadId, resident, reason}` " +
          "(SPEC.md §7) — one release produces exactly one such event, and a lapse produces " +
          "none.\n\n" +
          "**One key crosses every type: `weight`.** When the request that enqueued the event " +
          "stated the weight its work should be done at (SPEC.md §7, §10), that level name rides " +
          "here verbatim, and the dispatch honours it rather than weighing the work again. It is " +
          "**absent** when the request stated nothing, which means the orchestrator decides — never " +
          "a default level, and never `null`. It is deliberately not part of any one payload " +
          "shape: a weight is a property of *a request that asked for work*, so a plugin's own " +
          "event type carries it the same way with no contract change.",
      ),
  })
  .openapi("QueueEvent");

/**
 * How many held events a single claim reports before it starts saying "and N
 * more" (CONTRACT-033, the rider's resolved Q2).
 *
 * Small on purpose. This list is read on **every** claim, and its job is to make
 * a discrepancy *noticeable* — not to be an inventory. A healthy loop holds a
 * handful; past twenty rows the actionable fact is "many, and here is the
 * total", and the complete inventory is one documented route away
 * (`GET /api/jobs?status=in-progress`), so the cap never puts anything out of
 * reach.
 */
export const MAX_IN_PROGRESS_REPORTED = 20;

/**
 * One event the server currently holds `in-progress` — reported to the agent
 * that is claiming work, so it can reconcile the server's view against its own
 * (SPEC.md §7, "The agent can see what the server still thinks it is doing").
 *
 * **`heldSince` is an instant, not an elapsed duration**, and that choice is the
 * one worth writing down:
 *
 * - An instant stays true. A duration is computed against the server's clock at
 *   serialisation time and is stale the moment the response is read — and this
 *   response is read by an agent that may sit on it for a whole turn.
 * - It survives clock skew *visibly*. The caller subtracts against whichever
 *   clock it trusts and can see the two disagree; a pre-computed duration hides
 *   which clock produced it, so a skewed server silently reports a plausible
 *   wrong number.
 * - It is the unit the rest of this wire already speaks. `created`, `started`
 *   and `updated` are all ISO instants; a duration would be the only
 *   unit-bearing number in the queue surface, and would have to carry its unit
 *   in its name to be readable at all.
 * - Readability is a presentation concern. "held 3h" is what `corpus queue
 *   claim-all` prints (CLI-029), computed one layer up, where the rendering
 *   rules already live.
 *
 * The origin fields are deliberately `Job`'s (`./job.ts`), spelling and
 * derivation both: same names, same nullability, same rule — the first of
 * `threadId`, `parentId`, `docId` in the payload that names a document the
 * corpus still holds, with the title read at response time rather than stored,
 * so a renamed document shows its new title on the next read. Saying where an
 * event came from twice, two different ways, would make the console row and the
 * reconciliation row disagree for no reason.
 */
export const InProgressEventSchema = z
  .object({
    id: EventIdSchema,
    type: z
      .string()
      .min(1)
      .describe(
        "The held event's type — the same open string `QueueEvent.type` and `Job.type` carry, for " +
          `the same reason: plugins define their own. Core values: ${CORE_QUEUE_EVENT_TYPES.join(", ")}. ` +
          "It is half of what makes the row checkable: an agent recognises *what kind of work* it " +
          "is being told it still owes.",
      ),
    heldSince: IsoDateTimeSchema.describe(
      "**When the event was claimed**, as an instant — not how long ago that was. An instant is " +
        "still true after the agent has sat on this response for a turn, and it lets the caller " +
        "compute the age against whichever clock it trusts instead of inheriting the server's. " +
        "Rendering it as `held 3h` is the CLI's job (SPEC.md §7).",
    ),
    originId: DocumentIdSchema.nullable().describe(
      "Document or thread the held event originated from, or null — **the same field `Job.originId` " +
        "is, derived by the same rule**: the first of `threadId`, `parentId`, `docId` in the event " +
        "payload that names a document the corpus still holds. `form.respond` names a thread; a " +
        "plugin event may name nothing, which is what null is for.",
    ),
    originTitle: z
      .string()
      .nullable()
      .describe(
        "**The current title of whatever `originId` names, or null** — null exactly when `originId` " +
          "is null, or when the document it names no longer exists. Read at response time rather " +
          "than stored, exactly as `Job.originTitle` is. This is the field that makes the row " +
          '*checkable* rather than merely present: "you are apparently still working on ' +
          '`comment.created` for **Re: the rate assumption**" is a sentence an agent can hold ' +
          "against its own memory, and a bare event id is not.",
      ),
  })
  .openapi("InProgressEvent");

/**
 * What the server is currently holding, reported alongside a claim
 * (CONTRACT-033; SPEC.md §7's reconciliation bullet, SHARED-015).
 *
 * **Bounded, and never silently so.** The cap is
 * {@link MAX_IN_PROGRESS_REPORTED}, published as `maxItems`, and the overflow
 * signal is the pairing `DocDiff` established (CONTRACT-032): a boolean that
 * says the cut happened and a number that says the real size. Both, rather than
 * either: `truncated` is what a caller branches on and must not have to derive,
 * `total` is the magnitude it reports. A short list that looks complete is the
 * failure mode this whole field exists to prevent — an agent that reads six rows
 * and settles all six would otherwise conclude it is square with the server.
 *
 * **Ordered most recently claimed first.** That ordering is load-bearing when the
 * cap bites: the rows an agent can actually account for are the ones it claimed
 * recently, and ancient residue — a session that died with its context — is
 * `reap-stale`'s problem, not reconciliation's. Oldest-first would let permanent
 * residue occupy the window forever and hide every fresh discrepancy behind it.
 *
 * **It reports and settles nothing.** SPEC.md §7 is explicit that reconciliation
 * is the agent's judgement and never an inference the server draws on its
 * behalf. Nothing here asks for an action; the agent settles what it recognises
 * with the ordinary verbs and leaves the rest alone.
 */
export const InProgressSetSchema = z
  .object({
    events: z
      .array(InProgressEventSchema)
      .max(MAX_IN_PROGRESS_REPORTED)
      .describe(
        `The held events, most recently claimed first, capped at ${MAX_IN_PROGRESS_REPORTED}. ` +
          "**Disjoint from the events just claimed** — an event cannot be in both, since a claim " +
          "moves it out of `pending/` and this list is read from `in-progress/` as it stood " +
          "beforehand. When the cap bites, the newest are kept: those are the ones this session " +
          "can still account for, and the ancient ones are `reap-stale`'s job.",
      ),
    total: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many events the server holds `in-progress` **in total**, equal to `events.length` " +
          'whenever `truncated` is false. It is the "and N more" the cap owes the caller: ' +
          `subtract the list's length to get it. For the complete set past ${MAX_IN_PROGRESS_REPORTED}, ` +
          "ask `GET /api/jobs?status=in-progress` — the cap bounds this report, never the caller's " +
          "reach.",
      ),
    truncated: z
      .boolean()
      .describe(
        "True when the cap cut the list — `total` is then greater than `events.length`. Stated " +
          "rather than left to be derived (the rule `DocDiff.truncated` sets): this is the flag " +
          "that stops a capped list from reading as a complete one, and a caller must not have to " +
          "compute the one fact that keeps it honest.",
      ),
  })
  .openapi("InProgressSet", {
    description:
      "What the server still thinks the agent is doing (SPEC.md §7) — reported beside a claim as " +
      "**its own field, never mixed into the claimed events**. The two answer different " +
      "questions, and an agent that confused them would either redo settled work or settle work " +
      "it never did. Nothing here was claimed by the call that returned it: these events were " +
      "already in `in-progress/` when it arrived. The loop reconciles: settle what you have " +
      "already done with the ordinary verbs, leave what you are still working, and never settle " +
      "an event you cannot account for. The server reports and settles nothing by itself.",
  });

/**
 * Result of an atomic batch claim: every `pending/*` event moved to
 * `in-progress/`, plus what the server was already holding.
 *
 * **`inProgress` is a sibling of `events`, never merged into it** (SPEC.md §7,
 * SHARED-015). The two answer different questions — "work I just claimed" and
 * "work you apparently think I already had" — and an agent that confused them
 * would either redo settled work or settle work it never did. One array with a
 * discriminating flag would have made that confusion a one-character mistake;
 * two fields make it impossible.
 *
 * It is **required**, not optional. An absent field is indistinguishable from an
 * empty one, which is precisely the silent-incompleteness failure the cap's
 * overflow signal exists to prevent; nothing held is `{events: [], total: 0,
 * truncated: false}`.
 */
export const ClaimBatchSchema = z
  .object({
    events: z.array(QueueEventSchema),
    // Referenced unmodified, deliberately: `.describe()` on a registered schema
    // makes zod-to-openapi carry the component's name onto the derived one and
    // rewrite the shared definition. The prose lives on the component itself.
    inProgress: InProgressSetSchema,
  })
  .openapi("ClaimBatch");

/**
 * Long-poll window (CLAUDE.md Architecture Decision 4). The default matches the
 * agent skill's ~8 minute rearm, and the same value bounds the ask: a longer
 * timeout is rejected with a 400 validation error rather than silently clamped,
 * so a client cannot park past the window the loop is built around (SPEC.md §7).
 */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 480;
export const MAX_IDLE_TIMEOUT_SECONDS = 480;

/**
 * How long a listener may be un-parked before it stops counting as present —
 * §7's **grace window**, fixed here because it is one number two processes have
 * to agree on.
 *
 * **Derived, never chosen.** §7 deliberately does not fix the length, but it
 * guarantees exactly one bound on it: *"the window is longer than a rearm gap"*.
 * The rearm gap is bounded by {@link MAX_IDLE_TIMEOUT_SECONDS} — a park cannot
 * outlive it, and the skill re-invokes immediately — so a window shorter than
 * the timeout would read an ordinary rearm as a departure, which is the failure
 * SHARED-033's rider names ("comfortably longer than the interval at which a
 * parked agent re-contacts the server"). Twice the timeout tolerates one wholly
 * missed rearm and calls two a departure. Writing it as a multiple rather than
 * as `960` is the point: change the loop's rearm and the window follows it, and
 * `queue.test.ts` pins the bound so it can never quietly stop following.
 *
 * **The multiplicand is the maximum, not the default** (CONTRACT-060). They are
 * the same number today, which is exactly why getting it wrong was invisible:
 * this read `DEFAULT_IDLE_TIMEOUT_SECONDS * 2` while the paragraph above — and
 * the server's docblock, and SERVER-112's own report — argued the max. The
 * default is only what a client gets when it asks for nothing; the max is what
 * bounds *every* park, including the longest one the server will admit
 * (`IdleQuerySchema` rejects more), and the CLI's segmenting loop parks for
 * `min(remaining, MAX_IDLE_TIMEOUT_SECONDS)` precisely so it never asks for
 * more. So the longest gap between two contacts from a healthy listener is a
 * max-length park, and a window built on the default would — the moment the two
 * diverged, which is the moment somebody raises the cap — call a listener gone
 * that was doing what the contract permits.
 *
 * The server applies it before answering `AgentPresence.live`; a client applies
 * the same number to the same instant only to *expire* a verdict it has held too
 * long ({@link isAgentPresent}). One window, one definition, two appliers — and
 * one derivation: `LANE_GRACE_MS` is this constant times 1000 and re-derives
 * nothing.
 */
export const AGENT_PRESENCE_WINDOW_SECONDS = MAX_IDLE_TIMEOUT_SECONDS * 2;

/**
 * Queue depth, halt state — and, since CONTRACT-045, **who is or is not there to
 * work it**.
 *
 * The counts describe the work; `agent` describes the worker, and until it
 * existed the console had to guess the second from the first. It guessed by
 * elimination — not halted and nothing in progress ⇒ `idle` — so a machine with
 * no agent at all reported an agent with nothing to do, which is precisely the
 * claim §10's rider now says requires evidence. The evidence is this field.
 *
 * It is **the roster's own verdict aggregated**, not a second notion of
 * liveness: `agent.live` is true exactly when some `AgentLane.live` is, and
 * `agent.since` is the most recent of theirs. Published here rather than left to
 * a second fetch because the strip already reads this resource on load and on
 * every `["queue"]` invalidation, and because presence and queue depth are read
 * together — depth matters most in exactly the state where nobody is listening.
 */
export const QueueStatusSchema = z
  .object({
    // Referenced unmodified, deliberately: `.describe()` on a registered schema
    // makes zod-to-openapi carry the component's name onto the derived one and
    // rewrite the shared definition (CONTRACT-037). The prose lives on the
    // component itself, as it does for `inProgress` above.
    agent: AgentPresenceSchema,
    halted: z
      .boolean()
      .describe("True while the `.corpus/HALT` sentinel exists; claims return empty."),
    pending: z.number().int().min(0),
    inProgress: z.number().int().min(0),
    deferred: z
      .number()
      .int()
      .min(0)
      .describe(
        "Events parked while a person is editing the document they need (SPEC.md §7). Counted " +
          "separately from `failed` " +
          "because a deferral is not a failure — a non-zero count here is work that will resume " +
          "by itself, and the console strip must not read it as breakage.",
      ),
    processed: z.number().int().min(0),
    failed: z.number().int().min(0),
    abandoned: z.number().int().min(0),
  })
  .openapi("QueueStatus");

/**
 * Is an agent there, as of `now`?
 *
 * **The server's verdict, which a caller may let expire but never overrule.**
 * `live` already has the grace window applied ({@link AGENT_PRESENCE_WINDOW_SECONDS}),
 * so this returns it unchanged in every case but one: a `live: true` whose
 * evidence is older than the window — a response the caller has been holding
 * since before the agent left, with no invalidation having arrived to correct
 * it. Applying the same window to the same instant can therefore only ever
 * *withdraw* a stale presence, never manufacture one the server denied, which is
 * what keeps this a second application of one rule rather than a second rule.
 *
 * It takes a clock so a UI can re-evaluate on a tick without refetching: §10
 * asks the pill to flip on its own when an agent walks away, and a pill that
 * only moved when new data arrived would sit on `idle` for as long as nothing
 * else happened — the original bug with extra steps. Clock skew costs nothing
 * either way: a fast local clock expires the verdict early and the next fetch
 * restores it, a slow one holds it a moment longer, and neither can invent
 * presence.
 *
 * Accepts a roster row as readily as `QueueStatus.agent` — an `AgentLane` is
 * structurally an {@link AgentPresence}, deliberately.
 */
export function isAgentPresent(presence: AgentPresence, now: Date = new Date()): boolean {
  if (!presence.live) return false;
  // Live with no instant behind it is a server bug, not a shape to interpret:
  // trust the verdict rather than inventing an absence the server did not report.
  if (presence.since === null) return true;
  const seen = Date.parse(presence.since);
  if (Number.isNaN(seen)) return true;
  return now.getTime() - seen <= AGENT_PRESENCE_WINDOW_SECONDS * 1000;
}

/**
 * The four states SPEC.md §10's agent pill names, in one place because two
 * consumers already read them — the console strip and any plugin reading queue
 * status — and a rule about honesty that each derives for itself is a rule that
 * holds in one of them.
 *
 * The precedence is the interesting part, and every step of it is §10's own
 * "reports what the server can actually observe":
 *
 * 1. **`halted`** outranks everything. While the sentinel is set nothing new is
 *    claimed, and an in-flight job finishing does not make the agent working
 *    again. (Unchanged: this is what the UI already did.)
 * 2. **`disconnected` outranks `working`** — the decision this function makes,
 *    and the one SHARED-033 listed as open. `inProgress > 0` is a fact about
 *    *events*, not about anybody holding them: an agent that claimed work and
 *    died leaves the count standing forever, and `working` about a corpse is the
 *    same unevidenced claim as `idle` about an empty machine, mirrored. §8's
 *    rider already refuses to call unclaimed work "working"; refusing to call
 *    abandoned work "working" is the same sentence read in the other direction.
 *    What recovers those events is `reap-stale`, and what tells a person to run
 *    it is seeing that nobody is there.
 * 3. **`working`** when an agent is present and holds work.
 * 4. **`idle`** last, and now a claim with evidence behind it rather than the
 *    else-branch it used to be: an agent is connected and has nothing to do.
 */
export type AgentActivity = "halted" | "disconnected" | "working" | "idle";

export function agentActivity(
  status: Pick<QueueStatus, "agent" | "halted" | "inProgress">,
  now: Date = new Date(),
): AgentActivity {
  if (status.halted) return "halted";
  if (!isAgentPresent(status.agent, now)) return "disconnected";
  return status.inProgress > 0 ? "working" : "idle";
}

/**
 * Events available to claim right now, returned by the long-poll idle endpoint.
 * Structurally identical to {@link ClaimBatchSchema} but a distinct resource:
 * idle *reports* availability and never claims (SPEC.md §7).
 *
 * It carries the in-progress set for the same reason `claim-all` does, and only
 * here: SHARED-015's resolved Q1 puts the list on the loop's entry points —
 * `claim-all`, and `idle` **when it returns work** — rather than on every queue
 * verb, where it would land on `complete` and read as a nag mid-settle. The
 * `204` that ends an empty window has no body and therefore no list, which is
 * deliberate: an agent with nothing to claim has nothing to reconcile against,
 * and the list arrives on the next `200` regardless.
 */
export const IdleResultSchema = z
  .object({
    events: z
      .array(QueueEventSchema)
      .min(1)
      .describe(
        "Pending events, still in `pending/`. Claim them with `POST /api/queue/claim-all`.",
      ),
    // Unmodified, for the reason `ClaimBatchSchema` gives.
    inProgress: InProgressSetSchema,
  })
  .openapi("IdleResult");

/**
 * The lane a claim consumes (SPEC.md §7), on `POST /api/queue/claim-all`.
 *
 * A **query parameter rather than a request body**, and that is the one choice
 * here worth stating: `claim-all` is a bodiless verb today, and giving it a body
 * to carry one optional field would make a bare `POST` — which is what every
 * caller sends and what the CLI will keep sending — a call whose body is omitted
 * rather than absent. `idle` spells the same thing as a query parameter because
 * it is a `GET`, and the two verbs are one instruction to the loop; spelling it
 * two different ways on the two of them is how they would come to disagree.
 */
export const ClaimScopeQuerySchema = z.object({ scope: laneScopeParam });

export const IdleQuerySchema = z.object({
  scope: laneScopeParam,
  timeout: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_IDLE_TIMEOUT_SECONDS)
    .default(DEFAULT_IDLE_TIMEOUT_SECONDS)
    .openapi({
      param: { name: "timeout", in: "query", required: false },
      type: "integer",
      minimum: 1,
      maximum: MAX_IDLE_TIMEOUT_SECONDS,
      default: DEFAULT_IDLE_TIMEOUT_SECONDS,
      description:
        `Seconds to hold the request open, 1–${MAX_IDLE_TIMEOUT_SECONDS} (${MAX_IDLE_TIMEOUT_SECONDS} ` +
        "is also the default; a longer ask is rejected with a 400 validation error, not clamped). " +
        "Parking costs the agent zero tokens: it is blocked on a response, not looping.",
    }),
});

/**
 * Both halves of a reap. The server already computes them — an event whose
 * recovery attempts have run out is *given up on* rather than returned to
 * `pending/` — and reporting only the recovered half left the CLI unable to say
 * that anything had been abandoned, which is the one outcome an operator running
 * `corpus queue reap-stale` needs to hear about.
 */
export const ReapStaleResultSchema = z
  .object({
    reaped: z
      .array(EventIdSchema)
      .describe("Events recovered from `in-progress/` back to `pending/` after a crashed run."),
    failed: z
      .array(EventIdSchema)
      .describe(
        "Events the reap gave up on rather than recovering, having exhausted their attempts. They " +
          "are **not** in `reaped`: the two arrays are disjoint, and an empty one is the normal case.",
      ),
  })
  .openapi("ReapStaleResult");

/**
 * Body of `POST /api/queue/halt`, and optional in both directions: the whole
 * body may be omitted (halting is a kill switch first — `corpus queue halt`
 * with no argument must stay a bare POST), and when it is sent the reason is
 * still optional. A supplied reason is recorded beside the timestamp in the
 * `.corpus/HALT` sentinel, so whoever finds the queue stopped can see why.
 */
export const HaltQueueRequestSchema = z
  .strictObject({
    reason: z
      .string()
      .min(1)
      .optional()
      .describe("Human-readable halt reason, recorded in the `.corpus/HALT` sentinel."),
  })
  .openapi("HaltQueueRequest");

/**
 * Body of `POST /api/queue/{id}/defer` (CONTRACT-021).
 *
 * **`blockedOn` is mandatory, and it is the whole reason this is not a bodiless
 * verb.** §7 asks for a state that returns to `pending` on its own when the
 * person stops editing, which is only implementable if the deferral says *which*
 * document — and the event cannot always be asked: `comment.created` carries
 * `parentId` in its payload, `form.respond` carries `{threadId, formTs, answers,
 * note}` and names no document. The defer call is made by the party that just
 * read the document and saw the session open, so the document is supplied here
 * rather than inferred from a payload shape that plugins are free to define.
 *
 * `reason` is the deferral's human sentence, and it replaces the `deferred:`
 * prefix the interim protocol smuggled into a failure reason: the status now
 * carries that meaning, so the text is free to say something useful.
 */
export const DeferEventRequestSchema = z
  .strictObject({
    blockedOn: DocumentIdSchema.describe(
      "The document being edited that the work is waiting on. The end of that edit session " +
        "returns this event to `pending` automatically (SPEC.md §7), so a deferral that named the " +
        "wrong document would wait forever.",
    ),
    reason: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Human-readable deferral note, shown in the console beside the blocking document. No " +
          "`deferred:` prefix is needed or wanted — the status says that now.",
      ),
  })
  .openapi("DeferEventRequest");

export const FailEventRequestSchema = z
  .strictObject({
    reason: z
      .string()
      .min(1)
      .optional()
      .describe("Human-readable failure reason, shown in the console."),
  })
  .openapi("FailEventRequest");

export type CoreQueueEventType = z.infer<typeof CoreQueueEventTypeSchema>;
export type IdleResult = z.infer<typeof IdleResultSchema>;
export type IdleQuery = z.infer<typeof IdleQuerySchema>;
export type ClaimScopeQuery = z.infer<typeof ClaimScopeQuerySchema>;
export type ReapStaleResult = z.infer<typeof ReapStaleResultSchema>;
export type QueueEventStatus = z.infer<typeof QueueEventStatusSchema>;
export type QueueEvent = z.infer<typeof QueueEventSchema>;
export type InProgressEvent = z.infer<typeof InProgressEventSchema>;
export type InProgressSet = z.infer<typeof InProgressSetSchema>;
export type ClaimBatch = z.infer<typeof ClaimBatchSchema>;
export type QueueStatus = z.infer<typeof QueueStatusSchema>;
export type DeferEventRequest = z.infer<typeof DeferEventRequestSchema>;
export type FailEventRequest = z.infer<typeof FailEventRequestSchema>;
export type HaltQueueRequest = z.infer<typeof HaltQueueRequestSchema>;
