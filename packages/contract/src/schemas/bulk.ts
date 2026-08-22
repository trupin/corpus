import { z } from "@hono/zod-openapi";
import { ViewQuerySchema } from "./doc.js";
import { DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { warningsField } from "./warning.js";

/**
 * **One action, one commit** (SPEC.md §4; §10's "Selecting rows, and acting on
 * the selection") — the shapes behind `POST /api/docs/bulk`.
 *
 * ## Why this route exists at all
 *
 * Every single-document mutation route takes one `{id}`, so a board with no
 * batch route archives twenty documents with twenty requests, and the
 * auto-committer's fold decision keys on the same `docId` and actor — so twenty
 * archives of twenty *different* documents can never fold into one commit. They
 * are twenty commits by construction, which is precisely what §4 forbids:
 * "archiving twenty documents is one commit, not twenty", so that reverting the
 * action is one `git revert` and `git log` and the on-screen report say the same
 * thing. Without a way to ask for several document mutations as **one act**, §4
 * is a promise the UI cannot keep.
 *
 * ## What SHARED-032 changed, and what it did not (CONTRACT-048)
 *
 * The rider signed 2026-08-09 made board selection a **mode** in which *each row
 * carries its own staged action*, applied by a **Save** which is the only thing
 * that writes. §4 was amended in the same breath and is explicit about the
 * consequence: "**A Save carrying a mix of verbs is still one act and still one
 * commit** — archiving three documents and resolving two is one pass, so it is
 * one commit, not one per verb; anything else would make the history disagree
 * with the single report §10 requires."
 *
 * CONTRACT-037 shipped this request as `{ids, action}` — *one* verb over *many*
 * ids — which cannot say that. The alternative the user weighed and rejected at
 * sign-off was for the board to group its staged set by verb and send one
 * request per group: that is several commits, which is the exact outcome §4
 * forbids and the outcome this route was built to prevent. So the request now
 * carries **pairs**: {@link BulkActionRequestSchema}`.entries` is a list of
 * `{id, action}`, one per staged row, and the whole list is one act and one
 * commit whatever mix of verbs it holds.
 *
 * Everything CONTRACT-037 argued *below* the request shape is unchanged and is
 * not re-derived here: one route with an act discriminator rather than eight
 * routes, threads riding this route rather than a second batch path under
 * `/api/threads`, `commit` being one nullable sha, partial failure being a `200`,
 * and the commit containment running in one direction only. Those reasons are
 * restated at their points of definition below.
 *
 * ## One route with an act discriminator, not one route per act
 *
 * Both are defensible and the next reader will ask, so: the value of this
 * surface is concentrated in two rules that are identical for every act — a
 * bulk act is exactly one commit containing exactly what changed, and its result
 * is §10's three parts. Per-act routes would restate both eight times, and eight
 * restatements are eight opportunities to drift; a server would then be free to
 * implement one of them by looping the single-document path without any
 * declaration contradicting it. The acts differ only in their parameters, which
 * is exactly what a discriminated union is for. Per-act routes fare *worse*
 * under SHARED-032 than they did before, because a mixed Save would then be
 * several requests by construction. The single-document routes are untouched and
 * stay the path for the reader's ⋯ menu and per-row quick actions (§10) — this
 * route is for a *selection*, and the distinction is the commit.
 *
 * **Threads ride here too, rather than getting a second batch path.** Resolve
 * and Reopen act on threads, whose single-document routes live under
 * `/api/threads/{id}` — but a thread is a document (§6), `status` is a core
 * document field (§5), and the collection route `GET /api/docs?type=thread` is
 * already the thread list. This route addresses documents by id and answers in
 * ids, so nothing thread-shaped is needed in either direction. §10 no longer
 * requires a selection to be homogeneous — "an action is offered on the rows
 * that can take it and is simply absent on the rows that cannot, so a list
 * holding notes and threads offers Resolve on the threads alone" — which makes
 * one route carrying both *more* necessary, not less: a mixed list is now a
 * single Save. Two batch paths would mean two commit rules.
 *
 * ## Ids, and the one entry that is not an id
 *
 * Enumerated ids remain the shape of a staged row: a row is a document the
 * person looked at and chose a verb for. §10 keeps one selection that is not
 * enumerable — "a second, separately labelled act extends the selection to
 * **everything the query matches**" — and it is explicit about how that stages:
 * "Because there is no per-row gesture for rows nobody enumerated, **a
 * whole-result-set selection stages as a single entry** — one line reading what
 * it covers and how many, carrying one action for all of them." So the request
 * carries at most one such entry ({@link BulkWholeResultSetEntrySchema}) beside
 * the enumerated ones, and it is a field of its own rather than a member of
 * `entries`: at most one is then structural rather than a rule someone has to
 * remember, and §10's "a whole-result-set selection cannot be deleted" becomes
 * inexpressible instead of merely forbidden.
 *
 * CONTRACT-037 decided "ids, never a filter" and that decision is **narrowed
 * here, not reversed**: a filter still cannot stand in for enumerated rows, and
 * the one thing it may express is the one selection §10 says has no enumerated
 * form. §10's "the result reports the documents actually changed — saying so
 * when that differs from the number shown" is then the caller comparing the
 * count it displayed against {@link BulkActionResultSchema}, which is where that
 * comparison belongs: only the caller knows what number it showed.
 *
 * ## Partial failure is the normal case, not the error path
 *
 * A bulk act answers `200` when some documents changed and some did not. It is
 * not a `207`-shaped puzzle and not a `4xx`: a document that moved under the
 * staged set is routine (the agent writes while a person stages), so
 * all-or-nothing would fail the user's action for reasons that have nothing to
 * do with the other nineteen documents —
 * and "refuse the whole set" over twenty files is a guarantee the write path
 * cannot give without either checking everything first and racing anyone who
 * edits one in between, or writing some and rolling them back, a rollback that
 * itself commits.
 *
 * A **malformed staged set** is the opposite case and is a `400` for the whole
 * request: nothing staged at all, or one id staged twice. Those are caller bugs
 * the caller can fix by sending a different body, which is exactly what a `400`
 * means — see {@link BulkActionRequestSchema}.
 */

/**
 * The acts §10 offers on a selection, minus the one that needs nothing here:
 * "Ask the agent about these" creates one standalone thread whose first turn
 * references every selected document, through the existing `POST /api/threads`,
 * and changes none of them — which is why §10 keeps it available whatever the
 * rest of the Save could not do.
 *
 * Two of these have no dedicated single-document route either: `tag` and
 * `review` are keys of `UpdateDocRequest` on `PUT /api/docs/{id}`. They are
 * named acts here rather than a batched partial update on purpose — a batched
 * `UpdateDocRequest` would let one request set twenty documents' titles to the
 * same string, and §10 offers no such action.
 */
export const BULK_ACTION_NAMES = [
  "archive",
  "unarchive",
  "resolve",
  "reopen",
  "move",
  "tag",
  "review",
  "delete",
] as const;

/**
 * The acts a **whole-result-set** entry may carry: every one except `delete`.
 * §10: "Bulk delete is offered **only** on a selection whose documents are
 * enumerated — a whole-result-set selection cannot be deleted, because 'all 412
 * matching' is not a set anyone read before confirming." Published as a narrower
 * union rather than enforced by a refinement, so the restriction is a *type*
 * error in the generated client rather than a runtime `400` somebody discovers.
 */
export const BULK_WHOLE_RESULT_SET_ACTION_NAMES = BULK_ACTION_NAMES.filter(
  (name) => name !== "delete",
);

export const BulkActionNameSchema = z.enum(BULK_ACTION_NAMES).openapi({
  description:
    "Which act was applied to **this** document. Carried per document rather than once per " +
    "request because a Save may hold a mix of verbs (SPEC.md §4, §10: each row carries its own " +
    "staged action), so the report reads on its own and never has to be paired back to the call " +
    "that produced it — including for documents a `wholeResultSet` entry covered, which the " +
    "caller never enumerated. The eight are SPEC.md §10's selection actions except " +
    '"Ask the agent about these", which changes no document and goes through `POST /api/threads`.',
  example: "archive",
});

const FOLDER_DESCRIPTION =
  "Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the " +
  "full prefix (`data/docs/finance`) — the same spelling `POST /api/docs/{id}/move` takes. Each " +
  "document keeps its id, so every `[[ref]]`, anchor entry and thread `parent` survives the move.";

/**
 * Tagging is a **delta**, and the shape is what makes that non-negotiable: §10
 * says tagging "adds or removes the named tags and never replaces a document's
 * tag set", and a `tags: [...]` key here would flatten twenty different tag sets
 * into one with no way for a caller to notice. There is deliberately no way to
 * express a replacement on this route; a single document's tag set is replaced
 * through `PUT /api/docs/{id}`, one document at a time, which is where naming an
 * exact set is meaningful.
 *
 * `add` and `remove` are both optional so a caller names only the half it means,
 * and the refinement requires at least one tag between them: an act that adds
 * nothing and removes nothing is a caller bug, and answering it with a
 * successful no-op would let a broken menu look healthy.
 */
const TAG_ACTION_MESSAGE =
  "`tag` is a delta: give `add`, `remove`, or both, and at least one tag between them. There is " +
  "no replace — SPEC.md §10 is explicit that tagging adds or removes the named tags and never " +
  "replaces a document's tag set.";

const tagList = z
  .array(z.string().min(1))
  .describe("Tag names. Empty strings are rejected — an empty tag name names nothing.");

/**
 * The seven acts available everywhere, in {@link BULK_ACTION_NAMES} order.
 * `delete` is deliberately not among them; it joins them in
 * {@link BulkActionSchema} and is absent from {@link BulkWholeResultSetActionSchema}.
 */
const SHARED_ACTS = [
  z
    .strictObject({ action: z.literal("archive") })
    .describe(
      "Flip `status` to `archived` (SPEC.md §7) — reversible, never a deletion. A document " +
        "already archived is a no-op, not a failure.",
    ),
  z
    .strictObject({ action: z.literal("unarchive") })
    .describe("The inverse flip, back to `status: open`."),
  z
    .strictObject({ action: z.literal("resolve") })
    .describe(
      "Set `status: resolved` on threads (SPEC.md §6). Later turns stop re-triggering the agent. " +
        "A document that is not a thread is refused with `not-applicable` rather than acted on — " +
        "§10 offers Resolve on the threads alone, so a mixed list stages it only where it applies.",
    ),
  z
    .strictObject({ action: z.literal("reopen") })
    .describe("Set `status: open` again on resolved threads."),
  z
    .strictObject({
      action: z.literal("move"),
      folder: z.string().min(1).describe(FOLDER_DESCRIPTION),
    })
    .describe("Move the document to this folder. Ids never change."),
  z
    .strictObject({
      action: z.literal("tag"),
      add: tagList
        .optional()
        .describe(
          "Tags to add where absent. Adding a tag a document " +
            "already carries is a no-op for that document, not a failure.",
        ),
      remove: tagList
        .optional()
        .describe(
          "Tags to remove where present. Removing a tag a " +
            "document does not carry is a no-op for that document, not a failure.",
        ),
    })
    .refine(({ add, remove }) => (add?.length ?? 0) + (remove?.length ?? 0) > 0, {
      message: TAG_ACTION_MESSAGE,
      path: ["add"],
    })
    .describe(TAG_ACTION_MESSAGE),
  z
    .strictObject({ action: z.literal("review") })
    .describe(
      'Record "still current" (SPEC.md §5) by setting `reviewed` to the moment the act runs — a ' +
        "committed act distinct from editing. It is never already-in-state: it writes a new " +
        "instant every time, which is the whole point of confirming freshness.",
    ),
] as const;

const DELETE_ACT = z
  .strictObject({ action: z.literal("delete") })
  .describe(
    "**User-only** (SPEC.md §7, §9.2): a request carrying `x-corpus-author: agent` is rejected " +
      "with `403` for the whole request, not per document — the agent archives, never deletes. " +
      "Each deleted document's threads become orphaned records, totalled in " +
      "`orphanedThreadIds`. Unlike archiving it cannot be undone from the app; git is the only " +
      "recovery. Available on an **enumerated** entry only: §10 forbids deleting a " +
      "whole-result-set selection, so `wholeResultSet.action` cannot spell it.",
  );

/**
 * The act, and only the act: which one, plus whatever that one needs. The id it
 * applies to sits beside it on {@link BulkStagedEntrySchema} rather than inside
 * each member, so the discriminator carries no repetition and a caller reading
 * the union sees eight parameter lists rather than eight copies of an id.
 *
 * Every member is strict, like every request body (CONTRACT-017): a typo
 * (`{action: "tag", ad: ["q3"]}`) is a `400` naming the key rather than a
 * successful act that tagged nothing.
 *
 * **Deliberately not registered as a named component**, and neither are its
 * members — the rule `ContextPackSchema` follows, for the same reason:
 * zod-to-openapi renders a discriminated union as a `oneOf` with no
 * `type: "object"`, and `src/openapi.test.ts`'s "every named component is a
 * plain, non-nullable, undefaulted object" invariant is the guard that catches a
 * derived schema silently rewriting a shared one. The context pack registers its
 * five *variants* and inlines the union; here even the variants stay inline,
 * because these are one- and three-key parameter lists rather than substantial
 * shapes, and eight component names carrying `{action: "unarchive"}` would be
 * noise in the document and in the generated client.
 */
export const BulkActionSchema = z.discriminatedUnion("action", [...SHARED_ACTS, DELETE_ACT]);

/**
 * The same union minus `delete`, for the one entry §10 will not let anyone
 * delete through. Narrowing the *type* rather than adding a refinement is the
 * point: `{query, action: {action: "delete"}}` is a call nobody can write, so
 * the restriction cannot be discovered at runtime by someone who tried it on 412
 * documents.
 */
export const BulkWholeResultSetActionSchema = z.discriminatedUnion("action", SHARED_ACTS);

const ENTRY_ACTION_DESCRIPTION =
  "The act staged against this one document, discriminated on `action`. **Each row carries its " +
  "own** (SPEC.md §10): archiving three documents and resolving two is one Save, so a request " +
  "may hold any mix of verbs and is still one act and one commit (§4).";

const ENTRIES_DESCRIPTION =
  "The individually staged rows — one entry per document, each carrying its own act. **An id " +
  "may appear at most once**: a row carries exactly one staged action (SPEC.md §10 — " +
  "re-choosing *replaces* a row's staged action), so a repeat is a caller bug rather than " +
  "something to resolve. Two entries for one id with **different** acts are refused naming both, " +
  "because picking one would be a silent choice about someone's documents; two with the same act " +
  "are refused too, and the message says which id. May be empty **only** when `wholeResultSet` " +
  "is present — an act on nothing is a caller bug, and a `200` carrying three empty lists would " +
  "let a broken board look healthy. Deliberately uncapped: a column's query legitimately matches " +
  "thousands, and a limit the spec does not state would refuse a selection §10 allows the board " +
  "to offer.";

const WHOLE_RESULT_SET_DESCRIPTION =
  "§10's whole-result-set selection, staged as a **single entry** carrying one action for " +
  "everything the column's query matches rather than for enumerated ids. At most one — the field " +
  'is singular rather than a member of `entries`, so "at most one" is structural and ' +
  "`delete` is inexpressible. Omit it for an ordinary staged set, which is the common case. The " +
  "ids it resolves to are not in the request, so the result's three parts are the only place the " +
  "caller learns them.";

/**
 * One staged row: the document, and the verb staged against it.
 *
 * This pair *is* SHARED-032's change. Under the previous shape the verb lived
 * once per request, which made a mixed Save inexpressible — and the workaround,
 * one request per verb, is several commits, the one thing §4 forbids.
 */
export const BulkStagedEntrySchema = z
  .strictObject({
    id: DocumentIdSchema.describe(
      "The document this row stages an action against. Thread ids belong here too (threads are " +
        "documents, SPEC.md §6), which is what lets `resolve`/`reopen` ride this route.",
    ),
    action: BulkActionSchema.describe(ENTRY_ACTION_DESCRIPTION),
  })
  .openapi("BulkStagedEntry", {
    description:
      "One staged row: the document, and the act staged against it. A request holds any number " +
      "of these and any mix of verbs, and applies them as one act and one commit (SPEC.md §4).",
  });

/**
 * §10's whole-result-set selection, staged as **one entry**: "one line reading
 * what it covers and how many, carrying one action for all of them", which
 * "sits in the staged set beside individually staged rows and is discarded,
 * saved and reported exactly as they are".
 *
 * It carries a query rather than ids because there is no per-row gesture for
 * rows nobody enumerated, and because §10 requires "the count is re-evaluated
 * when the Save runs" — a count re-evaluated by the caller before it sends would
 * be a different promise, and the difference is exactly the documents that
 * entered or left the result set in between.
 *
 * The query is the **column's own query**, in the shape a `type: view` document
 * already stores it and the shape the board already holds in memory: a flat map
 * from `GET /api/docs` parameter names to a value or an array of values. Reusing
 * {@link ViewQuerySchema} rather than declaring a second filter grammar is what
 * keeps "everything the query matches" mean the same thing on both sides of the
 * wire; the server compiles it into the collection query exactly as the board
 * does for `GET /api/docs`.
 *
 * One difference from the stored form, and it matters: a stored view's unknown
 * key "degrades in the client, never on the wire", because a view that renders
 * one chip too few is harmless. Here the query decides which documents get
 * written, so a key or value the collection grammar does not accept is a `400`
 * for the whole request rather than a narrower act nobody asked for.
 */
export const BulkWholeResultSetEntrySchema = z
  .strictObject({
    query: ViewQuerySchema.describe(
      "The column's query, in the same flat parameter map a `type: view` document stores " +
        '(SPEC.md §10) — `{type: ["note", "view"], tag: "finance"}` ≡ ' +
        "`type=note,view&tag=finance`. The server compiles it into `GET /api/docs` and applies " +
        "the act to **everything it matches when the Save runs**, re-evaluated then and not " +
        "before (§10). Unlike a stored view's query an unrecognised key or an unacceptable value " +
        "is a `400` here rather than a silent degrade: this query decides what gets written. " +
        "Documents that `entries` names individually are **excluded** — a row someone staged by " +
        "hand keeps the verb they chose, so no document is ever covered twice and the request " +
        "needs no precedence rule at write time.",
    ),
    action: BulkWholeResultSetActionSchema.describe(
      "The one act carried for everything the query matches. **`delete` is not among them**: §10 " +
        'forbids deleting a whole-result-set selection, because "all 412 matching" is not a set ' +
        "anyone read before confirming. Rows the act does not apply to come back `refused` with " +
        "`not-applicable`, exactly as an enumerated row would.",
    ),
  })
  .openapi("BulkWholeResultSetEntry", { description: WHOLE_RESULT_SET_DESCRIPTION });

/**
 * The staged set, as a Save sends it.
 *
 * **Nothing staged is a `400`.** `entries: []` with no `wholeResultSet` is an
 * act on nothing: a caller bug, and answering `200` with three empty lists would
 * let a broken board look healthy. This is CONTRACT-037's "an empty id list is
 * rejected", restated for the shape that replaced it.
 *
 * **An id staged twice is a `400`, and the message says whether the acts
 * differed.** §10 makes a row carry exactly one staged action — "re-choosing
 * *replaces* a row's staged action" — so the same id twice is a staged set that
 * was keyed wrong. Where the acts differ the request is genuinely ambiguous, and
 * the alternatives are both worse than refusing: last-write-wins picks one
 * silently, and applying both writes a document twice inside an act that
 * promises to be one commit of exactly what changed. This is the one place the
 * shape has *tightened* against CONTRACT-037, which collapsed repeats — and it
 * tightened because the element changed meaning: a repeated member of an `ids`
 * **set** carried no information, while a repeated staged **row** carries a verb
 * that may contradict its twin.
 *
 * A `400` is the honest code for both: dropping or correcting an entry fixes the
 * request, so the caller is not sent in circles (the repo's rule — `409` is for
 * a request the *state* refuses, where no body would help).
 */
export const BulkActionRequestSchema = z
  .strictObject({
    entries: z.array(BulkStagedEntrySchema).describe(ENTRIES_DESCRIPTION),
    // No `.describe()` here on purpose: the field publishes as a bare `$ref`, so
    // a description written at the call site would be hoisted onto the shared
    // component rather than shown beside the field. It lives on the component.
    wholeResultSet: BulkWholeResultSetEntrySchema.optional(),
  })
  .refine(({ entries, wholeResultSet }) => entries.length > 0 || wholeResultSet !== undefined, {
    message:
      "A Save with nothing staged is a caller bug: give at least one entry in `entries`, or a " +
      "`wholeResultSet` entry, or both.",
    path: ["entries"],
  })
  .superRefine(({ entries }, ctx) => {
    const firstById = new Map<string, string>();
    entries.forEach((entry, index) => {
      const first = firstById.get(entry.id);
      if (first === undefined) {
        firstById.set(entry.id, entry.action.action);
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: ["entries", index, "id"],
        message:
          first === entry.action.action
            ? `\`${entry.id}\` is staged twice. A row carries exactly one staged action ` +
              "(SPEC.md §10), so name each document once."
            : `\`${entry.id}\` is staged twice with different actions (\`${first}\` and ` +
              `\`${entry.action.action}\`). Refused rather than resolved: choosing one would be a ` +
              "silent choice about someone's documents, and applying both would write one " +
              "document twice inside an act that is one commit of exactly what changed (SPEC.md " +
              "§4). Stage each document once.",
      });
    });
  })
  .openapi("BulkActionRequest");

