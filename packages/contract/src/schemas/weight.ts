import { z } from "zod";

/**
 * The **weight** a request states its work should be done at (SPEC.md §7 and
 * §10, rider SHARED-022 signed 2026-08-06), and **how it travels** — which is
 * the whole of CONTRACT-039's job.
 *
 * ---
 *
 * ## What this is, and the one journey it makes
 *
 * §7 already says the subagent's model scales with the task's weight, and that
 * the concrete tier guidance lives in the orchestrate skill rather than in the
 * spec. SHARED-022 bolted an override onto that rule: *"A request may choose the
 * weight, and that choice is a directive."* §10 says where the choice is made
 * — every composer that can reach the agent — and that it **"rides with the
 * request to whatever does the work"**.
 *
 * This module is that ride, and only that ride:
 *
 * ```text
 *   composer ──weight──▶ POST /api/threads             ┐
 *                        POST /api/threads/{id}/turns  ├─▶ queue event payload ──▶ dispatch
 *                        POST /api/capture             ┘      (key: `weight`)       (job log)
 * ```
 *
 * Three parts, and each is deliberately dumb: {@link requestedWeightField} on
 * the request bodies, {@link requestedWeightPayload} to put it on the event the
 * request enqueues, and {@link readRequestedWeight} to take it off again. No
 * part of the contract knows what a level *means* — see the next section — and
 * no part of it decides anything from the value.
 *
 * ## Why the value is an opaque string, and never an enum
 *
 * This is the decision the rider is most emphatic about, and the one an enum
 * would quietly undo.
 *
 *   1. **SPEC forbids the enum's contents.** "Model names live in the skill, not
 *      here" is standing §7 text — the very sentence SHARED-022 amends without
 *      touching. An enumerated set in the contract would be that list, one layer
 *      down and harder to see.
 *   2. **The levels are a *workspace's* vocabulary, not the product's.**
 *      SHARED-022's Decision 1 has the composer read its options from the
 *      workspace's own orchestrate skill, precisely so the picker and the router
 *      move together. §2.4 lets a workspace take template changes on its own
 *      schedule and never overwrites an edited skill, so a workspace's table can
 *      legitimately differ from the shipped one, indefinitely and on purpose.
 *   3. **So an enum would fail in the worst available direction.** The server
 *      would reject a level the workspace's own guidance defines — the request
 *      refused by the product for agreeing with the document that governs it —
 *      and the fix would be a release, per workspace, for a word.
 *
 * What is left to validate is **shape**: non-blank, single line, bounded. That
 * is not a weakened enum, it is a different check with a different job — keeping
 * a value that reaches a line-oriented job log and a JSON event file from being
 * something other than one short label. See {@link RequestedWeightSchema}.
 *
 * The cost, stated: a typo (`"depe"`) is accepted by every layer here and
 * discovered by the orchestrator, which then cannot honour it and must say so —
 * §7's unhonourable path, which exists for the levels-were-renamed case anyway
 * and so costs nothing new. A rejection would have been *earlier*, not *better*:
 * it would have had to come from a list this contract must not hold.
 *
 * ## Why absence is not a default, and how that is made unmistakable
 *
 * The user's request opened by endorsing the orchestrator's judgment and asked
 * for an override on top of it, so **stating no weight must keep meaning "the
 * orchestrator decides"**, exactly as today. All three of SHARED-022's
 * amendments protect that, and its non-goals say it flatly: "Any implementation
 * that preselects a level for a person who has never chosen one has broken the
 * feature's premise."
 *
 * So there is exactly **one** spelling of "no choice" — the absent key — and
 * every plausible second spelling is closed:
 *
 *   - **No `.default()`.** Beyond the house rule in `./index.ts` (a default on a
 *     request field forces every typed caller to send it), a default here would
 *     *be* the fixed tier the rider exists to prevent.
 *   - **Not nullable.** `null` would be a second absence, and a server reading
 *     two of them would eventually treat one as a value.
 *   - **No empty string.** `min(1)` makes `""` a `400` rather than a quiet
 *     synonym for silence — the trap a multipart form is most likely to spring,
 *     since an untouched control is exactly what sends an empty part.
 *   - **Absence is structural on the way out too.**
 *     {@link requestedWeightPayload} returns `{}` for no choice, so a payload
 *     cannot acquire a `weight: undefined`/`weight: null` key by construction,
 *     and {@link readRequestedWeight} answers `undefined` for it.
 *
 * ## Why it is not written into the turn
 *
 * A weight is **request-time instruction**, the same class as `requestsAgent`:
 * an instruction about work, stated before the work, carried by the request that
 * asks for it. §8 puts `requestsAgent` in that class and
 * `apps/ui/src/thread/outstandingAgentRequest.ts` records what it costs — *"That
 * a given turn enqueued is recorded nowhere a later reader … can find it"* — and
 * the fix there was to stop inferring from the turn and read the queue. That is
 * the same move, made deliberately, in SHARED-022's Decision 3: the durable
 * question "which model answered this?" is answered by the job log while the job
 * lives, and by the agent's reply when a stated weight could not be honoured.
 *
 * Promoting the weight to a stored field would change what a turn is on disk (§6:
 * author, timestamp, body) for every consumer of the format, and would write a
 * runtime routing detail into the corpus's permanent record. SHARED-022 escalated
 * it as **Q2** and the user signed the rider with it left request-time. It is
 * therefore **not this module's decision to revisit**: doing it needs sign-off,
 * not a refactor.
 *
 * ## Not `Turn.model`, and never to be merged with it
 *
 * `./turn-model.ts` records the model that *did* write a turn. This records the
 * weight a request *asked* the work to be done at. §7's guarantee — a stated
 * weight is "honoured, not weighed again" — is only checkable while the
 * instruction and the outcome are separate values: one field holding both would
 * make "was this honoured?" a question with no observable answer. They stay
 * apart, and `./turn-model.ts` says so from its side too.
 *
 * ## Where it is carried — and where it deliberately is not
 *
 * **Carried** on every request body a composer that can reach the agent sends
 * (§10 enumerates the surfaces; `./thread.ts` and `./capture.ts` attach it):
 * thread creation and turn append in both their JSON and multipart forms, and
 * capture. Stated once for the set, the way §10 states attachments and snippets,
 * rather than per surface — SHARED-012's lesson, and the reason three of five
 * composers once shipped without attachments.
 *
 * **Not carried** in two places, both on purpose:
 *
 *   - **The form answer** (`POST /api/threads/{id}/forms/{ts}/answer`). §10's
 *     amendment enumerates *composers*, and a form answer is a reply to a
 *     question the agent asked inside work already dispatched, not a composer
 *     writing a new request. Whether answering may re-weight the continuation is
 *     a real question the rider does not answer; it is a spec question, and the
 *     cost of deciding it later is one field, since the payload key below is
 *     event-type-agnostic.
 *   - **The CLI's writing verbs.** SHARED-022's Q5 leaves them out by name: the
 *     CLI is how the *agent* writes, and the rider is about how a person asks.
 *     Explicitly a non-goal, so the chain does not quietly grow a flag.
 */

