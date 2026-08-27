import { z } from "zod";
import { DesignationIdSchema, DocIdSchema, ThreadIdSchema } from "./id.js";
import { LaneSchema, ORCHESTRATOR_LANE } from "./lane.js";
import { IsoDateTimeSchema } from "./time.js";
import { REQUESTED_WEIGHT_MAX_LENGTH, RequestedWeightSchema } from "./weight.js";
import { openapi } from "./openapi-metadata.js";

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
 * `type: agent-def` document **under `.claude/agents/`** is invocable by the stem
 * of its file name *and* by its title, matched case-insensitively. Both spellings
 * carry weight and they routinely differ — since SERVER-122 a persona created
 * with the title `Legacy Analyst` is written to `legacy-analyst.md`, so a person
 * types the stem and the board's designate menu sends the title.
 *
 * **The root is the gate, not a detail of the stem clause** (SERVER-125).
 * `invocableName` is null for a `type: agent-def` filed anywhere else, and
 * `targetIndex` takes that as the gate on being addressable at all — so such a
 * document resolves under *no* spelling, its title included. It is a document
 * *about* a persona: nothing loads it as a subagent, and moving it into
 * `.claude/agents/` is what makes it designatable.
 *
 * Designating by the name a person already types after a sigil is the point — a
 * designation that took a `doc_…` would be a different vocabulary for the same
 * act, and the two would answer differently the first time an agent-def was
 * renamed.
 *
 * **This schema is the shape of a name, not the requirement that there be one.**
 * A designation may name no profile at all (SPEC.md §7, rider SHARED-048); that
 * is spelled by *omitting* the field, never by any value of it, so every value
 * this accepts is still a real name. It carries no description of its own on
 * purpose: the two places it is used mean different things by a name — one is
 * asking for a profile, the other is reporting the profile that was asked for —
 * and each says so itself rather than sharing prose that has to be true of both.
 */
export const AgentNameSchema = openapi(
  z
    .string()
    .min(1)
    .max(AGENT_NAME_MAX_LENGTH)
    .refine((value) => value.trim() !== "", { message: "must not be blank" })
    .refine((value) => !/[\r\n]/.test(value), { message: "must be a single line" }),
  { example: "researcher" },
);

/**
 * What a resident's weight governs, and what it does not — SPEC.md §7's rider
 * signed 2026-08-19, in one sentence, published verbatim on
 * `DesignateResidentRequest.weight` and `Resident.weight` and reused by the
 * server (SERVER-129) and the CLI (CLI-053). One wording, so the rule cannot
 * drift site by site as the agent-def root rule did (CONTRACT-064). Read it as
 * the predicate of a sentence whose subject is the weight.
 */
export const RESIDENT_WEIGHT_BOUNDARY =
  "governs the resident's own turns; a weight stated on a message still governs what the " +
  "resident hands off (SPEC.md §7, rider signed 2026-08-19)";

/**
 * The one directory a `type: agent-def` document has to sit in to be
 * addressable at all (SPEC.md §7) — see {@link AgentNameSchema}, where the root
 * is the gate rather than a detail of the stem clause.
 *
 * Named because two things interpolate it: the third of
 * {@link MISSING_PROFILE_CAUSES}, and the code-quoted spelling
 * {@link MISSING_PROFILE_CAUSE_CLAUSE} publishes.
 */
export const AGENT_DEF_ROOT = ".claude/agents/";

/**
 * **Every way a designated profile stops resolving**, and the only place this
 * package writes them down — SPEC.md §7, as amended by SHARED-053 (signed
 * 2026-08-20): *"A profile that is renamed, deleted, or moved out of
 * `.claude/agents/` after designation does not end the designation … the missing
 * profile is reported rather than silently substituted."*
 *
 * **Archiving is not a member, and its absence is the point.** An archived
 * `agent-def` stays under `.claude/agents/`, so it still resolves and its
 * resident is still designatable — telling a person that a working archived
 * profile is gone is a false statement about a lane that is fine. That clause
 * was in this sentence for a release, at eight sites at once, because each site
 * was typed (SHARED-053).
 *
 * **So no surface types the list.** {@link MISSING_PROFILE_CAUSE_CLAUSE} is
 * composed from this array and `Resident.docId`'s published description is
 * composed from that, which leaves one place to correct and one place a test
 * has to read. The measurement lives in `scripts/missing-profile-parity.test.ts`,
 * the one tree allowed to see `apps/server` and `packages/kit` at once: it pairs
 * each cause with a **workspace act** by type identity, applies it to a real
 * workspace, and asserts set-equality in both directions — so a cause added here
 * without an act that produces it fails, and so does an act that starts emptying
 * `docId` without a cause.
 *
 * **This is the home, and it is the only one** (SHARED-054, closed 2026-08-24).
 * The dependency direction is fixed — `packages/contract` ← `packages/kit` /
 * `apps/cli` — so neither downstream array could be this package's source and
 * this one can be theirs. Both are now re-exports. The blocks that held three
 * declarations equal are deleted rather than rewritten: a test holding three
 * lists equal is not one home, it is three homes with a guard.
 */
