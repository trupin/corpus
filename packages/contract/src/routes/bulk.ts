import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { BulkActionRequestSchema, BulkActionResultSchema } from "../schemas/bulk.js";
import {
  FORBIDDEN_RESPONSE,
  jsonContent,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * SPEC.md §4's "One action, one commit" and §11's bulk mode — a column's staged
 * set, and the Save that applies it — as one route. Why one route rather than
 * eight, why a staged row is an id rather than a filter, why the whole-result-set
 * selection is the one entry that is a query, and why partial failure is a `200`
 * are argued at the point of definition in `../schemas/bulk.ts`; what follows is
 * what belongs to the *route*.
 *
 * **The commit rule has two sides, and both need saying here** — the contract
 * cannot enforce either, and this description is where the server implementation
 * reads them. §4: a bulk commit "never folds into a preceding editing session's
 * squashed commit, **and no later save folds into it**". Those are different
 * mechanisms — the first is opting the bulk plan out of squashing, the second is
 * ending the squash session on the bulk commit so a subsequent save cannot amend
 * it — and each failure erases the action from the history *as an act*, which is
 * the one thing §4 asked for. A bulk archive landing inside someone's autosave
 * commit, or someone's next keystroke folding into a bulk archive, both make
 * `git revert <that commit>` stop meaning "undo the action".
 *
 * **A mixed Save is one commit, and that is now signed text rather than an
 * inference** (SHARED-032, 2026-08-09). §4: "A Save carrying a mix of verbs is
 * still one act and still one commit — archiving three documents and resolving
 * two is one pass, so it is one commit, not one per verb; anything else would
 * make the history disagree with the single report §11 requires." The server
 * implementation may not group the staged set by verb and write once per group,
 * and the fact that this route accepts the mix in one request is what removes the
 * excuse.
 *
 * **The three-part result and the commit's file list are one computation**, and
 * the agreement between them runs one way. They are not two answers that might
 * disagree: §11 puts it as "the history agrees with it (§4)", and concretely
 * every document `changed` names has a file in `git show --name-only <commit>`.
 * Not the converse — a commit may legitimately carry files for documents the act
 * never named. The description below states both ways that happens today and why
 * each follows from the same rule; `../schemas/bulk.ts` argues it at the point of
 * definition.
 *
 * **Routing.** `/api/docs/bulk` is a static segment where `/api/docs/{id}`
 * carries a parameter. Nothing competes today — no `POST /api/docs/{id}` exists,
 * and `bulk` matches neither id prefix (`doc_`/`th_`) — but the failure mode of
 * getting this wrong is silent misrouting, so it is registered *before* the
 * parameterised peers in `./index.ts` and the order is held by a test, exactly
 * as `/api/locks/reap` is.
 */
export const applyBulkAction = createRoute({
  method: "post",
  path: "/api/docs/bulk",
  tags: ["docs"],
  summary: "Apply a column's staged set — one action per document — as a single act",
  description:
    "Applies a **staged set** to several documents and answers for all of them — the board makes " +
    "one request per Save, never one per document and never one per verb. **Each entry carries " +
    "its own action** (SPEC.md §11: in bulk mode each row carries its own staged action), so " +
    "archiving three documents and resolving two is one request. **The act lands as a single " +
    'auto-commit** (SPEC.md §4, "One action, one commit"), authored by the acting party like ' +
    "any other mutation: archiving twenty documents is one commit, not twenty, so reverting the " +
    "action is one `git revert` and `git log` never records an effect the user was told did not " +
    "happen. §4 is explicit that this survives a mixed set — **a Save carrying a mix of verbs is " +
    "still one act and still one commit**, not one commit per verb — so grouping the staged set " +
    "by verb and writing each group is wrong even though it would produce the same files. " +
    "**Every document `changed` names has a file in that commit**, and `git show " +
    "--name-only` lists it: only a write that landed puts an id in `changed`, and only those " +
    "writes are staged, so a document that was refused or was already in the target state wrote " +
    "nothing **of its own**. Its files may still be in the commit, carried there by another " +
    "document's act — archiving a skill that nests a second requested skill moves the nested " +
    "one's file while refusing it by id. That containment is the invariant, and it holds in one " +
    "direction only — **the commit may also carry files for documents the act did not name**, " +
    "because the result's three parts partition the **requested** ids and nothing else. Two " +
    "things do that today, both required by the spec rather than incidental, and both shared " +
    "with the single-document routes: §6's anchor cascade rewrites the `anchors` map of a " +
    "deleted thread's parent in the same commit, and that parent survives the act and need not " +
    "even have been requested; and archiving or unarchiving a skill moves its whole folder, " +
    "carrying every file under it — including the `SKILL.md` of a nested skill, which the move " +
    "disables (§7: what disables a skill is where its folder lives) without the act ever naming " +
    "it. The commit message names the actions the act carried and the documents each one " +
    "changed. It is its own entry in the history: it never folds into a preceding editing " +
    "session's squashed commit, and no later save folds into it (§4's squashing is about " +
    "repeated saves of *one* document, never about one act across many). An implementation that " +
    "loops the single-document write path is therefore wrong rather than merely slower — it " +
    "produces N commits and has nothing honest to put in `commit`.\n\n" +
    "**A whole-result-set selection is one entry, not a list of ids.** §11: because there is no " +
    "per-row gesture for rows nobody enumerated, such a selection stages as a **single entry** " +
    "carrying one action for everything the column's query matches. `wholeResultSet` is that " +
    "entry — at most one, beside any number of enumerated `entries` — and **the count is " +
    "re-evaluated when the Save runs**, not when it was staged, which is why it travels as a " +
    "query rather than as ids the caller resolved earlier. It covers everything the query " +
    "matches **except** the ids `entries` names individually, so no document is ever acted on " +
    "twice and a hand-staged row keeps the verb the person chose. **`delete` cannot be spelled " +
    'on it at all** (§11: "all 412 matching" is not a set anyone read before confirming), which ' +
    "is a type error in the generated client rather than a runtime refusal. The ids it resolves " +
    "to appear in the result like any other, which is the only place the caller learns them.\n\n" +
    '**Partial application is the normal case, and it is a `200`.** §11: a Save "applies ' +
    'to what it can and reports what it could not" and "never refuses the whole set because of ' +
    'one document". The result states three parts — what `changed`, what was `alreadyInState` ' +
    "(a document already archived is a no-op, **not** a failure), and, listed apart from both, " +
    "what was `refused` and why, each named individually **with the verb that applied to it**. A " +
    "document locked by the other party is refused with its holder named (SPEC.md §7) exactly as " +
    "a single edit to it would be; one that fails validation is refused with its reason (§14); " +
    "an unknown id is refused as `not-found`; a row the act does not apply to is refused as " +
    "`not-applicable`; the rest go through. There is no `423` on this route and no `404`: a lock " +
    "and an unknown id are per-document outcomes here, not verdicts on the request. Every " +
    "requested id appears exactly once across the three parts, so the caller can compare the " +
    "total against the count it showed.\n\n" +
    "**`delete` is user-only** (SPEC.md §7, §9.2): a Save carrying a `delete` entry with " +
    "`x-corpus-author: agent` is rejected with `403` for the **whole request** — the refusal is " +
    "the request's, not a per-document outcome — exactly as `DELETE /api/docs/{id}` rejects it. " +
    "The agent archives, never deletes. Every other act is available to both parties.\n\n" +
    "**A `400` answers a staged set that cannot be applied as written**: nothing staged at all " +
    "(no `entries` and no `wholeResultSet`), or one id staged twice. §11 makes a row carry " +
    "exactly one staged action, so a repeated id means the staged set was keyed wrong; where the " +
    "two entries name different verbs the message says both, because choosing one silently would " +
    "be a choice about someone's documents and applying both would write one document twice " +
    "inside an act that promises to be one commit of exactly what changed. Every document " +
    "already being in the target state is a different thing entirely — a legal, successful act " +
    "that changes nothing and therefore makes **no commit at all**: `200`, empty `changed`, null " +
    "`commit`. The single-document routes are unchanged and remain the " +
    "path for the reader's ⋯ menu and per-row quick actions (§11) — this route is for a " +
    "selection, and the difference between them is the commit.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The staged set: the individually staged rows, each with its own act, and optionally " +
        "§11's single whole-result-set entry. `entries` is mandatory, so the body is too.",
      content: { "application/json": { schema: BulkActionRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      BulkActionResultSchema,
      "What changed, what was already in that state, what did not change and why — each named " +
        "with the verb that applied to it, plus the single commit the act landed as, and any §14 " +
        "warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
  },
});