/**
 * The longest level key accepted, in characters.
 *
 * A bound rather than a guess, and generous: the shipped guidance's keys
 * (`light`, `standard`, `heavy`) are a fraction of it, so a workspace has room
 * to key its levels as it likes. What the bound is *for* is that this
 * value is copied verbatim into a queue event file and echoed into a job's log
 * line, neither of which should be growable through a composer's picker.
 */
export const REQUESTED_WEIGHT_MAX_LENGTH = 100;

const REQUESTED_WEIGHT_DESCRIPTION =
  "The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. " +
  "The value is a **level's key from the workspace's own agent guidance, verbatim** — the key " +
  "column of the guidance's tier table, not the label beside it, because the label is prose a " +
  "person may reword and the key is what survives that (AGENT-015). This contract " +
  "never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a " +
  "workspace edit that document on its own schedule, so a published enum would reject a " +
  "workspace's own vocabulary and could only be fixed by a release. The value is therefore " +
  `validated for **shape only** — non-blank, single line, at most ${REQUESTED_WEIGHT_MAX_LENGTH} ` +
  "characters — and never for meaning: the server records it and interprets nothing about it. " +
  "**Honoured, not weighed again**: the work is dispatched at the stated weight rather than at " +
  "the one the orchestrator would have picked, and is **never silently substituted in either " +
  "direction** — running stronger than asked spends against an explicit instruction exactly as " +
  "running weaker falls short of one. When a stated weight **cannot be honoured** (the installed " +
  "agent does not offer that model, the level no longer exists in the guidance) the work is still " +
  "done, at what the orchestrator judges best, and the deviation is stated: in the job's log " +
  "while it runs, and in the reply the request receives. It **rides with the request to whatever " +
  "does the work** (§10) — onto the queue event this call enqueues, under the payload key " +
  "`weight`, which is what the dispatch reads.";

/**
 * A level's key as the workspace's guidance writes it.
 *
 * Non-blank, so `""` can never stand in for "no choice" (see the docblock's
 * absence section). Single-line for the same mechanical reason `./turn-model.ts`
 * demands it of a model name, one surface over: the value is echoed into a
 * job's log — `.corpus/jobs/<eventId>.jsonl`, read line by line, and the very
 * place §7's console bullet says a dispatch names its weight — and a newline in
 * it is either a rendering failure or a way to write a second log line from
 * inside a value.
 */
