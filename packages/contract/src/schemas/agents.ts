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
 * So {@link AgentLaneSchema.live} is a fact about a request the server is
 * currently holding open, and every field beside it is either configuration
 * (`resident`, `origin`) or an observation of the same parking (`since`).
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
 * The name a resident is designated by — **the invocable name, never a document
 * id**.
 *
 * It is the same resolution surface `@<subagent>` mentions use (SPEC.md §8): a
 * `type: agent-def` document is invocable by the stem of its file name under
 * `.claude/agents/`, and by its title, matched case-insensitively. Designating
 * by the name a person already types after a sigil is the point — a designation
 * that took a `doc_…` would be a different vocabulary for the same act, and the
 * two would answer differently the first time an agent-def was renamed.
 *
 * The response resolves it: {@link ResidentSchema} carries both the name and the
 * document it resolved to, so a caller never has to repeat the lookup.
 */
export const AgentNameSchema = z
  .string()
  .min(1)
  .max(AGENT_NAME_MAX_LENGTH)
  .refine((value) => value.trim() !== "", { message: "must not be blank" })
  .refine((value) => !/[\r\n]/.test(value), { message: "must be a single line" })
  .openapi({
    description:
      "The name the agent is invocable by — the same resolution `@<subagent>` mentions use " +
      "(SPEC.md §8): a `type: agent-def` document's own name, or its title, matched " +
      "case-insensitively. **Not a document id.** A name that resolves to no agent-def in this " +
      "workspace is a `404`.",
    example: "researcher",
  });

/**
 * A thread's resident: the agent that owns the conversation, and the document
 * that defines it (SPEC.md §7).
 *
 * Both halves, because they answer different questions and a caller holding one
 * cannot cheaply get the other. `name` is what a person reads and what a mention
 * would have written; `docId` is what a reader opens to see what the agent
 * actually is — an `agent-def` is an ordinary document (§7), so its id is a link
 * the board can already follow.
 */
export const ResidentSchema = z
  .object({
    name: AgentNameSchema,
    docId: DocIdSchema.describe(
      "The `type: agent-def` document the name resolved to, resolved at designation time and " +
        "re-read on every response — so a renamed or moved agent-def shows its current id here " +
        "rather than a stale one.",
    ),
  })
  .openapi("Resident");

/**
 * The resident of a thread, or `null` — the shape carried on `Thread` and
 * `ThreadSummary`.
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
 */
export const residentField = z
  .union([ResidentSchema, z.null()])
  .describe(
    "The agent resident in this conversation, or null (SPEC.md §7). **Standalone threads only** — " +
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
    live: z
      .boolean()
      .describe(
        "**Whether a listener is parked on this lane right now** (SPEC.md §7). Presence is the " +
          "parked scoped `idle` and nothing else: there is no heartbeat, no registration and " +
          "nothing to reap, so an agent that stops parking stops being present whether it exited " +
          "cleanly, crashed or was killed. False is therefore an ordinary, recoverable state and " +
          "not an error — a lane whose listener has been absent past the grace window falls back " +
          "to the orchestrator at claim time, so the work is done more slowly and never silently " +
          "not done.",
      ),
    since: IsoDateTimeSchema.nullable().describe(
      "**When this lane's listener was last seen parked**, as an instant — null when it never has " +
        "been. An instant rather than an elapsed duration, for the reason `InProgressEvent." +
        "heldSince` gives: a duration is stale the moment the response is read, and it hides " +
        "which clock produced it, while an instant lets the caller subtract against whichever " +
        "clock it trusts. Rendering it as `live 4m` is the caller's job.",
    ),
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
 * Body of `POST /api/threads/{id}/resident`.
 *
 * One field, and strict like every request body (CONTRACT-017): a designation
 * says who, and the thread it is about is in the path. There is deliberately no
 * "release" spelling here — releasing is `DELETE` on the same path, so `null`
 * never has to mean two things.
 */
export const DesignateResidentRequestSchema = z
  .strictObject({ name: AgentNameSchema })
  .openapi("DesignateResidentRequest");

export type Resident = z.infer<typeof ResidentSchema>;
export type LaneOrigin = z.infer<typeof LaneOriginSchema>;
export type AgentLane = z.infer<typeof AgentLaneSchema>;
export type AgentRoster = z.infer<typeof AgentRosterSchema>;
export type DesignateResidentRequest = z.infer<typeof DesignateResidentRequestSchema>;
