import { z } from "@hono/zod-openapi";
import { DocIdSchema, ThreadIdSchema } from "./id.js";
import { LaneSchema, ORCHESTRATOR_LANE } from "./lane.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * **The roster** — who is running, read behind an ordinary query key (SPEC.md
 * §7, rider SHARED-043).
 *
 * §7 is explicit that this is *"a read, never a push"*: the roster and each
 * lane's liveness are fetched over HTTP and refetched on an invalidation, like
 * every other projection, rather than streamed. Nothing here travels over SSE —
 * the SSE frame names `["agents"]` and this route answers it (`../query-keys.ts`).
 *
 * ## One row per lane, not one row per agent
 *
 * The roster is keyed on {@link LaneSchema}, so the orchestrator's row exists
 * before anything has ever been designated and does not vanish when the last
 * resident is released. That is what makes the composer's recipient picker a
 * list of *lanes a message can be addressed to* rather than a list of agents
 * that happen to be up — the two differ exactly when a lane's listener has
 * lapsed, which is the case the picker most needs to show.
 *
 * ## Liveness is observed, never registered
 *
 * §7: *"A resident is **live** exactly while it holds a parked scoped `idle`."*
 * There is no heartbeat to send, no registration to keep fresh and no state to
 * reap — an agent that stops parking stops being present, however it stopped.
 * So {@link presenceLiveField} is a fact about a request the server is
 * currently holding open, and every field beside it is either configuration
 * (`resident`, `origin`) or an observation of the same parking (`since`).
 *
 * ## One notion of presence, published in two places
 *
 * "Is an agent there" is asked by two surfaces at two grains — the composer's
 * recipient picker asks it of one lane, the console strip asks it of the
 * workspace — and CONTRACT-045 answers both from **this** vocabulary rather than
 * a second one. {@link presenceLiveField} and {@link presenceSinceField} are the
 * literal schema objects published on a roster row *and*, through
 * {@link AgentPresenceSchema}, on `QueueStatus.agent`: the two sites carry
 * character-identical prose because they carry the same object, and
 * `openapi.test.ts` asserts it. The queue status's copy is the roster's own
 * verdict aggregated — `live` there is true exactly when some row's `live` is —
 * so the strip and the picker cannot come to disagree about the same fact, which
 * is the whole reason the aggregate is published beside the counts instead of
 * being derived by elimination from them.
 */

/** The upper bound on {@link AgentLaneSchema}'s `summary`, in characters. */
export const LANE_SUMMARY_MAX_LENGTH = 200;

/**
 * How long a designation may name its agent, in characters.
 *
 * Generous, and a bound rather than a guess: the value is matched against the
 * names of `type: agent-def` documents the workspace already holds, so anything
 * near this length names nothing. What the bound is *for* is that an unbounded
 * string reaches a lookup and an error message.
 */
export const AGENT_NAME_MAX_LENGTH = 100;

/**
 * The name a **profile** is designated by — **the invocable name, never a
 * document id**.
 *
 * It is the same resolution surface `@<subagent>` mentions use (SPEC.md §8): a
 * `type: agent-def` document is invocable by the stem of its file name under
 * `.claude/agents/`, and by its title, matched case-insensitively. Designating
 * by the name a person already types after a sigil is the point — a designation
 * that took a `doc_…` would be a different vocabulary for the same act, and the
 * two would answer differently the first time an agent-def was renamed.
 *
 * **This schema is the shape of a name, not the requirement that there be one.**
 * A designation may name no profile at all (SPEC.md §7, rider SHARED-048); that
 * is spelled by *omitting* the field, never by any value of it, so every value
 * this accepts is still a real name. It carries no description of its own on
 * purpose: the two places it is used mean different things by a name — one is
 * asking for a profile, the other is reporting the profile that was asked for —
 * and each says so itself rather than sharing prose that has to be true of both.
 */
export const AgentNameSchema = z
  .string()
  .min(1)
  .max(AGENT_NAME_MAX_LENGTH)
  .refine((value) => value.trim() !== "", { message: "must not be blank" })
  .refine((value) => !/[\r\n]/.test(value), { message: "must be a single line" })
  .openapi({ example: "researcher" });