export const MISSING_PROFILE_CAUSES = [
  "renamed",
  "deleted",
  `moved out of ${AGENT_DEF_ROOT}`,
] as const;

/** One of {@link MISSING_PROFILE_CAUSES} — the type a parity fixture pairs with an act. */
export type MissingProfileCause = (typeof MISSING_PROFILE_CAUSES)[number];

/**
 * The three causes as one English clause, for the descriptions that enumerate
 * them. Composed, never written out — see {@link MISSING_PROFILE_CAUSES}.
 *
 * **The root is code-quoted here and bare in the array**, and the split is the
 * point of having two constants. A published `description` is markdown, and so
 * is `docs/cli.md`, which `apps/cli` generates from the same clause — a bare
 * path reads there as prose rather than as a path. The array's members stay
 * bare because `packages/kit` renders them into a lane's own sentence on the
 * board, where a backtick reaches a person's eye as a backtick. So the
 * enumeration is shared and the typography is not.
 */
export const MISSING_PROFILE_CAUSE_CLAUSE = ((): string => {
  const quoted = MISSING_PROFILE_CAUSES.map((cause) =>
    cause.replace(AGENT_DEF_ROOT, `\`${AGENT_DEF_ROOT}\``),
  );
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1] ?? ""}`;
})();

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
 *   gone**: one of {@link MISSING_PROFILE_CAUSES} has happened to it since. The
 *   designation stands and the resident goes on owning its scope; §7 requires
 *   the miss be *reported* rather than silently substituted, and this is the
 *   report. Not the same state as the first: one is ordinary and one is worth
 *   mentioning to a person. **Archiving is not one of the ways in** — see
 *   {@link ResidentSchema}'s `docId`.
 *
 * The fourth combination is not a state — a `docId` with no `name` would be a
 * document nobody named — and the refinement below rejects it.
 *
 * ## A third field, orthogonal to both: `weight`
 *
 * SPEC.md §7's rider signed 2026-08-19: *"A resident's weight is set when it is
 * designated, not per message."* A resident is a running agent, so the model it
 * works at is a property of the designation — it cannot change what it is
 * without discarding the conversation it is holding — and the designation is
 * the only place the choice can be made. So it is carried **here**, on the
 * `Resident` every surface already reads (the thread, the thread summary, the
 * roster row, the `resident.designated` payload), rather than write-only on the
 * request: a surface that shows who is resident (§10, UI-125) must show what it
 * runs at, or the choice is invisible once made.
 *
 * It is `string | null`, **required and nullable** like every response-side
 * field here. The value is the same token a message's `weight` carries
 * ({@link RequestedWeightSchema}) — a level's key from the workspace's own tier
 * table, never a model name, so "no model names in the UI" (a signed non-goal)
 * holds by construction. `null` is *none chosen*: the launcher decides and says
 * so. Orthogonal to the profile pair — `{name: null, docId: null, weight:
 * "heavy"}` is a general resident running heavy, an ordinary state — so the
 * refinement below does not mention it.
 *
 * **What it governs is stated once, in {@link RESIDENT_WEIGHT_BOUNDARY}**, and
 * published verbatim on the request field and on this field. That sentence is
 * what SERVER-129 and CLI-053 reuse; stating it anew at each site is how a rule
 * stated at eight sites in v0.12.0 drifted (CONTRACT-064).
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
 * ## A fourth field, about the designation rather than about the resident
 *
 * `designationId` is the identity of the **act** that put this resident here,
 * and the three fields above are what that act asked for. It is here for one
 * reader: a listener that was launched for one designation and needs to find
 * out, without parsing anything written for a person, that the lane it sits on
 * now serves a different one (CONTRACT-071). It is carried on `Resident`
 * rather than beside it because both halves of that comparison are `Resident`s
 * — the launch payload's and the roster row's — so a field here is read on both
 * sides with nothing to keep in step.
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
export const ResidentSchema = openapi(
  z
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
          `has since been ${MISSING_PROFILE_CAUSE_CLAUSE}, the root a persona ` +
          "has to live in to be addressable at all. **Archiving a profile does not empty this " +
          "field**: an archived `agent-def` still under that root resolves exactly as before, and is " +
          "still designatable, so what stands here is its id and `name (profile missing)` is the " +
          "wrong thing to show for it. Archived-ness is not carried on a `Resident` at all — it is " +
          "the document's own `status`, on the document this id names, for the caller that cares. " +
          "Read the two fields together: `name` null is a " +
          "general resident, `name` set with this null is a resident whose profile has gone (SPEC.md " +
          "§7 — the designation stands, and the missing profile is reported rather than silently " +
          "substituted), and both set is a profile a reader can open. It is re-resolved on every " +
          "response rather than stored, so what stands here is the document the name answers to " +
          "now, never a stale id.",
      ),
      weight: RequestedWeightSchema.nullable().describe(
        "The **weight this resident runs at**, or null (SPEC.md §7, rider signed 2026-08-19: a " +
          "resident's weight is set when it is designated, not per message). Where set, it is a " +
          "level's key from the workspace's own agent guidance — the same token a message's " +
          "`weight` carries, never a model name — recorded verbatim from the designation and " +
          "interpreted by nothing here. **Null means none was chosen**: the launcher decides what " +
          "the resident runs at, and says so. Orthogonal to `name` and `docId` — a general " +
          "resident may run at a stated weight, and a profiled one at none. It " +
          `${RESIDENT_WEIGHT_BOUNDARY}. ` +
          "A designation is long-lived, so a level the launcher cannot meet is not refused here " +
          "(the table is skill text the server never reads): the launcher reports it, per §7's " +
          "weight rider, in the listener's first reply.",
      ),
      designationId: DesignationIdSchema.nullable().describe(
        "**Which designation this is** — an opaque id the server mints for the act, not for the " +
          "agent (SPEC.md §7). It changes **exactly when the designation changes**: a " +
          "re-designation that names a different profile, or the same profile at a different " +
          "weight, is a different designation and gets a different id, while one that asks for " +
          "the state already in force writes nothing, displaces nobody and keeps the id it had.\n\n" +
          "**It exists to be compared, by the listener the designation launched.** A listener " +
          "carries the id from the `resident.designated` it was launched with, and the lane's " +
          "roster row carries the id in force now; where the two differ, the designation it " +
          "serves has been replaced and a successor is or will be running. That comparison is " +
          "the only machine-readable way to learn it — a replacement at the same weight leaves " +
          "the lane present and the row in place, so nothing else on the row moves, and the " +
          "row's rendered resident cell is written for a person and must never be parsed. What a " +
          "listener then does is the converse skill's to state, not this contract's.\n\n" +
          "**Not the id of the `resident.designated` event.** That event announces a " +
          "designation and one designation may be announced more than once — re-designating is " +
          "how a person asks for a listener that stopped to be started again, and each such call " +
          "enqueues an event while the designation stands unchanged. An event id would therefore " +
          "differ where nothing had been replaced, which is the one wrong answer this field must " +
          "not give.\n\n" +
          "**Opaque, and never rendered.** Nothing is encoded in it, two of them have no order, " +
          "and no surface shows it to a person: equality is the only sound operation. **Null " +
          "means there is no id to compare** — a designation made before the server recorded " +
          "this, or a hand-written `resident:` block that omits it — and it is not a value. Two " +
          "nulls are not evidence of the same designation, so a reader that meets one on either " +
          "side has no answer and must do what it did before this field existed, rather than " +
          "concluding that nothing changed.",
      ),
    })
    .refine((resident) => resident.name !== null || resident.docId === null, {
      message: "a resident that named no profile cannot have resolved to an agent-def document",
      path: ["docId"],
    }),
  "Resident",
);

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
export const LaneOriginSchema = openapi(
  z.object({
    id: ThreadIdSchema.describe("The designated root thread this lane belongs to."),
    title: z.string().describe("That thread's title as it now stands, read at response time."),
  }),
  "LaneOrigin",
);

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
 * **What it must not claim is that the two grains always agree** (CONTRACT-053,
 * found by SERVER-112 implementing both sides). CONTRACT-045 wrote *"`live` is
 * true exactly when some lane of `GET /api/agents` is live"*, and a listener
 * parked on a lane whose resident was released is a real state in which that is
 * false: the row is gone at once, the park is held for up to one grace window,
 * and the aggregate reports live because somebody genuinely is. The primary fact
 * is the parked request — §7 defines presence as that and nothing else — so the
 * aggregate defines itself directly and the divergence is stated on the
 * component, where a caller comparing the two will meet it. `presence()` in
 * `apps/server/src/queue/liveness.ts` is the implementation and reasons it out
 * at length. No behaviour changed here.
 *
 * **The grace window is applied server-side, before this is answered**, and that
 * is the one thing about it a client must not re-decide. §7 leaves the window's
 * length open but guarantees it is longer than a rearm gap, because a healthy
 * listener un-parks for a moment every time it re-arms; a verdict computed
 * without it would flicker every eight minutes, and a console pill that
 * flickered would be the same lie this field exists to stop, just faster.
 */
/**
 * **How much work is waiting on this lane** (CONTRACT-087; SPEC.md §7's rider
 * signed 2026-08-25).
 *
 * **The field exists because the fallback stopped existing.** Until that rider,
 * a lane whose listener was absent had its pending events folded into the
 * orchestrator's unscoped claim, so "somebody is waiting here and nobody is
 * listening" needed no field: the work itself arrived, and arriving was the
 * signal. The rider removes that — *"a lane's work is done by that lane's agent,
 * and by nobody else"* — so the work no longer arrives, and the fact has to be
 * readable instead.
 *
 * **It is half of one decision, and `live` is the other half.** A lane with
 * `pending > 0` and `live: false` is a conversation nobody is answering, and
 * that pair is what the orchestrator launches a listener from. Neither field
 * decides it alone: a lane with no work and no listener is idle and perfectly
 * healthy, and launching for it would give a workspace one agent per
 * conversation that has ever existed.
 *
 * **Pending only.** Not `in-progress`, and not `deferred`. The question is *is
 * anyone waiting*, and an event already being worked is not waiting — counting
 * it would keep a lane looking unattended for exactly as long as it is being
 * attended to. A deferred event is waiting on a person's edit session (§7) and
 * returns to pending by itself when that ends, where it is counted like any
 * other.
 *
 * **This is what replaces reading `AgentLane.summary`.** That field is
 * display-only and says so — *"a client must never parse it, key on it, or
 * decide anything from it"* — and this is the field of its own that the same
 * sentence promises.
 */
/**
 * **Is this lane holding work it claimed?** (CONTRACT-057; SPEC.md §7.)
 *
 * ## The three things `live: false` means, and why the third is expensive
 *
 * Presence is the parked request and nothing else, so `live: false` is true of a
 * listener that crashed, one the server has not observed since it restarted, and
 * **one in the middle of a turn**. The third is not an edge case: §7 has a
 * resident work its conversation inline, and the converse skill tells it to
 * await what it launches rather than park on it, so a turn longer than the grace
 * window is *designed behaviour*.
 *
 * That was cosmetic until v0.23.0 and is not any more. The orchestrator launches
 * a listener for a lane that is `pending > 0 && !live`, so a resident thinking
 * for two minutes with a message queued behind it looks exactly like a dead
 * lane — and gets a second listener started on top of it.
 *
 * ## It is not presence, and must not be read as it
 *
 * **A lane holding work is not evidence a listener is alive.** A listener that
 * died mid-event leaves its event in `in-progress/` until `corpus queue
 * reap-stale` requeues it, so `working: true` outlives the agent that earned it.
 * The field **bounds a launch decision** — it says *do not start a second one
 * yet* — and it can never be read as *somebody is definitely there*. `live`
 * answers that, still, and is unchanged.
 *
 * The pair `{live: false, working: true}` is the state this whole field exists
 * for and must read naturally: nobody is parked, and something is being done.
 *
 * ## Why it is not folded into `summary`
 *
 * The roster already computes this — `workSummary` renders `working <title>` for
 * a lane holding an in-progress event — into a field whose contract says a
 * client *"must never parse it, key on it, or decide anything from it"*. This is
 * the field of its own that sentence promises, and it is the third one: `live`
 * answers *is anybody there*, `pending` answers *is anybody waiting*, and this
 * answers *is anything being done*. The launch decision needs all three.
 */
export const laneWorkingField = z
  .boolean()
  .describe(
    "**Whether this lane is holding work it claimed** (SPEC.md §7). True while an event stamped " +
      "for this lane sits in `in-progress/`.\n\n" +
      "**It is not presence and must never be read as it.** `live` is the parked request; this " +
      "is held work, and the two come apart in both directions. A resident works its " +
      "conversation inline and holds no park while it does, so a turn longer than the grace " +
      "window reads `{live: false, working: true}` — which is the state this field exists for, " +
      "and the one that tells a busy agent from a dead one. And a listener that died mid-event " +
      "leaves its event held until `corpus queue reap-stale` requeues it, so `working: true` " +
      "outlives the agent that earned it: **the field bounds a launch decision and is never " +
      "evidence anybody is there**.\n\n" +
      "**The third of three, and the launch decision needs all three.** `live` answers *is " +
      "anybody there*, `pending` answers *is anybody waiting*, and this answers *is anything " +
      "being done*. **Decide from this rather than from `summary`**, which renders the same fact " +
      "as prose and forbids deciding from it.",
  );

export const lanePendingField = z
  .number()
  .int()
  .min(0)
  .describe(
    "**How many events are pending on this lane** (SPEC.md §7, rider signed 2026-08-25). " +
      "`pending` only — never `in-progress`, which is work already being done rather than work " +
      "waiting, and never `deferred`, which is waiting on a person's edit session and returns to " +
      "pending by itself. **A lane with `pending > 0` and `live: false` is a conversation nobody " +
      "is answering**, and that pair is the whole signal: since the rider there is no fallback, " +
      "so no other agent will take this work and the only thing that changes it is a listener " +
      "starting. Neither field means it alone — a lane with no work and no listener is idle and " +
      "healthy. **Decide from this rather than from `summary`**, which is display-only and says " +
      "so. `0` where nothing is waiting, never null and never absent.",
  );

export const presenceLiveField = z
  .boolean()
  .describe(
    "**Whether a listener is parked** (SPEC.md §7) — on this lane where this sits on a roster " +
      "row, on any lane at all where it sits on the queue status. One observation at two grains, " +
      "and `AgentPresence` names the one window in which the two grains legitimately differ. " +
      "Presence is the parked scoped `idle` and " +
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
export const AgentPresenceSchema = openapi(
  z.object({ live: presenceLiveField, since: presenceSinceField }),
  "AgentPresence",
  {
    description:
      "**Whether an agent is there, and the observation behind the answer** (SPEC.md §7, §10). " +
      "Presence is the parked scoped `idle` and nothing else — nothing is registered, nothing is " +
      "reaped, and nothing new is asked of the agent, which is why it can be reported without a " +
      "heartbeat protocol.\n\n" +
      "Where this sits on `QueueStatus` it measures the workspace **directly**: `live` is true " +
      "exactly when some listener is holding a parked scoped `idle`, and `since` is the most " +
      "recent instant among the lanes that are live — or, when none is, the most recent instant " +
      "any lane has ever supplied, so *last parked 10m ago* stays distinguishable from *none has " +
      "parked since the server started*. It is defined by the parked request, not by another " +
      "endpoint's rows.\n\n" +
      "**It can therefore read `live` while `GET /api/agents` lists no live lane** — briefly, and " +
      "both answers correct. A roster row exists while a thread has a resident, and releasing " +
      "that resident (or resolving the thread, which releases it too) removes the row at once. " +
      "The listener parked on that lane does not go with it: it is still holding an `idle`, and " +
      "it keeps holding it until it returns or lapses, up to one grace window. Presence is the " +
      "parked request (SPEC.md §7), so this reports live for that window while the roster, which " +
      "reports designated lanes, reports none. It resolves itself when that listener stops. A " +
      "caller that must not watch two numbers disagree should read one of them.\n\n" +
      "**It says whether an agent is present, never how many are**: one parked agent " +
      "and two are both `live`, and a count belongs to the roster, which has a row per lane to " +
      "put it on. Read it rather than deriving idleness from the queue counts beside it — an " +
      "empty queue means nobody asked for anything, not that somebody is waiting to be asked.",
  },
);

/**
 * One lane of the queue, and whoever is or is not listening on it.
 *
 * Ordered as the row reads: which lane, who is resident on it, whether anyone is
 * listening, since when, what they are doing, and which conversation it is.
 */
export const AgentLaneSchema = openapi(
  z.object({
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
    // The half of the launch decision `live` cannot make (CONTRACT-087). It sits
    // beside it because the two are read together and mean nothing apart.
    pending: lanePendingField,
    // The third field of the launch decision (CONTRACT-057). It sits after
    // `pending` because the two are read together and neither means the whole
    // thing: waiting work on a busy lane wants patience, not a second listener.
    working: laneWorkingField,
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
  }),
  "AgentLane",
);

/**
 * The whole roster: every lane, always including the orchestrator's.
 *
 * Wrapped in an object rather than returned as a bare array, like every other
 * collection this contract publishes — a top-level array has nowhere to grow a
 * sibling field, and this one will want one the first time the roster needs to
 * say something about itself.
 */
export const AgentRosterSchema = openapi(
  z.object({
    agents: z
      .array(AgentLaneSchema)
      .describe(
        `Every lane of the queue. The \`${ORCHESTRATOR_LANE}\` row is always present — it exists ` +
          "before anything has been designated and survives the last release — so a caller that " +
          "finds an empty list has found a bug rather than a workspace with no agents.",
      ),
  }),
  "AgentRoster",
);

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
 * ## `weight` rides the same body, optional for the same reason (CONTRACT-067)
 *
 * SPEC.md §7's rider signed 2026-08-19 makes the designation the one place a
 * resident's model is chosen. The field is {@link RequestedWeightSchema} — the
 * level-key vocabulary a message's `weight` already uses, so the composer's
 * picker (which reads the workspace's tier table, `packages/kit`'s
 * `weightLevels.ts`) offers the same levels here with no second vocabulary —
 * and it is optional because omitting it must mean what it meant before the
 * field existed: the launcher decides. `Resident.weight` reports it back, null
 * when omitted. What it governs is {@link RESIDENT_WEIGHT_BOUNDARY}, stated
 * once.
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
/**
 * The designation a **thread creation** carries (CONTRACT-088; SPEC.md §7's
 * rider A and §10's rider B, both signed 2026-08-25).
 *
 * ## Three states, and `null` earns a job it was refused next door
 *
 * - **Absent** — rider A's default: a **general resident**. A conversation is a
 *   thing an agent owns, so owning it is what happens when a caller says
 *   nothing. That is the same spelling {@link DesignateResidentRequestSchema}
 *   already gives the ordinary case, for the same reason.
 * - **`{name}`** — that profile, resolved exactly as the designate route
 *   resolves it, including its `404` on a name that matches nothing.
 * - **`null`** — **no resident at all.**
 *
 * The docblock above rejects `{name: null}` partly because *"release is `DELETE`
 * on this same path precisely so nothing here has to be spelled with a null"*.
 * At creation there is no `DELETE` to lean on: the thread does not exist yet, so
 * "create it with nobody" cannot be expressed as a later act without leaving a
 * window in which the default already applied. That is what earns `null` a
 * meaning here and nowhere else.
 *
 * ## `null` and absent differ here, unlike everywhere else on this body
 *
 * `parent` and `selector` on the same request both read *"Omitted or null"* and
 * treat the two alike. This field does not, and a caller that spells a missing
 * variable as `null` gets the opposite of the default rather than the default.
 * It is called out in the published description for that reason: the risk is
 * real and the alternative — a sentinel string — was rejected next door for
 * reasons that still hold, since it would reach a recipient list dressed as a
 * profile and could collide with a real one.
 */
