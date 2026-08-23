import { z } from "zod";
import { ThreadIdSchema } from "./id.js";
import { openapi } from "./openapi-metadata.js";

/**
 * **Lanes** — the queue's partition, and the one vocabulary every lane-shaped
 * field on this wire is spelled from (SPEC.md §7, rider SHARED-043 signed
 * 2026-08-13, corrected 2026-08-15).
 *
 * A lane is named by exactly two kinds of value: the literal
 * {@link ORCHESTRATOR_LANE}, and the id of a **designated root thread**. Three
 * fields carry one — a posting request's `recipient`, a queue verb's `scope`,
 * and a roster row's `lane` — and they are all {@link LaneSchema} rather than
 * three hand-written unions, because the failure this module exists to prevent
 * is the three drifting apart one release at a time.
 *
 * ## The lane is not the origin, and this is the distinction to keep
 *
 * §7 states it flatly: *"the lane is stamped to route the work, while the origin
 * is the thread the event's own payload names… Routing follows the recipient;
 * filing follows the conversation."* They answer different questions and are
 * read off different things:
 *
 * ```text
 *   recipient ──▶ the event's lane ──▶ who claims it   (this module)
 *   the job    ──▶ the document's origin ──▶ whose scope it joins  (./provenance.ts)
 * ```
 *
 * The two come apart precisely on a **summons**: a message posted in one
 * conversation that names another conversation's resident. It is stamped with
 * the *recipient's* lane, which is the only thing that makes it reach them at
 * all — a scoped claim sees only its own lane, and an unscoped claim never sees
 * a live lane's events, so an event stamped with the host's lane would be
 * claimable by nobody. What the summoned agent then writes still files into the
 * **host's** conversation, because origin is read off the payload's thread.
 * §7's signed text originally said the summons took the host's lane; that was
 * corrected on 2026-08-15 for exactly this reason, and the correction is why
 * `recipient` lives here and `job` lives in `./provenance.ts` rather than the
 * two sharing a module.
 *
 * ## Why there is no `Lane` component
 *
 * `LaneSchema` is a union, and a union has no `type: "object"`, so registering
 * it as a named component would break the invariant `openapi.test.ts` holds over
 * every named schema — and, worse, `zod-to-openapi` propagates a registered name
 * onto anything derived from it, so an `.optional()` or `.nullable()` use would
 * silently rewrite the shared definition (CONTRACT-037). It inlines instead,
 * deterministically, exactly as `ExtraFrontmatter` and `ViewQuery` do.
 */

/**
 * The lane every event falls on when it falls in no designated scope — and the
 * lane a `resident.designated` event takes whoever is designated, since a
 * resident does not announce itself to itself (SPEC.md §7).
 *
 * A literal rather than `null`, and that is deliberate: the orchestrator's lane
 * is a lane like any other, with a claimant, a parked `idle` and a roster row.
 * Spelling it as absence would have made "no scope" and "the orchestrator's
 * scope" the same value, and every consumer would then have to decide which one
 * a `null` meant.
 */
export const ORCHESTRATOR_LANE = "orchestrator";

/**
 * A lane's name: the orchestrator's, or a designated root thread's id.
 *
 * Only a **root** thread can name a lane — designation is standalone-threads-only
 * (§7) — but a thread id is a thread id on the wire, so "this thread is not a
 * designated root" is a refusal the server makes rather than a shape the pattern
 * can express.
 */
export const LaneSchema = z.union([z.literal(ORCHESTRATOR_LANE), ThreadIdSchema]);

/**
 * Where a message is addressed (SPEC.md §7's "Every message has a recipient").
 *
 * **Optional, and the default is computed rather than guessed**: posting inside
 * a designated scope addresses that scope's resident, posting anywhere else
 * addresses the orchestrator. So an omitted `recipient` is not "unknown" — it is
 * the ordinary case, and it follows from where the message was posted.
 *
 * Carried on the three posting requests §7 covers — thread creation, turn
 * append, and a form answer — in their multipart forms as well as their JSON
 * ones. **Not** carried on `POST /api/capture`, which needs none: a capture
 * creates a standalone thread that is in no scope by construction, so it
 * addresses the orchestrator by the same default rule, and offering an override
 * there would be a routing choice made before there is a conversation to route.
 */
export const recipientField = LaneSchema.optional().describe(
  "Which lane this message is addressed to (SPEC.md §7): `orchestrator`, or the id of a " +
    "designated root thread. **Omit it for the default**, which is computed from where the " +
    "message is posted — inside a designated scope it addresses that scope's resident, anywhere " +
    "else the orchestrator — so absence is the ordinary case and never a guess the caller has to " +
    "check. Stating one **routes this message and nothing else**: it never rewires a scope, never " +
    "re-designates anything, and does not persist past the message it was set on. The event this " +
    "request enqueues is stamped with the named recipient's lane, which is what makes it reach " +
    "them — an event stamped with the host's lane would be claimable by nobody, since a scoped " +
    "claim sees only its own lane and an unscoped claim never sees a live lane's events. What the " +
    "summoned agent writes still belongs to the conversation it was asked in: **routing follows " +
    "the recipient, filing follows the conversation** (§7), and filing is `job`/`origin`'s job, " +
    "not this field's. A value naming a thread that is not a designated root — or no thread at " +
    "all — is a `422`: the composer only offers live lanes, but a pick can go stale between the " +
    "roster read and the post, and silently routing it somewhere else would answer the person " +
    "from an agent they did not address.",
);

/**
 * Which lane a queue verb consumes (SPEC.md §7), on `GET /api/queue/idle` and
 * `POST /api/queue/claim-all`.
 *
 * **Omitting it means {@link ORCHESTRATOR_LANE}** — the same lane, not a third
 * behaviour — which is what keeps every caller written before lanes existed
 * meaning exactly what it meant before. There is one spelling of each lane and
 * the absent parameter is a default, not a second one.
 */
export const laneScopeParam = openapi(LaneSchema.optional(), {
  param: { name: "scope", in: "query", required: false },
  description:
    "Which lane to consume (SPEC.md §7): `orchestrator`, or the id of a designated root thread. " +
    "**Omitted means `orchestrator`** — the same lane, so a caller written before lanes existed " +
    "keeps its meaning exactly. A **scoped** call sees only its own lane's events; the " +
    "orchestrator's call is the unscoped one and **never sees a live lane's events**, so two " +
    "agents working at once are reading disjoint sets rather than racing for one event. A lane " +
    "whose listener has been absent longer than the grace window has **lapsed**, and its pending " +
    "events become visible to the orchestrator's call — the fallback is computed when the call is " +
    "made and never written into the events, so a resident that comes back finds its lane exactly " +
    "as it left it. One consumer per lane: a second concurrent claim on one lane is still refused.",
});

export type Lane = z.infer<typeof LaneSchema>;