/**
 * A thread's resident: the agent that owns the conversation, and the profile it
 * works from — **when it has one** (SPEC.md §7, rider SHARED-048).
 *
 * ## Two fields, two independent questions
 *
 * `name` answers *which profile the designation named*; `docId` answers *what
 * that name resolves to now*. §7 keeps them independent on purpose — *"a profile
 * says how the agent works and nothing about what it owns"* — so the states a
 * caller can meet are exactly three:
 *
 * - `{name: null, docId: null}` — a **general resident**: the designation named
 *   no profile. §7 calls this the ordinary case; it required nothing to exist
 *   first.
 * - `{name: "researcher", docId: "doc_…"}` — a **profiled resident**: open that
 *   document to see what the agent is.
 * - `{name: "researcher", docId: null}` — a profiled resident whose **profile is
 *   gone**, renamed or archived since. The designation stands and the resident
 *   goes on owning its scope; §7 requires the miss be *reported* rather than
 *   silently substituted, and this is the report. Not the same state as the
 *   first: one is ordinary and one is worth mentioning to a person.
 *
 * The fourth combination is not a state — a `docId` with no `name` would be a
 * document nobody named — and the refinement below rejects it.
 *
 * ## Why null, and not a synthesised name
 *
 * The shape this beat was keeping `name` non-null and giving a general resident
 * a display string (`"agent"`, `"general"`) with `docId: null`. It loses on one
 * concrete consequence: that string reaches the composer's recipient list and
 * the board badge *beside real profile names*, with nothing to tell them apart —
 * and it can **collide** with a real agent-def titled the same, leaving a picker
 * showing two rows a person cannot choose between. A null is unmistakable and
 * un-collidable, and a caller that wants a word for a general resident picks its
 * own, in its own language, at the one place it renders one.
 *
 * ## Why a flat object, and not a union
 *
 * `{name: string, docId: string | null} | {name: null, docId: null}` would make
 * the fourth combination unrepresentable rather than refined away. It loses
 * because a union publishes `oneOf`, which has no `type: "object"` and therefore
 * cannot be a **named** component under this document's invariant (CONTRACT-037):
 * `Resident` would inline into every route mentioning it, and the four domains
 * that consume it would lose the one name they refer to it by. The refinement
 * buys the same guarantee at runtime for the price of one sentence.
 */
export const ResidentSchema = z
  .object({
    name: AgentNameSchema.nullable().describe(
      "The **profile** this conversation's agent was designated with, or null when it was " +
        "designated with none. Null is the ordinary case (SPEC.md §7): a resident with no profile " +
        "is *a general resident* — an agent working the conversation as the workspace's ordinary " +
        "agent does — and it is a resident in every other respect, so **null here never means " +
        "there is nobody**; that is the whole field being null one level up. Where it is a name, " +
        "it is the invocable name `@<subagent>` mentions use (SPEC.md §8), not a document id, and " +
        "it is what a person reads. **Do not substitute a word for null and print it as a name** " +
        "— beside real profile names it would be indistinguishable from one, and could collide " +
        "with an agent-def titled the same.",
    ),
    docId: DocIdSchema.nullable().describe(
      "The `type: agent-def` document `name` resolves to **right now**, or null when there is " +
        "none to resolve — either because no profile was named, or because the one that was named " +
        "has since been renamed or archived. Read the two fields together: `name` null is a " +
        "general resident, `name` set with this null is a resident whose profile has gone (SPEC.md " +
        "§7 — the designation stands, and the missing profile is reported rather than silently " +
        "substituted), and both set is a profile a reader can open. It is re-resolved on every " +
        "response rather than stored, so a moved agent-def shows its current id here rather than " +
        "a stale one.",
    ),
  })
  .refine((resident) => resident.name !== null || resident.docId === null, {
    message: "a resident that named no profile cannot have resolved to an agent-def document",
    path: ["docId"],
  })
  .openapi("Resident");

/**
 * The resident of a conversation, or `null` — the shape carried on `Thread`,
 * `ThreadSummary` and each roster row.
 *
 * `z.union([ResidentSchema, z.null()])` rather than `ResidentSchema.nullable()`:
 * `zod-to-openapi` propagates a registered component's name onto anything
 * derived from it, so the `.nullable()` spelling would rewrite the shared
 * `Resident` component to `type: ["object", "null"]` for every route that
 * references it (CONTRACT-037). The union publishes
 * `anyOf: [{$ref: Resident}, {type: "null"}]` and leaves the component plain.
 *
 * **Nullable rather than optional**, which is this contract's response-side
 * convention: a thread with no resident says so, and "the key is missing" never
 * has to be told apart from "there is nobody". Dissolution is the absence of a
 * resident, never a third state (§7).
 *
 * **The one confusion worth pre-empting is this field's null against
 * `Resident.name`'s.** Since SHARED-048 a designation may name no profile, so
 * there are two nulls one level apart and they mean opposite things: *this*
 * field null is nobody, and a `Resident` whose `name` is null is somebody with
 * no profile. Every use site of this field says so, because it is used on a
 * thread — where null is ordinary — and on a roster row, where it is nearly a
 * contradiction.
 */