export const CreateThreadResidentSchema = z
  .strictObject({
    name: AgentNameSchema.optional().describe(
      "The profile to designate, by the invocable name `@<subagent>` mentions use (SPEC.md §8). " +
        "Omitted designates a **general resident** — an agent with no persona document, which " +
        "§7 calls the ordinary case. Resolution and its `404` are exactly the designate route's.",
    ),
    weight: RequestedWeightSchema.optional().describe(
      "The model tier this resident works at (SPEC.md §7's rider signed 2026-08-19), the same " +
        "level-key vocabulary the designate route takes. Omitted leaves it to the launcher.",
    ),
  })
  .describe(
    "**Who will own this conversation** (SPEC.md §7, rider signed 2026-08-25). **Three states, " +
      "and `null` is not the same as omitting this field** — unlike `parent` and `selector` on " +
      "this same body, where omitted and null mean one thing. **Omit it** for the default: a " +
      "general resident, because a new standalone thread designates one unless the person chose " +
      "otherwise. **Send `{name}`** to designate that profile. **Send `null`** for a thread with " +
      "no resident at all, which belongs to the orchestrator as every thread did before this " +
      "rider.\n\n" +
      "**This is not `recipient`, and the two are never collapsed.** Naming a recipient routes " +
      "**one message** and rewires nothing (SPEC.md §7's summons); designating hands over the " +
      "conversation **and everything that grows out of it**. Both may be sent on one request, " +
      "and they mean different things.\n\n" +
      "**Refused on a thread with a parent.** §7 lets only a standalone thread designate: a " +
      "thread on a document is *about* that document, and a resident owns a conversation rather " +
      "than a passage.",
  );