export const RequestedWeightSchema = z
  .string()
  .min(1)
  .max(REQUESTED_WEIGHT_MAX_LENGTH)
  .refine((value) => value.trim() !== "", { message: "must not be blank" })
  .refine((value) => !/[\r\n]/.test(value), {
    message: "must be a single line: it is recorded verbatim in a queue event and a job log line",
  });

/**
 * The request-side field, on every body a composer that can reach the agent
 * sends — JSON and multipart alike, since a level key is already text and needs
 * no `z.stringbool`-style rescue on the way through a form part.
 *
 * Optional, and that is the feature rather than a convenience: **omitting it
 * means the orchestrator decides**, exactly as it decides today. It is not
 * nullable and has no default; there is one spelling of no choice.
 */
export const requestedWeightField = RequestedWeightSchema.optional().describe(
  `${REQUESTED_WEIGHT_DESCRIPTION} **Omit it to state no weight, which means the orchestrator ` +
    "decides** — its own judgment, unchanged, and never a default level: absence of a choice is " +
    "the ordinary case, and this field has no default and takes no `null`. An empty string is a " +
    "`400` rather than a second spelling of silence. A weight is **inert** on a request that " +
    "enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone " +
    "decides what reaches the agent, and stating a weight neither asks the agent nor stops it " +
    "being asked — it simply governs no work.",
);

/**
 * The key a stated weight travels under in a queue event's `payload`.
 *
 * Spelled the same as the request field on purpose. `InProgressEvent` set the
 * rule for the queue surface — saying one thing twice, two different ways, is
 * how two readers come to disagree — and here it also means a reader of the
 * event needs no mapping table to recognise what the request said.
 *
 * **Event-type-agnostic**, deliberately. It is a property of *a request that
 * asked for work*, not of `comment.created`, so the core payload schemas
 * (`FormRespondPayloadSchema`, `DocEditedPayloadSchema`) do not have to grow a
 * variant each and any other event type can carry it with no contract change at
 * all. §7 keeps `QueueEvent.type` an open string, so the set of types this key
 * may ride on is not knowable here; this convention respects that instead of
 * closing the envelope.
 */
export const REQUESTED_WEIGHT_PAYLOAD_KEY = "weight";

/**
 * The payload fragment for a stated weight — spreadable into the payload the
 * producer is building, `{}` when no weight was stated.
 *
 * This exists so that **absent stays absent is structural rather than a
 * promise**. A producer writing the key by hand would eventually write
 * `{weight: input.weight}` and put an explicit `undefined` — or, once it has been
 * through a JSON round trip and a nullable column, a `null` — into a payload that
 * should have had no such key. Both are second spellings of "no choice", and the
 * second one survives serialisation.
 *
 * It performs no validation and applies no policy: the request schema is where
 * shape is checked, and there is nothing else to decide. A weight goes in
 * verbatim or nothing goes in.
 */
export function requestedWeightPayload(weight: string | undefined): {
  readonly weight?: string;
} {
  return weight === undefined ? {} : { [REQUESTED_WEIGHT_PAYLOAD_KEY]: weight };
}

/** The carrier shape {@link readRequestedWeight} narrows a payload through. */
const RequestedWeightCarrierSchema = z.object({
  weight: RequestedWeightSchema.optional(),
});

/**
 * The weight stated by the request that enqueued this event, or `undefined` when
 * it stated none — which means the orchestrator decides (§7).
 *
 * Takes the payload rather than the event, because a weight belongs to no
 * particular event type (see {@link REQUESTED_WEIGHT_PAYLOAD_KEY}): the caller
 * has already decided the event is one it handles.
 *
 * **An ill-shaped value reads as none.** A payload whose `weight` is a number, a
 * list, or an empty string is not a weight, and answering `undefined` puts the
 * event in the state that means "the orchestrator decides" — the only reading
 * that cannot cause work to run at something nobody asked for. It also follows
 * `parseFormRespondPayload`'s rule for the same surface: events come off disk,
 * and a consumer that has to survive one written by an older server should skip
 * what it cannot read rather than crash. It is unreachable for an event this
 * server wrote, since the request path validates shape before the payload is
 * built.
 */
export function readRequestedWeight(payload: unknown): string | undefined {
  const parsed = RequestedWeightCarrierSchema.safeParse(payload);
  return parsed.success ? parsed.data.weight : undefined;
}

export type RequestedWeight = z.infer<typeof RequestedWeightSchema>;