export const residentField = z
  .union([ResidentSchema, z.null()])
  .describe(
    "The agent resident in this conversation, or null when it has none (SPEC.md §7). **Null " +
      "means nobody, and never a resident with no profile**: since a designation may name no " +
      "`agent-def`, a general resident is an object here whose `name` is null — so a designated " +
      "conversation always carries an object, whatever it was designated with. On a roster row " +
      "null therefore occurs only on the `orchestrator` lane, which belongs to no conversation; " +
      "every other lane exists because something was designated. **Standalone threads only** — " +
      "a thread on a document is *about* that document, and a resident owns a conversation rather " +
      "than a passage — so this is always null on an anchored or whole-document thread. Single-" +
      "valued: a thread has one resident or none, and nothing has to arbitrate between two. " +
      "Designation is **user-only** state, set through `POST /api/threads/{id}/resident` and " +
      "released through `DELETE`; resolving the thread releases it too, and reopening does not " +
      "bring it back (§8).",
  );

/**
 * The conversation a lane belongs to — id and current title — or `null` for the
 * orchestrator's lane, which belongs to none.
 *
 * **Not SPEC.md §9.2's document `origin`**, despite the shared word, and the two
 * are worth keeping apart because §7 keeps them apart on purpose: a document's
 * origin is the conversation it was written *from*, while this is the
 * conversation a lane *is*. For a row whose `lane` is a thread id, `origin.id`
 * is that same id — the field exists for the `title` beside it, so a picker can
 * name the conversation without a second read.
 *
 * The title is read at response time rather than stored, the rule `Job` already
 * follows for `originTitle` (`./job.ts`): a renamed conversation shows its new
 * title on the next read.
 */
export const LaneOriginSchema = z
  .object({
    id: ThreadIdSchema.describe("The designated root thread this lane belongs to."),
    title: z.string().describe("That thread's title as it now stands, read at response time."),
  })
  .openapi("LaneOrigin");

/**
 * **Whether a listener is parked** — the one field every "is an agent there"
 * question on this wire is answered by, whatever its grain.
 *
 * Published on a roster row (per lane) and on `QueueStatus.agent` (the whole
 * workspace) as the *same object*, so the two descriptions are identical by
 * construction rather than by anyone remembering to keep them so. The subject
 * therefore has to be named by where it sits, which is what the first sentence
 * does.
 *
 * **The grace window is applied server-side, before this is answered**, and that
 * is the one thing about it a client must not re-decide. §7 leaves the window's
 * length open but guarantees it is longer than a rearm gap, because a healthy
 * listener un-parks for a moment every time it re-arms; a verdict computed
 * without it would flicker every eight minutes, and a console pill that
 * flickered would be the same lie this field exists to stop, just faster.
 */
export const presenceLiveField = z
  .boolean()
  .describe(
    "**Whether a listener is parked** (SPEC.md §7) — on this lane where this sits on a roster " +
      "row, on any lane at all where it sits on the queue status. The two are the same " +
      "observation at two grains and never disagree. Presence is the parked scoped `idle` and " +
      "nothing else: there is no heartbeat, no registration and nothing to reap, so an agent that " +
      "stops parking stops being present whether it exited cleanly, crashed or was killed. **The " +
      "grace window is already applied**: a listener between parks is still live, since a healthy " +
      "one un-parks for a moment every time it re-arms. False is therefore an ordinary, " +
      "recoverable state and not an error — past that window a lane's pending events fall back to " +
      "the orchestrator at claim time, so the work is done more slowly and never silently not " +
      "done.",
  );