/**
 * Why a document the act could not change did not change. Machine readable,
 * because the four refusals want different things from the person — refresh the
 * board, fix the document, try again, or nothing at all — and a UI that had to
 * match on prose would get it wrong the first time the prose was improved. The message beside it carries the specifics; this carries
 * the class.
 *
 * **There is deliberately no staleness class**, and the history of that is worth
 * keeping because the value outlived two justifications in a row. It began as
 * `locked`, naming the holder of the edit lock; when SHARED-041 replaced the
 * lock with a key it was renamed `stale`, and kept on the strength of §10's
 * sentence — *"a document whose content moved under the staged Save is refused
 * exactly as a single edit to it would be, saying so (§7)"*. It was declared
 * "because the spec sentence requires the report to be able to say it, not
 * because every implementation must produce it".
 *
 * **That sentence is gone** (struck from §10 and §9.2 on 2026-08-13, PR #46
 * review), and it was the value's only remaining support: no code path emits it,
 * and none can. Every act this route offers — archive, unarchive, resolve,
 * reopen, move, tag, review, delete — **names its own delta**, so by §7 none of
 * them needs a key, and {@link BulkActionRequestSchema} carries none. A route
 * given no version to compare cannot detect that a version changed.
 *
 * A declared class with no producer is not free: `example` made it this field's
 * showcase value, and a client author reading the generated types would write a
 * `case "stale":` recovery that can never run. If a bulk Save is ever given keys
 * (SHARED-041's remaining open question, left to the UI work), the class comes
 * back **with** the mechanism that produces it, rather than waiting for it.
 */
