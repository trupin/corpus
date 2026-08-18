import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { DesignateResidentRequestSchema } from "../schemas/agents.js";
import { ThreadIdSchema } from "../schemas/id.js";
import { ThreadMutationResponseSchema } from "../schemas/thread.js";
import {
  CONFLICT_RESPONSE,
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * Designation and release (SPEC.md §7, rider SHARED-043 signed 2026-08-13).
 *
 * ## Two routes rather than a field on `PUT`
 *
 * A resident is thread state, so the obvious shape is a field on a thread
 * update — except there is no thread update: a thread's status moves through
 * `resolve`/`reopen`, its anchor through `reattach`, and each is a route because
 * each is an *act* with its own actor rule and its own refusals. Designation has
 * all three: it is user-only, it is refused on a thread that may not have a
 * resident, and it enqueues an event. It follows `thread-reattach.ts`'s shape
 * for exactly that reason.
 *
 * `POST` sets, `DELETE` releases. A single `POST` taking `{name: null}` would
 * have made `null` mean "release" on a field where `null` already means "there
 * is nobody", and §7 is emphatic that dissolving is the **absence** of a
 * resident and never a third state.
 *
 * That split is what lets the `POST` body be **optional in full** since
 * SHARED-048: a bare `POST` designates a general resident, and cannot be
 * mistaken for a release, because a release is a different verb on this path.
 * Naming a profile is the refinement, not the act.
 *
 * ## User-only, like the rest of §9.2's user-only family
 *
 * §7: designation is *"user-only state on the thread, set and released like any
 * other thread field"*. `403` for `x-corpus-author: agent`, the same mechanism
 * turn deletion and re-attachment use. The reason is not ceremony: a resident is
 * an agent claiming a conversation and everything that grows out of it, and an
 * agent that could designate itself — or designate another agent — would be
 * choosing who answers a person's messages. The acting party still travels on
 * the request and still becomes the git author, so `git log` shows the
 * designation as a person's act.
 *
 * ## Why both answer with the thread
 *
 * Designating and releasing each rewrite the thread file's frontmatter and
 * auto-commit it, so both can raise §14's warnings — a workspace git hook that
 * rejects the commit leaves the change on disk and uncommitted, and §14 requires
 * that to surface on the response rather than in a log. That is precisely the
 * argument `ThreadMutationResponseSchema` was created for on `resolve`/`reopen`,
 * and it applies here unchanged, so the release answers `200` with the thread
 * rather than a bare `204`: a `204` would have made the one outcome that must be
 * visible unreportable. The response also carries the resolved resident, so a
 * caller never repeats the name lookup.
 */

const ThreadIdParamSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

export const designateResident = createRoute({
  method: "post",
  path: "/api/threads/{id}/resident",
  tags: ["threads"],
  summary: "Designate a thread's resident agent (user-only)",
  description:
    "Gives a **standalone** thread a resident: a long-lived agent that owns that conversation and " +
    "everything that grows out of it, rather than being dispatched to one message at a time " +
    "(SPEC.md §7). From then on, work falling in that thread's **scope** — the thread, every " +
    "thread whose parent chain reaches it, every document whose `origin` reaches it, and every " +
    "thread on such a document — is enqueued on that scope's lane instead of the orchestrator's." +
    "\n\n" +
    "**The body is optional in full: a bare `POST` designates a *general resident*** — an agent " +
    "with no persona document, working the conversation as the workspace's ordinary agent does. " +
    "§7 calls that the ordinary case, and it requires nothing to exist in the workspace first, so " +
    "a fresh workspace with no `agent-def` documents can designate on its first day.\n\n" +
    "**Naming a profile is the refinement.** `name`, when given, is the invocable name " +
    "`@<subagent>` mentions already use (SPEC.md §8) — for a `type: agent-def` document **under " +
    "`.claude/agents/`**, its filename stem or its title, case-insensitively, never a document " +
    "id — and is how a conversation gets an agent that behaves differently from the default. " +
    "`404` when the thread is unknown, and `404` when the name resolves to no such document: a " +
    "name that misses is refused rather than degraded to a general resident, because a typo that " +
    "looked like it worked is the worse outcome. An `agent-def` filed outside that root is one of " +
    "those misses — it is a document *about* a persona, nothing loads it as a subagent, and it " +
    "answers to neither spelling — and where an off-root `agent-def` is titled the name given, " +
    "that `404` names its path, because moving the file into `.claude/agents/` is what makes it " +
    "designatable. **Only the title reaches that refusal**: off root there is no filename stem to " +
    "answer to, so `legacy-analyst` for a document titled `Legacy Analyst` in the inbox is the " +
    'bare `404` — its title is the spelling that says where it is. A **blank** name (`""`, `"   "`) ' +
    "is a `400` and not absence, for the same reason.\n\n" +
    "**Everything else about a resident is identical either way** (SPEC.md §7) — the lane, the " +
    "scope, presence, the lapse fallback, release, and resolution releasing it — because a " +
    "profile says *how* the agent works and nothing about *what it owns*. The response carries " +
    "the resolved `Resident`, whose `name` is null for a general one and whose `docId` is null " +
    "when there is no profile document to point at, so the caller never repeats the lookup.\n\n" +
    "**Single-valued, so designating again replaces.** A thread has one resident or none, and " +
    "nothing has to arbitrate between two; designating a thread that already has one is a " +
    "replacement rather than a `409`. What is refused is designating a thread that may not have a " +
    "resident at all: `409` for a thread with a parent — anchored or whole-document — because a " +
    "thread on a document is *about* that document, and a resident owns a conversation rather " +
    "than a passage.\n\n" +
    "**User-only**: a request carrying `x-corpus-author: agent` is rejected with `403`. A resident " +
    "claims a conversation and every artifact that grows out of it, and an agent that could " +
    "designate would be choosing who answers a person's messages (SPEC.md §7 — designation is " +
    "user-only state).\n\n" +
    "**It enqueues `resident.designated`, on the orchestrator's lane whoever is designated** — the " +
    "resident does not announce itself to itself, one of exactly two carve-outs §7 makes to the " +
    "lane rule. Nothing already queued moves: a lane is stamped once, at enqueue time, and never " +
    "rewritten, so designating does not re-route work the orchestrator is already holding.\n\n" +
    "**One action, one commit** (SPEC.md §4), authored by the acting party. It presents no key " +
    "(SPEC.md §7): it sets one frontmatter field and replaces nothing a reader was holding.",
  request: {
    params: ThreadIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description:
        "Optional in full: omit the body entirely — or send `{}` — to designate a general " +
        "resident, and give `name` to designate a profile.",
      content: { "application/json": { schema: DesignateResidentRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      ThreadMutationResponseSchema,
      "The thread, its `resident` now the resolved `{name, docId}` — both null for a general " +
        "resident — and any warnings raised while writing it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});

export const releaseResident = createRoute({
  method: "delete",
  path: "/api/threads/{id}/resident",
  tags: ["threads"],
  summary: "Release a thread's resident agent (user-only)",
  description:
    "Releases the thread's resident, returning its scope to ordinary routing (SPEC.md §7). " +
    "Nothing is rewritten: events already stamped keep the lane they were stamped with, and " +
    "everything enqueued afterwards routes as it did before there was a resident. Dissolving is " +
    "the **absence** of a resident, never a third state.\n\n" +
    "**Idempotent.** Releasing a thread that has no resident is a `200` that changes nothing, " +
    "writes nothing and commits nothing — the caller often cannot know, and a release with " +
    "nothing to release is a no-op rather than an error. It answers with the thread rather than a " +
    "bare `204` because a release that *does* write can raise §14's warnings, and a rejected " +
    "auto-commit has to be visible somewhere.\n\n" +
    "**User-only**: `403` for `x-corpus-author: agent`, exactly as designating is — release is the " +
    "other half of the same user-only state, and an agent able to release could quietly stop " +
    "being resident in a conversation a person put it in.\n\n" +
    "**Resolving a thread releases its resident too** (SPEC.md §7): a settled conversation has " +
    "nobody to keep resident, so `POST /api/threads/{id}/resolve` does this as part of resolving. " +
    "**Reopening does not bring it back** (SPEC.md §8) — the conversation resumes on the " +
    "orchestrator's lane, and designating again is a deliberate act, as the first designation " +
    "was.\n\n" +
    "`404` when the thread is unknown. It presents no key (SPEC.md §7): it clears one frontmatter " +
    "field and replaces nothing a reader was holding.",
  request: { params: ThreadIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      ThreadMutationResponseSchema,
      "The thread, its `resident` now null, and any warnings raised while writing it. Unchanged " +
        "when there was no resident to release.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