/**
 * **When a listener was last observed parked** — the evidence behind
 * {@link presenceLiveField}, and the field that lets a caller say *how* stale
 * the verdict it is holding has become.
 *
 * It advances on every re-arm, so on a live lane it is never older than the idle
 * timeout, and it stops moving the moment the listener does. That is what makes
 * `now − since` the age of the evidence rather than the length of the agent's
 * session — and it is why a client may expire a `live: true` it has been holding
 * too long (`isAgentPresent`) without ever being able to manufacture a presence
 * the server did not report.
 */
export const presenceSinceField = IsoDateTimeSchema.nullable().describe(
  "**When a listener was last observed parked**, as an instant — null when none ever has been. " +
    "It advances every time the listener re-arms, so on a live lane it is never older than the " +
    "idle timeout, and it stops the moment the listener does: `now − since` is therefore the age " +
    "of the evidence behind `live`, not the length of a session. An instant rather than an " +
    "elapsed duration, for the reason `InProgressEvent.heldSince` gives: a duration is stale the " +
    "moment the response is read and hides which clock produced it, while an instant lets the " +
    "caller subtract against whichever clock it trusts. Rendering it as `last seen 12m ago` is " +
    "the caller's job.",
);

/**
 * Whether an agent is there, and the observation behind the answer.
 *
 * A component of its own because it is carried at two grains — one lane's, on a
 * roster row, and the workspace's, on `QueueStatus.agent` — and a caller that
 * can write one function over `{live, since}` writes the pill and the picker
 * with the same code. {@link AgentLaneSchema} spreads the same two fields flat
 * rather than nesting this, so the row still reads as one sentence; it is
 * structurally an `AgentPresence`, and `isAgentPresent` takes either.
 */
export const AgentPresenceSchema = z
  .object({ live: presenceLiveField, since: presenceSinceField })
  .openapi("AgentPresence", {
    description:
      "**Whether an agent is there, and the observation behind the answer** (SPEC.md §7, §11). " +
      "Presence is the parked scoped `idle` and nothing else — nothing is registered, nothing is " +
      "reaped, and nothing new is asked of the agent, which is why it can be reported without a " +
      "heartbeat protocol.\n\n" +
      "Where this sits on `QueueStatus` it is the roster's own liveness **aggregated over every " +
      "lane**: `live` is true exactly when some lane of `GET /api/agents` is live, and `since` " +
      "is the most recent of their instants. One notion of presence reported at two grains, so " +
      "the console strip and the recipient picker can never disagree about whether anybody is " +
      "listening. **It says whether an agent is present, never how many are**: one parked agent " +
      "and two are both `live`, and a count belongs to the roster, which has a row per lane to " +
      "put it on. Read it rather than deriving idleness from the queue counts beside it — an " +
      "empty queue means nobody asked for anything, not that somebody is waiting to be asked.",
  });

/**
 * One lane of the queue, and whoever is or is not listening on it.
 *
 * Ordered as the row reads: which lane, who is resident on it, whether anyone is
 * listening, since when, what they are doing, and which conversation it is.
 */
export const AgentLaneSchema = z
  .object({
    lane: LaneSchema.describe(
      "This lane's name: `orchestrator`, or the id of a designated root thread. It is the value " +
        "to send as `scope` on a queue verb, and as `recipient` on a message addressed here.",
    ),
    resident: residentField,
    // The shared objects, deliberately: a roster row and the queue status ask
    // the same question, and they answer it in the same words because they are
    // the same schema.
    live: presenceLiveField,
    since: presenceSinceField,
    summary: z
      .string()
      .max(LANE_SUMMARY_MAX_LENGTH)
      .nullable()
      .describe(
        "A short line about what this lane is doing, or null when there is nothing to say. " +
          "**The contract promises its bound and nothing about its content**: it is derived " +
          `server-side, capped at ${LANE_SUMMARY_MAX_LENGTH} characters and trimmed there, and ` +
          "how it is derived may change without a contract change. So it is for display only — a " +
          "client must never parse it, key on it, or decide anything from it, and everything a " +
          "client needs to decide from is a field of its own on this row.",
      ),
    origin: z
      .union([LaneOriginSchema, z.null()])
      .describe(
        "The conversation this lane belongs to — its id and current title — or null for the " +
          `\`${ORCHESTRATOR_LANE}\` lane, which belongs to none. **Not a document's \`origin\` ` +
          "(SPEC.md §9.2)**: that is the conversation a document was written *from*, while this " +
          "is the conversation a lane *is*. Where `lane` is a thread id, `origin.id` repeats it — " +
          "the field is here for the title beside it, so a recipient picker can name the " +
          "conversation without a second read.",
      ),
  })
  .openapi("AgentLane");