export const BULK_REFUSAL_REASONS = [
  "not-found",
  "not-applicable",
  "invalid",
  "write-failed",
] as const;

export const BulkRefusalReasonSchema = z.enum(BULK_REFUSAL_REASONS).openapi({
  description:
    "Which class of refusal this is. `not-found`: no " +
    "document has that id; the other documents are not the caller's mistake, so it is an entry " +
    "here rather than a `404` for the whole request. `not-applicable`: the act does not apply to " +
    "this document (resolving something that is not a thread) — §10 offers an action only on the " +
    "rows that can take it, so for an enumerated row this means the corpus changed between " +
    "staging and saving, and for a `wholeResultSet` entry it is the ordinary case of one act " +
    "covering a mixed result set. `invalid`: the write would leave the document failing §11 " +
    "validation, refused with its reason. `write-failed`: the file could not be written; nothing " +
    "about this document reached the commit.",
  example: "not-applicable",
});

/**
 * What every part of the result names: the document, and **what was done to
 * it**. The verb is per document because a Save carries a mix of them (SPEC.md
 * §4, §10), so a bare id would leave a report unable to say what happened
 * without pairing itself back against the request — and for the documents a
 * `wholeResultSet` entry covered, the caller has no request row to pair against
 * at all.
 */
const outcomeShape = {
  id: DocumentIdSchema.describe("The document this outcome is about."),
  action: BulkActionNameSchema,
} as const;

