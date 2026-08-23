import { z } from "@hono/zod-openapi";
import type { Actor } from "../actor.js";
import type { DocStatus } from "./doc.js";
import { EventIdSchema, ThreadIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * **Reflection is an act over the whole corpus, never a side effect of one
 * change** (SPEC.md §7, rider 9 signed 2026-08-22).
 *
 * One event, one field, two routes. A stage moved, a status flipped, a tag, a
 * move, an archive: none of these enqueues anything. What reaches the agent is
 * `workspace.reflect`, carrying one timestamp — the corpus's last reflection —
 * and the agent gathers the window itself.
 *
 * The two routes are the ask and the clock. They are separate because they
 * answer different questions and are read by different surfaces: the board bar's
 * Reflect control reads the clock on every board load, while the ask happens
 * when somebody presses it.
 */

/** The queue event type a reflection travels as (SPEC.md §7). */
export const WORKSPACE_REFLECT_EVENT_TYPE = "workspace.reflect";

/** `reflect.quiet`'s default, in minutes; `0` disables the automatic path (SPEC.md §7). */
export const DEFAULT_REFLECT_QUIET_MINUTES = 30;

const SINCE_DESCRIPTION =
  "**The window's start**: the `created` time of the corpus's last processed reflection " +
  "(SPEC.md §7). `null` means a corpus that has never been reflected on, and it means " +
  "**everything** — the agent's gather runs with no `--since` rather than with an empty window. " +
  "A failed job leaves the clock where it was, so a retry sees the same window.";

/**
 * The payload of a `workspace.reflect` event: one timestamp and nothing else.
 *
 * **Not a registered component**, and it follows `ResidentDesignatedPayload`
 * exactly: `QueueEvent.payload` is an open record because the *set of types* is
 * open, so no route references a payload shape and a registered name would
 * publish a component nothing points at. The shape is declared here for the
 * server and the CLI to parse against, and stated in `QueueEvent.payload`'s own
 * prose for whoever is reading the generated document.
 */
export const WorkspaceReflectPayloadSchema = z.object({
  since: IsoDateTimeSchema.nullable().describe(SINCE_DESCRIPTION),
});

/**
 * What an ask answers with (SPEC.md §7: "an ask while one is pending is answered
 * with the pending one, never doubled").
 *
 * `202`, and never a `409`: a second ask is not a mistake to correct, it is the
 * same request arriving twice, and the honest answer is the event that is
 * already going to run. `pending` is what tells the two apart, so a client can
 * say "asked" or "already asked" without comparing ids against something it may
 * not have.
 */
export const ReflectAskResultSchema = z
  .object({
    eventId: EventIdSchema.describe(
      "The `workspace.reflect` event that will run — newly enqueued when nothing was pending or " +
        "in progress, and otherwise the one already there.",
    ),
    since: IsoDateTimeSchema.nullable().describe(SINCE_DESCRIPTION),
    pending: z
      .boolean()
      .describe(
        "**True when this ask enqueued nothing** and `eventId` names a reflection that was " +
          "already pending or in progress. Ten people pressing Reflect produce one reflection " +
          "(SPEC.md §7), and the tenth is told so rather than refused: retrying cannot help, and " +
          "the thing they wanted is already happening. False when this ask is what created the " +
          "event.",
      ),
  })
  .openapi("ReflectAskResult");

/**
 * The clock, and everything the board bar's Reflect control renders from it.
 *
 * `changed` is here rather than derived by the client because the count is the
 * whole corpus and a client that derived it would be listing every document to
 * produce one number. It is the same predicate the UI applies row by row —
 * literally the same, {@link isUnreflected} — so the corpus count and the marks
 * on the rows cannot disagree.
 */
export const ReflectStatusSchema = z
  .object({
    reflected: IsoDateTimeSchema.nullable().describe(
      "**The clock** (SPEC.md §7): the `created` time of the last reflection whose job was " +
        "processed, held as server state in `.corpus/`. `null` for a corpus never reflected on. " +
        "A failed job leaves it, so a retry sees the same window.",
    ),
    pending: EventIdSchema.nullable().describe(
      "The `workspace.reflect` event currently pending or in progress, or `null` when none is. " +
        "It is what makes the Reflect control say *reflecting…* rather than offering to ask " +
        "again, and it is the id `POST /api/workspace/reflect` answers with while it is set.",
    ),
    changed: z
      .number()
      .int()
      .min(0)
      .describe(
        "**How many documents are unreflected**: those whose `updated` is later than `reflected`, " +
          "**whose last write was not the agent's** (`lastActor` is not `agent`, SPEC.md §7 — the " +
          "changelog entries and digest a reflection produces are its output, not new work for " +
          "it), and which are **not archived** (an archived document shows on no board, so a mark " +
          "for it is impossible, and the agent's own gather sees archives at the next reflection " +
          "with `--include-archived`). With no clock yet, every document meeting the other two " +
          "conditions counts. It is **the same predicate the UI applies row by row** — the " +
          "`isUnreflected` this package exports — so the corpus count and the marks on the rows " +
          "cannot disagree. It rides here rather than being derived by a client because deriving " +
          "it means listing the whole corpus to produce one number.",
      ),
    lastDigest: ThreadIdSchema.nullable().describe(
      "The standalone **digest thread** of the most recent reflection (SPEC.md §7), so " +
        '"reflected 2h ago" links to what was said. `null` until one exists. A reflection with ' +
        "nothing to say still posts its thread, in one line, so this is null only before the " +
        "first reflection lands.",
    ),
    quiet: z
      .number()
      .int()
      .min(0)
      .describe(
        "The configured quiet window in **minutes** (`reflect.quiet`, SPEC.md §7; default " +
          `${String(DEFAULT_REFLECT_QUIET_MINUTES)}). The server enqueues a reflection by itself ` +
          "when something changed after the clock, nothing has changed for this long, and no " +
          "reflection is pending or running — so ten changes in five minutes are one reflection, " +
          "this long after the last. **`0` disables the automatic path** and leaves asking as the " +
          "only way one happens.",
      ),
  })
  .openapi("ReflectStatus");

/**
 * **Is this document unreflected?** — SPEC.md §7's rule, shipped rather than
 * described twice (CONTRACT-076).
 *
 * Two features need it and they must agree: `GET /api/workspace/reflect`'s
 * `changed` counts the set server-side, and the board marks each row that is in
 * it (UI-153). A rule each of them derived for itself would be a rule that holds
 * in one of them — which is why this joins `findFormFence` and `isAgentPresent`
 * as behaviour this package ships. It passes the same test those did: it needs a
 * value the wire publishes (`lastActor`, `updated`, `status`, and the clock) and
 * it has more than one consumer.
 *
 * Three exclusions, each for its own reason:
 *
 * - **The agent's own writes never count** (§7's amendment, signed 2026-08-22).
 *   What a reflection produces is its output, not new work for it.
 * - **An archived document never counts.** It shows on no board, so a mark for
 *   it is impossible, and the agent's own gather sees archives at the next
 *   reflection with `--include-archived` (decided at PR #56's review).
 * - **An unknown `updated` is not a change.** A hand-written skill file
 *   legitimately carries no timestamp, and the staleness ramp already treats an
 *   unknown age as fresh rather than as ancient; treating it as changed would
 *   mark it on every board forever.
 *
 * A `reflected` of `null` — a corpus never reflected on — means everything else
 * counts, which is the same reading `since: null` has on the event.
 */
export function isUnreflected(
  document: { updated: string | null; lastActor: Actor; status: DocStatus },
  reflected: string | null,
): boolean {
  if (document.lastActor === "agent") return false;
  if (document.status === "archived") return false;
  if (document.updated === null) return false;
  if (reflected === null) return true;
  const updatedAt = Date.parse(document.updated);
  const reflectedAt = Date.parse(reflected);
  if (Number.isNaN(updatedAt) || Number.isNaN(reflectedAt)) return false;
  return updatedAt > reflectedAt;
}

export type WorkspaceReflectPayload = z.infer<typeof WorkspaceReflectPayloadSchema>;
export type ReflectAskResult = z.infer<typeof ReflectAskResultSchema>;
export type ReflectStatus = z.infer<typeof ReflectStatusSchema>;