export const DesignateResidentRequestSchema = openapi(
  z.strictObject({
    name: AgentNameSchema.describe(
      "The **profile** to designate, by the invocable name `@<subagent>` mentions already use " +
        "(SPEC.md §8): for a `type: agent-def` document **under `.claude/agents/`**, its filename " +
        "stem or its title, matched case-insensitively — and the two routinely differ, since a " +
        "persona created with the title `Legacy Analyst` is written to `legacy-analyst.md`. " +
        "**Not a document id, and not an `agent-def` filed outside that root**: one under " +
        "`data/docs/` is a document *about* a persona, nothing loads it as a subagent, and it " +
        "answers to neither spelling. A name that resolves to no agent-def in this workspace is a " +
        "`404` — a typo is refused rather than degraded to a general resident, because a typo " +
        "that looked like it worked is the worse outcome — and where an off-root `agent-def` is " +
        "titled the name given, that `404` names its path, because moving the file into " +
        "`.claude/agents/` is what makes it designatable.\n\n" +
        "**Omit it — or send no body at all — to designate a general resident**: an agent with no " +
        "persona document, working the conversation as the workspace's ordinary agent does. That " +
        "is the ordinary designation and needs nothing to exist in the workspace first (SPEC.md " +
        "§7). Everything else is identical either way — the lane, the scope, presence, the lapse " +
        'fallback, release, and resolution releasing it. A **blank** name is not absence: `""` ' +
        'and `"   "` are `400`, because dropping a name by accident is a mistake and asking for ' +
        "no profile is a decision.",
    ).optional(),
    weight: RequestedWeightSchema.optional().describe(
      "The **weight the resident runs at** (SPEC.md §7, rider signed 2026-08-19: a resident's " +
        "weight is set when it is designated, not per message — a running agent cannot change " +
        "what it is without discarding the conversation it holds, so the designation is the only " +
        "place the choice exists). The value is a **level's key from the workspace's own agent " +
        "guidance, verbatim** — the same token a message's `weight` carries, and never a model " +
        "name: this contract enumerates no levels, because §7 keeps the tiers in the orchestrate " +
        "skill and a published enum would reject a workspace's own vocabulary. Validated for " +
        `**shape only** — non-blank, single line, at most ${REQUESTED_WEIGHT_MAX_LENGTH} ` +
        "characters — and interpreted by nothing here. It " +
        `${RESIDENT_WEIGHT_BOUNDARY}. ` +
        "**Omit it to choose nothing**, which keeps today's behaviour exactly: the resident runs " +
        "at whatever the launcher starts it as, `Resident.weight` reads null, and the launcher " +
        "says what it chose. No default, no `null` spelling, and an empty string is a `400` " +
        "rather than a second way of saying nothing. A level the launcher cannot meet is not " +
        "refused here — the tier table is skill text the server never reads — and since a " +
        "designation is long-lived the report lands where §7's weight rider puts it: in the " +
        "listener's first reply, naming what was asked for and what was done instead. Sent " +
        "alone, it designates a general resident at that weight; the two fields are independent.",
    ),
  }),
  "DesignateResidentRequest",
);