export const BulkActionOutcomeSchema = z.object(outcomeShape).openapi("BulkActionOutcome", {
  description:
    "One document the act reached, and what was done to it. Carried in `changed` and in " +
    "`alreadyInState`; `BulkActionRefusal` is the same pair plus why it did not change.",
});

/**
 * One document the act did not change, and why — §10's third part, "listed apart
 * from both … each named individually with its reason".
 *
 * **The reason and its message are the whole of an entry**, and that is what the
 * removal of the edit lock left behind: the shape used to carry a `Lock` beside
 * the reason, non-null exactly when the reason was `locked`, because a refusal
 * had to name the holder a person would go and wait for. Nothing this route
 * reports has a holder any more — nothing is held — so there is nothing to name,
 * and the message carries what a person needs. One field fewer, one refinement
 * fewer, and no shared component to accidentally make nullable.
 *
 * Stated as one shape rather than a union of two because §10 describes one list
 * of named refusals, and a `oneOf` here would make every consumer narrow before
 * it could read the id it already has.
 */
export const BulkActionRefusalSchema = z
  .object({
    ...outcomeShape,
    reason: BulkRefusalReasonSchema,
    message: z
      .string()
      .min(1)
      .describe(
        "Human-readable specifics for this document — which act found nothing to apply, the " +
          "validator's own finding, the write error. Rendered verbatim beside the document's " +
          "title; never parsed. Always present: §10 requires every entry in this part to carry " +
          "its reason, and a class alone does not tell a person what to do next.",
      ),
  })
  .openapi("BulkActionRefusal");