/**
 * The whole roster: every lane, always including the orchestrator's.
 *
 * Wrapped in an object rather than returned as a bare array, like every other
 * collection this contract publishes — a top-level array has nowhere to grow a
 * sibling field, and this one will want one the first time the roster needs to
 * say something about itself.
 */
export const AgentRosterSchema = z
  .object({
    agents: z
      .array(AgentLaneSchema)
      .describe(
        `Every lane of the queue. The \`${ORCHESTRATOR_LANE}\` row is always present — it exists ` +
          "before anything has been designated and survives the last release — so a caller that " +
          "finds an empty list has found a bug rather than a workspace with no agents.",
      ),
  })
  .openapi("AgentRoster");

/**
 * Body of `POST /api/threads/{id}/resident` — **optional in full**: a bare
 * `POST`, or `{}`, designates a **general resident** (SPEC.md §7, rider
 * SHARED-048).
 *
 * ## Absence is the spelling, and that is the decision
 *
 * §7 makes naming no profile *"the ordinary case"* and one that *"requires
 * nothing to exist first"*, so the ordinary case is the one that costs a caller
 * nothing to express. That is already this contract's shape for an optional
 * request field — `POST /api/queue/halt` halts on a bare `POST` and takes a
 * `reason` when there is one — and already its rule for the request/response
 * asymmetry: **a request omits what it does not have, a response states it as
 * null** (`schemas/form-answer.ts`, where a blank optional field is omitted from
 * the request and present-and-null in the payload).
 *
 * Two other spellings were considered and lost:
 *
 * - `{name: null}`, required. It would make the ordinary case the ceremonious
 *   one, and it gives `null` a job on the request side that `null` already has
 *   twice on the response side ("there is nobody" on {@link residentField},
 *   "no profile" on {@link ResidentSchema}). Release is `DELETE` on this same
 *   path precisely so nothing here has to be spelled with a null.
 * - a sentinel name (`"agent"`, `"general"`). Rejected for the reason
 *   {@link ResidentSchema} gives — it would reach a person's recipient list
 *   dressed as a profile, and could collide with a real one.
 *
 * ## The cost of absence-as-meaning, stated rather than discovered
 *
 * A caller whose variable is `undefined` by accident designates a general
 * resident instead of getting a `400`. Affordable here, and bounded on both
 * sides: a designation is single-valued and visible on the thread, so the
 * mistake is undone by designating again or releasing; the likelier typo —
 * a blank or whitespace-only name — is still a `400` rather than absence, since
 * {@link AgentNameSchema} is non-blank; and the body is strict
 * (CONTRACT-017), so a caller that means `name` and writes `agent` is told which
 * key it got wrong instead of quietly receiving a general resident.
 */
export const DesignateResidentRequestSchema = z
  .strictObject({
    name: AgentNameSchema.describe(
      "The **profile** to designate, by the invocable name `@<subagent>` mentions already use " +
        "(SPEC.md §8): a `type: agent-def` document's own name, or its title, matched " +
        "case-insensitively. **Not a document id.** A name that resolves to no agent-def in this " +
        "workspace is a `404` — a typo is refused rather than degraded to a general resident, " +
        "because a typo that looked like it worked is the worse outcome.\n\n" +
        "**Omit it — or send no body at all — to designate a general resident**: an agent with no " +
        "persona document, working the conversation as the workspace's ordinary agent does. That " +
        "is the ordinary designation and needs nothing to exist in the workspace first (SPEC.md " +
        "§7). Everything else is identical either way — the lane, the scope, presence, the lapse " +
        'fallback, release, and resolution releasing it. A **blank** name is not absence: `""` ' +
        'and `"   "` are `400`, because dropping a name by accident is a mistake and asking for ' +
        "no profile is a decision.",
    ).optional(),
  })
  .openapi("DesignateResidentRequest");

export type AgentPresence = z.infer<typeof AgentPresenceSchema>;
export type Resident = z.infer<typeof ResidentSchema>;
export type LaneOrigin = z.infer<typeof LaneOriginSchema>;
export type AgentLane = z.infer<typeof AgentLaneSchema>;
export type AgentRoster = z.infer<typeof AgentRosterSchema>;
export type DesignateResidentRequest = z.infer<typeof DesignateResidentRequestSchema>;