/**
 * The event type a designation enqueues, spelled here so this module does not
 * depend on `./queue.ts` (which imports it) — the arrangement `./edit.ts` and
 * `./form.ts` use for their own types. `queue.test.ts` pins that it is a member
 * of `CORE_QUEUE_EVENT_TYPES`.
 */
export const RESIDENT_DESIGNATED_EVENT_TYPE = "resident.designated";

/** The event type a release enqueues (CONTRACT-069); pinned the same way. */
export const RESIDENT_RELEASED_EVENT_TYPE = "resident.released";

/**
 * The event type an unattended lane's arrival enqueues (CONTRACT-093); pinned
 * the same way. The third of the announcements that reach the orchestrator's
 * lane, and the only one that is not about a designation changing.
 */
export const LANE_WAITING_EVENT_TYPE = "lane.waiting";

/**
 * The payload of a `resident.designated` event — what the orchestrator reads to
 * launch a listener: which conversation was designated, and who to launch there
 * (SPEC.md §7, rider SHARED-043; AGENT-026).
 *
 * The resident travels **resolved**, as the response carries it, so the consumer
 * never repeats a lookup the server has already made. A general resident is
 * `{name: null, docId: null, …}` — a designation like any other, not a
 * designation of nobody: the listener to launch is the workspace's ordinary
 * agent, with no persona document to read (SHARED-048).
 *
 * **It lands on the orchestrator's lane whoever is designated** — the resident
 * does not announce itself to itself. The rule is stated once, on
 * `CORE_QUEUE_EVENT_TYPES`'s docblock, and this payload carries no lane for the
 * reason `QueueEvent` carries none.
 *
 * Not a registered component: it rides inside `QueueEvent.payload`, which §7
 * keeps open, and no route publishes it on its own.
 */