/**
 * §10's three parts, plus what the act as a whole did.
 *
 * **Ids and verbs, not documents.** Twenty archived documents would be twenty
 * full `Doc` bodies on a response nobody reads them from: the board already
 * holds the rows it selected, and the SSE invalidation that follows a mutation
 * is what refreshes them. What the caller cannot reconstruct is *which*
 * documents ended up where and *what happened to each*, and that is exactly what
 * these lists carry. The per-document verb replaces the single top-level `action`
 * echo CONTRACT-037 published, which a mixed Save would have made a lie.
 *
 * **The parts partition the requested ids.** Every id the request resolves to
 * appears exactly once across `changed`, `alreadyInState` and `refused`, and
 * nothing else appears there at all — so a caller can total the three and
 * compare against what it selected: §10's "if seventeen of twenty changed, the
 * result says seventeen, names the three, and the history agrees with it (§4)".
 * For a request whose staged set is entirely enumerated — the common case — the
 * resolved ids are exactly the ids in `entries`, which is CONTRACT-037's
 * invariant unchanged. A `wholeResultSet` entry adds the ids its query matched
 * when the Save ran, minus the ids `entries` already names; those ids are in no
 * request field, so these three lists are the only place the caller learns them
 * (§10: "the count is re-evaluated when the Save runs, and the result reports the
 * documents actually changed — saying so when that differs from the number
 * shown").
 *
 * **`changed` and the commit are one computation, and the containment runs one
 * way.** §4 requires the commit to contain "exactly the documents the action
 * changed", and §10 requires the history to agree with the report; concretely,
 * every id in `changed` has a file in `git show --name-only <commit>`, because
 * only a write that landed puts an id there and only those writes are staged. A
 * document that was already in the target state, or that was refused, writes
 * nothing **of its own** — though its files may still be in the commit, carried
 * there by another document's act (see the second cause below). That direction
 * is the testable invariant, and it is the only one a report can be wrong in.
 *
 * **The converse is false**, and stating it as an equality was worth correcting
 * rather than weakening quietly: a commit may legitimately carry files for
 * documents the caller never named, because these three parts partition the
 * **requested** ids and nothing else. Two cases do it today — both required by
 * the spec rather than incidental, and both behaving exactly as the
 * single-document routes do, since neither is peculiar to acting in bulk:
 *
 * - **§6's anchor cascade.** Deleting an anchored thread rewrites its parent's
 *   `anchors` map in the same commit. The parent survives the act — it was not
 *   deleted, and it need not even have been among the request's ids — so it
 *   belongs in none of the three parts while its file is in the commit.
 * - **A skill folder move.** Archiving or unarchiving a skill moves its whole
 *   folder, carrying every file under it, including the `SKILL.md` of a nested
 *   skill (a supported shape). The move *disables* that nested document — §7:
 *   what disables a skill is where its folder lives — but its id was never
 *   requested, so it belongs in none of the three parts either.
 *
 * **Belonging in none of the three parts is not the same as going unsaid**
 * (CONTRACT-047). A carried document is reported in `warnings`: a
 * `carried_skill` naming it and the enablement the move gave or took, and a
 * `carried_reconciliation` where the move also corrected a stale `status` in
 * its frontmatter. That is a report *about* the act rather than a fourth part
 * of it — the three parts partition the **requested** ids and must keep doing
 * so, since a caller totals them against what it selected, and a carried id has
 * no request row to pair against. The same two warnings appear on the
 * single-document `POST /api/docs/{id}/archive` and `/unarchive`, because the
 * behaviour is the single-document write path's and bulk loops through it.
 */
