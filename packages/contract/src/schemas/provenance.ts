import { z } from "@hono/zod-openapi";
import { ThreadIdSchema } from "./id.js";

/**
 * **Provenance**: the job a write serves, and the conversation a document came
 * from (SPEC.md §7 and §9.2, rider SHARED-043 signed 2026-08-13).
 *
 * Two fields travelling in opposite directions, and it is worth being precise
 * about which is which, because they are easy to read as one thing:
 *
 * ```text
 *   caller ──job: evt_…──▶ any mutating route ──▶ server resolves evt → its
 *                                                 lane's root thread
 *                                                        │
 *   caller ◀──origin: th_…── the document it wrote ◀──────┘
 * ```
 *
 * {@link jobField} is **asked for**; {@link originField} is **answered with**.
 * No request shape accepts an origin — with one deliberate exception named on
 * the field itself — because a caller that could set one could file someone
 * else's document into its own conversation.
 *
 * ## Why the server resolves it rather than the caller sending a thread
 *
 * The obvious cheaper shape is `origin: th_…` on the request: no lookup, no
 * `422`. It is wrong for the reason §7's scope rule is computed rather than
 * stored — an agent naming its own scope is an agent asserting membership, and
 * the first bug is a resident that files a document into a conversation it was
 * only summoned into (§7's summons exception: *"answering a question does not
 * annex the thread it was asked in"*). Naming the **job** cannot express that:
 * the event was enqueued on exactly one lane, by the server, before the agent
 * saw it. So the caller says what it is working on, which it knows, and the
 * server says where that belongs, which only it knows.
 *
 * ## Why forgetting it is cheap
 *
 * §9.2: *"a write that names no job records no origin… forgetting it costs
 * provenance, never correctness."* That is why `job` is optional everywhere and
 * why nothing refuses a write that omits it. The contrast drawn in the spec is
 * with §7's key, which had to be enforced in the write path because forgetting
 * it cost a lost edit; here the cost is an unfiled document, so this field asks
 * and does not insist.
 */
export const jobField = z
  .string()
  .regex(/^evt_/, "a job id looks like `evt_…`")
  .optional()
  .openapi({
    description:
      "The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to " +
      "the lane's root thread and records that as the created document's `origin`, which is what " +
      "makes scope membership computable (§7). **Optional everywhere**: a write that names no job " +
      "records no origin and the document belongs to no conversation — forgetting it costs " +
      "provenance, never correctness, so nothing is refused and nothing is lost. An id that names " +
      "no event is a `422` rather than a silent omission: a caller that got the id wrong wanted " +
      "the attribution, and dropping it quietly would leave it believing it had one.",
    example: "evt_a1b2c3d4",
  });

/**
 * The thread a document came from, or `null` — **server-assigned, and read-only
 * on every request shape but one**.
 *
 * The exception is `PUT /api/docs/{id}`, which accepts `origin: null` and
 * nothing else: §9.2's **detach**, the affordance by which a person corrects a
 * document filed into the wrong conversation. It is clear-only and user-only,
 * both enforced server-side — a shape that accepted `origin: "th_…"` would be
 * the caller-asserted membership {@link jobField} exists to avoid, arriving by
 * the back door.
 *
 * Detach is **a correction and not a lock** (§9.2): a later write naming a job
 * may claim the document again. That is stated here because the field's name
 * suggests otherwise — "clearable" reads like "clearable for good", and it is
 * not.
 */
export const originField = ThreadIdSchema.nullable().openapi({
  description:
    "The thread this document came from (SPEC.md §7 scope, §9.2 provenance), or null when it " +
    "came from no job. **Server-assigned**: recorded once, from the job the creating write " +
    "named, whether or not any thread is designated — scope is computed later, and a fact not " +
    "recorded at write time cannot be recovered. The only request that may touch it is a doc " +
    "edit sending `origin: null` (detach, user-only), and a detached document may be claimed " +
    "again by a later write naming a job.",
  example: "th_x9y8z7",
});

/**
 * The detach half, for request bodies.
 *
 * **Clear-only, enforced server-side.** The obvious spelling — `z.null()`, so
 * that `origin: "th_…"` is a *type* error rather than a runtime refusal — does
 * not survive the toolchain: a JSON Schema `{"type": "null"}` reaches
 * `openapi-fetch` as `origin?: never`, and the generated client then rejects the
 * one value the field exists to accept. So the wire type is the ordinary
 * nullable id, and *"null is the only accepted value"* is a rule the write path
 * enforces (`400`) rather than one the compiler does.
 *
 * That is what CONTRACT-050 asked for in the first place — "clear only, never
 * set, user actor only, **enforced server-side**" — and the guarantee is
 * unchanged in substance: no caller can set an origin. What changed is only
 * where it is refused.
 */
export const originDetachField = ThreadIdSchema.nullable()
  .optional()
  .openapi({
    description:
      "Detach: clears this document's `origin`, removing it from its conversation's scope " +
      "(SPEC.md §9.2). **`null` is the only accepted value** — an origin is never set by a " +
      "caller, and a request naming a thread here is a `400` — and it is **user-only**, refused " +
      "for an agent actor. A detached document may be claimed again by a later write that names " +
      "a job, so this is a correction rather than a lock.",
  });

// The `422`'s shape lives in `./error.ts` with the rest of the `ApiError`
// union: a client that narrows on `code` has to be able to reach it, and a
// refusal outside the union is the one a caller cannot handle generically.
// The `422`'s shape lives in `./error.ts` with the rest of the `ApiError` union
// and is **not** re-exported here: `error.ts` carries the stale-key refusal,
// which carries a whole `Doc`, so `error → doc → provenance → error` is a cycle
// — and its symptom is not an import error but a half-initialised schema
// ("Invalid element at key `origin`: expected a Zod schema") at every route
// registration. Import it from `./error.js`.