export const ResidentDesignatedPayloadSchema = z.object({
  threadId: ThreadIdSchema.describe(
    "The standalone thread that was designated — the root of the scope the resident now owns, " +
      "and the name of its lane.",
  ),
  // Referenced unmodified, deliberately: `.describe()` on a registered schema
  // makes zod-to-openapi carry the component's name onto the derived one and
  // rewrite the shared definition (CONTRACT-037). The resident is the same
  // `Resident` the designation's response carried, resolved, so the listener to
  // launch is read here and looked up nowhere.
  resident: ResidentSchema,
});

/**
 * The payload of a `lane.waiting` event — the whole of it (CONTRACT-093;
 * SPEC.md §7's rider signed 2026-08-27, *"a lane that cannot be worked says
 * so"*).
 *
 * **One field, and the emptiness is the design.** The orchestrator's loop
 * dispatches what it claims, so an announcement carrying a turn timestamp or a
 * document id would be answerable — and answering it would be the orchestrator
 * writing in a resident's name, which the rider signed 2026-08-25 removed the
 * lapse fallback specifically to prevent: *"answering in the resident's place is
 * not a slower version of the same answer — it is a different agent, with none
 * of the conversation, writing in its name."*
 *
 * A settling agent that wanted to answer this has nothing to answer **with**.
 * That is what makes the mistake impossible rather than merely forbidden, and it
 * is why nothing may be added here for convenience: every field is a step toward
 * a payload somebody could dispatch. What the orchestrator needs is the lane,
 * because the lane is the argument to the launch.
 *
 * The lane is a thread id — the root of the scope whose listener is absent. The
 * orchestrator's own lane never announces to itself, so no value here is ever
 * `"orchestrator"`.
 *
 * Not a registered component, for {@link ResidentDesignatedPayloadSchema}'s
 * reason: it rides inside `QueueEvent.payload`, which §7 keeps open.
 */