export const BulkActionResultSchema = z
  .object({
    changed: z
      .array(BulkActionOutcomeSchema)
      .describe(
        "Documents the act changed, each with the verb that changed it — §10's first part. Every " +
          "one of them has a file in `commit` (§4); the containment runs this way only, since a " +
          "commit may also carry files for documents the act did not name (§6's anchor cascade " +
          "reaching a surviving parent, a skill folder move carrying a nested skill — reported " +
          "in `warnings`, never as an entry here, since these lists partition the requested " +
          "ids). Empty is a legal outcome: every document was already in the target state, or " +
          "every one was refused.",
      ),
    alreadyInState: z
      .array(BulkActionOutcomeSchema)
      .describe(
        "Documents that were **already in that state** — §10's second part, explicitly a no-op " +
          'and **not a failure**: "a document already archived is a no-op, not a failure". They ' +
          "contribute nothing to the commit, and a board must not colour them as errors. This is " +
          "also where a row that reached its staged state between staging and saving lands: §10 " +
          "keeps such a row staged and says it is already done, and this part is what says it. " +
          "The `review` act populates it only when the instant it would write is the one already " +
          "there: instants are second-precision, so repeating `review` on the same document " +
          "inside one second genuinely moves no bytes. Reporting it as changed would put an id " +
          "in `changed` that `git show --name-only` does not list, and that containment is the " +
          "stronger, testable invariant (SERVER-077).",
      ),
    refused: z
      .array(BulkActionRefusalSchema)
      .describe(
        "Documents that **did not change, and why** — §10's third part, listed apart from both " +
          "others because it is the part worth re-reading. After the act, §10 reduces the staged " +
          "set to exactly these, so retrying what was refused is one gesture.",
      ),
    orphanedThreadIds: z
      .array(ThreadIdSchema)
      .describe(
        "Threads left as **orphaned records** by a `delete`, totalled across every document " +
          "actually deleted (SPEC.md §9.2 — they keep their `parent` id and stay readable; their " +
          "anchors no longer resolve). Drop their caches. Empty when the act deleted nothing. " +
          "§10's confirm needs this count *before* the act, which is a `GET /api/docs?type=thread&" +
          "parent=<ids>` the caller makes itself — this field is what the act actually did.",
      ),
    commit: z
      .string()
      .nullable()
      .describe(
        "The **single** auto-commit this act landed as (SPEC.md §4), authored by the acting " +
          "party. One sha, never a list, **whatever mix of verbs the act carried**: §4 is " +
          'explicit that "a Save carrying a mix of verbs is still one act and still one commit", ' +
          "so a server that grouped by verb would have no honest value to put here. Null in " +
          "three cases, none of them an error — `changed` is empty, so there was nothing to " +
          "commit and a commit containing nothing is not one; the workspace is not a git " +
          "repository (`commit_skipped` in `warnings`); or the workspace's hooks rejected the " +
          "commit, leaving the writes on disk and uncommitted (`commit_failed` in `warnings`, " +
          "§11).",
      ),
    warnings: warningsField,
  })
  .openapi("BulkActionResult");

export type BulkActionName = (typeof BULK_ACTION_NAMES)[number];
export type BulkAction = z.infer<typeof BulkActionSchema>;
export type BulkWholeResultSetAction = z.infer<typeof BulkWholeResultSetActionSchema>;
export type BulkStagedEntry = z.infer<typeof BulkStagedEntrySchema>;
export type BulkWholeResultSetEntry = z.infer<typeof BulkWholeResultSetEntrySchema>;
export type BulkActionRequest = z.infer<typeof BulkActionRequestSchema>;
export type BulkRefusalReason = z.infer<typeof BulkRefusalReasonSchema>;
export type BulkActionOutcome = z.infer<typeof BulkActionOutcomeSchema>;
export type BulkActionRefusal = z.infer<typeof BulkActionRefusalSchema>;
export type BulkActionResult = z.infer<typeof BulkActionResultSchema>;