export const LaneWaitingPayloadSchema = z.object({
  lane: ThreadIdSchema.describe(
    "The lane with work and no listener — a standalone thread's id, and the argument to the " +
      "launch this event asks for. It is deliberately the only field: this event is not the " +
      "work and must not be answerable (SPEC.md §7).",
  ),
});

export type LaneWaitingPayload = z.infer<typeof LaneWaitingPayloadSchema>;

/**
 * Narrows a queue event to a waiting-lane notice, or returns `undefined`.
 *
 * Same tolerance as its siblings: a malformed payload is not an exception, so a
 * loop reading a mixed batch skips what it cannot understand rather than dying
 * on it.
 */
export function parseLaneWaitingPayload(payload: unknown): LaneWaitingPayload | undefined {
  const parsed = LaneWaitingPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Why a resident was released (CONTRACT-069; SPEC.md §7's three ways out of a
 * designation). Closed, and **a lapse is not one of them**: §7's fallback is
 * computed at claim time and writes nothing, so nothing is released and no
 * event is produced.
 */
export const RESIDENT_RELEASE_REASONS = ["released", "resolved", "replaced"] as const;

export const ResidentReleaseReasonSchema = z
  .enum(RESIDENT_RELEASE_REASONS)
  .describe(
    "Why the resident left (SPEC.md §7). `released`: a person released it — `DELETE " +
      "/api/threads/{id}/resident`. `resolved`: the thread was resolved, and a settled " +
      "conversation has nobody to keep resident, so resolution released it. `replaced`: a new " +
      "designation on the same thread displaced it — a thread has one resident or none, so " +
      "designating again is a release of the old one and a designation of the new, and the " +
      "`resident.designated` for the newcomer is a separate event. **A lapse is not a release** " +
      "and never produces this event: a lane whose listener has gone quiet falls back to the " +
      "orchestrator at claim time, nothing is written, and the resident is still resident.",
  );

/**
 * The payload of a `resident.released` event — what the orchestrator reads to
 * learn that a lane returned to it, and whose listener to stop (CONTRACT-069,
 * the wire half of SERVER-128).
 *
 * **It lands on the orchestrator's lane**, under the same carve-out as
 * {@link ResidentDesignatedPayloadSchema}: a released resident does not announce
 * its own end to itself, and the orchestrator is the party that launched the
 * listener and has to learn it is over. **One release, one event** — a release
 * that releases nothing (the idempotent `DELETE` on a thread with no resident)
 * produces none, and the event-storm argument lives with SERVER-128.
 *
 * `resident` is the resident **that was released** — the orchestrator logs who
 * left, and for `replaced` it is the old occupant, never the new one. The
 * newcomer travels on its own `resident.designated`.
 */
export const ResidentReleasedPayloadSchema = z.object({
  threadId: ThreadIdSchema.describe(
    "The thread whose resident was released — the root of the scope that has returned to " +
      "ordinary routing, and the name of the lane that no longer has an owner.",
  ),
  // Referenced unmodified, for the reason given on the designated payload. This
  // is the resident that was released, as it stood when it left: for `replaced`,
  // the displaced occupant and never the newcomer. Carried so the orchestrator
  // can log who left without a lookup the release itself has made impossible.
  resident: ResidentSchema,
  reason: ResidentReleaseReasonSchema,
});

/**
 * Narrows a queue event to a release, or returns `undefined` when it is not one
 * — a different type, or a payload that does not match. A malformed payload is
 * not an exception, for the reason `parseDocEditedPayload` gives: events come
 * off disk, and a consumer must survive one written by an older server.
 */
export function parseResidentReleasedPayload(event: {
  readonly type: string;
  readonly payload: unknown;
}): ResidentReleasedPayload | undefined {
  if (event.type !== RESIDENT_RELEASED_EVENT_TYPE) return undefined;
  const parsed = ResidentReleasedPayloadSchema.safeParse(event.payload);
  return parsed.success ? parsed.data : undefined;
}

/** The designation counterpart of {@link parseResidentReleasedPayload}. */
export function parseResidentDesignatedPayload(event: {
  readonly type: string;
  readonly payload: unknown;
}): ResidentDesignatedPayload | undefined {
  if (event.type !== RESIDENT_DESIGNATED_EVENT_TYPE) return undefined;
  const parsed = ResidentDesignatedPayloadSchema.safeParse(event.payload);
  return parsed.success ? parsed.data : undefined;
}

export type AgentPresence = z.infer<typeof AgentPresenceSchema>;
export type Resident = z.infer<typeof ResidentSchema>;

/**
 * A {@link Resident} **without its designation's identity** — what a designation
 * asks for, as opposed to which designation asked.
 *
 * Written as an `Omit` of the published type rather than as a second schema, so
 * a field added to `Resident` later lands here too and there is no shape to keep
 * in step.
 *
 * It exists for one caller and one hazard. The server decides whether a
 * `POST /api/threads/{id}/resident` writes at all by comparing what was asked
 * for against what the thread already has, and `designationId` must never enter
 * that comparison: it differs on every mint, so including it would make every
 * re-designation a replacement — a write, a release event and a displaced
 * listener where the request asked for the state that already held. Comparing
 * `DesignatedResident`s makes that unspellable rather than merely documented.
 */
export type DesignatedResident = Omit<Resident, "designationId">;
export type LaneOrigin = z.infer<typeof LaneOriginSchema>;
export type AgentLane = z.infer<typeof AgentLaneSchema>;
export type AgentRoster = z.infer<typeof AgentRosterSchema>;
export type DesignateResidentRequest = z.infer<typeof DesignateResidentRequestSchema>;
export type ResidentDesignatedPayload = z.infer<typeof ResidentDesignatedPayloadSchema>;
export type ResidentReleaseReason = z.infer<typeof ResidentReleaseReasonSchema>;
export type ResidentReleasedPayload = z.infer<typeof ResidentReleasedPayloadSchema>;
