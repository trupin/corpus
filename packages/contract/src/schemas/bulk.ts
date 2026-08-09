import { z } from "@hono/zod-openapi";
import { DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { LockSchema } from "./lock.js";
import { warningsField } from "./warning.js";

/**
 * **One action, one commit** (SPEC.md §4, rider signed 2026-08-05; §11's
 * "Selecting rows, and acting on the selection", same rider) — the shapes behind
 * `POST /api/docs/bulk`.
 *
 * ## Why this route exists at all
 *
 * Every single-document mutation route takes one `{id}`, so a board with no
 * batch route archives twenty documents with twenty requests, and the
 * auto-committer's fold decision keys on the same `docId` and actor — so twenty
 * archives of twenty *different* documents can never fold into one commit. They
 * are twenty commits by construction, which is precisely what §4 now forbids:
 * "archiving twenty documents is one commit, not twenty", so that reverting the
 * action is one `git revert` and `git log` and the on-screen report say the same
 * thing. Without a way to ask for several document mutations as **one act**, §4
 * is a promise the UI cannot keep.
 *
 * ## One route with an act discriminator, not one route per act
 *
 * Both are defensible and the next reader will ask, so: the value of this
 * surface is concentrated in two rules that are identical for every act — a
 * bulk act is exactly one commit containing exactly what changed, and its result
 * is §11's three parts. Per-act routes would restate both eight times, and eight
 * restatements are eight opportunities to drift; a server would then be free to
 * implement one of them by looping the single-document path without any
 * declaration contradicting it. The acts differ only in their parameters, which
 * is exactly what a discriminated union is for. The single-document routes are
 * untouched and stay the path for the reader's ⋯ menu and per-row quick actions
 * (§11) — this route is for a *selection*, and the distinction is the commit.
 *
 * **Threads ride here too, rather than getting a second batch path.** Resolve
 * and Reopen act on threads, whose single-document routes live under
 * `/api/threads/{id}` — but a thread is a document (§6), `status` is a core
 * document field (§5), and the collection route `GET /api/docs?type=thread` is
 * already the thread list. This route addresses documents by id and answers in
 * ids, so nothing thread-shaped is needed in either direction; §11 offers an
 * action only when it applies to every selected item, so a selection reaching
 * `resolve` is already homogeneous. Two batch paths would mean two commit rules.
 *
 * ## Ids, never a filter
 *
 * §11 lets a selection extend to "everything the query matches", and the caller
 * resolves that to ids before it acts. A filter-shaped mutation would be a far
 * larger promise — the server acting on a set nobody enumerated — and §11
 * already forbids bulk delete on a whole-result-set selection for exactly that
 * reason. §11's "the result reports the documents actually changed — saying so
 * when that differs from the number shown" is then the caller comparing its own
 * count against {@link BulkActionResultSchema}, which is where that comparison
 * belongs: only the caller knows what number it showed.
 *
 * ## Partial failure is the normal case, not the error path
 *
 * A bulk act answers `200` when some documents changed and some did not. It is
 * not a `207`-shaped puzzle and not a `4xx`: a locked document is routine (the
 * agent takes locks while it works), so all-or-nothing would fail the user's
 * action for reasons that have nothing to do with the other nineteen documents —
 * and "refuse the whole set" over twenty files is a guarantee the write path
 * cannot give without either checking everything first and racing anyone who
 * edits one in between, or writing some and rolling them back, a rollback that
 * itself commits.
 */

/**
 * The acts §11 offers on a selection, minus the one that needs nothing here:
 * "Ask the agent about these" creates one standalone thread whose first turn
 * references every selected document, through the existing `POST /api/threads`,
 * and changes none of them — which is why §11 keeps it available when some are
 * locked.
 *
 * Two of these have no dedicated single-document route either: `tag` and
 * `review` are keys of `UpdateDocRequest` on `PUT /api/docs/{id}`. They are
 * named acts here rather than a batched partial update on purpose — a batched
 * `UpdateDocRequest` would let one request set twenty documents' titles to the
 * same string, and §11 offers no such action.
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

export const BulkActionNameSchema = z.enum(BULK_ACTION_NAMES).openapi({
  description:
    "Which act was applied, echoed from the request so a rendered report never has to be paired " +
    "back to the call that produced it. The eight are SPEC.md §11's selection actions except " +
    '"Ask the agent about these", which changes no document and goes through `POST /api/threads`.',
  example: "archive",
});

const FOLDER_DESCRIPTION =
  "Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the " +
  "full prefix (`data/docs/finance`) — the same spelling `POST /api/docs/{id}/move` takes. Each " +
  "document keeps its id, so every `[[ref]]`, anchor entry and thread `parent` survives the move.";

/**
 * Tagging is a **delta**, and the shape is what makes that non-negotiable: §11
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
  "no replace — SPEC.md §11 is explicit that tagging adds or removes the named tags and never " +
  "replaces a document's tag set.";

const tagList = z
  .array(z.string().min(1))
  .describe("Tag names. Empty strings are rejected — an empty tag name names nothing.");

/**
 * The act, and only the act: which one, plus whatever that one needs. The ids it
 * applies to live beside it on {@link BulkActionRequestSchema} rather than
 * inside each member, so the discriminator carries no repetition and a caller
 * reading the union sees eight parameter lists rather than eight copies of
 * `ids`.
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
 * noise in the document and in the generated client. The union inlines into
 * `BulkActionRequest.action`, which is where a reader looks for it anyway.
 */
export const BulkActionSchema = z.discriminatedUnion("action", [
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
        "A document that is not a thread is refused with `not-applicable` rather than acted on.",
    ),
  z
    .strictObject({ action: z.literal("reopen") })
    .describe("Set `status: open` again on resolved threads."),
  z
    .strictObject({
      action: z.literal("move"),
      folder: z.string().min(1).describe(FOLDER_DESCRIPTION),
    })
    .describe("Move every document to one folder. Ids never change."),
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
  z
    .strictObject({ action: z.literal("delete") })
    .describe(
      "**User-only** (SPEC.md §7, §9.2): a request carrying `x-corpus-author: agent` is rejected " +
        "with `403` for the whole request, not per document — the agent archives, never deletes. " +
        "Each deleted document's threads become orphaned records, totalled in " +
        "`orphanedThreadIds`. Unlike archiving it cannot be undone from the app; git is the only " +
        "recovery.",
    ),
]);

const ACTION_DESCRIPTION =
  "The act to apply, and its parameters — discriminated on `action`. SPEC.md §11 offers an " +
  "action only when it applies to **every** selected item, so exactly one act per request is the " +
  "whole vocabulary a selection needs.";

const IDS_DESCRIPTION =
  "The documents to act on, named individually. **At least one**: an act on nothing is a caller " +
  "bug, and a `200` carrying three empty lists would let a broken board look healthy. An id " +
  "repeated within one request is collapsed — the act runs once per document and the result " +
  "names each id once. Thread ids belong here too (threads are documents, SPEC.md §6), which is " +
  "what lets `resolve`/`reopen` ride this route. **Ids, never a filter**: §11's whole-result-set " +
  "selection is resolved to ids by the caller, because a mutation aimed at a set nobody " +
  "enumerated is a far larger promise than this route makes. Deliberately uncapped — a column's " +
  "query legitimately matches thousands, and a limit the spec does not state would refuse a " +
  "selection §11 allows the board to offer.";

export const BulkActionRequestSchema = z
  .strictObject({
    ids: z.array(DocumentIdSchema).min(1).describe(IDS_DESCRIPTION),
    action: BulkActionSchema.describe(ACTION_DESCRIPTION),
  })
  .openapi("BulkActionRequest");

/**
 * Why a document the act could not change did not change. Machine readable,
 * because the five refusals want different things from the person — clear a
 * lock and retry, refresh the board, fix the document, or nothing at all — and a
 * UI that had to match on prose would get it wrong the first time the prose was
 * improved. The message beside it carries the specifics; this carries the class.
 */
export const BULK_REFUSAL_REASONS = [
  "locked",
  "not-found",
  "not-applicable",
  "invalid",
  "write-failed",
] as const;

export const BulkRefusalReasonSchema = z.enum(BULK_REFUSAL_REASONS).openapi({
  description:
    "Which class of refusal this is. `locked`: the other party holds the document's edit lock, " +
    "so it is refused exactly as a single edit to it would be (SPEC.md §7) — `lock` names the " +
    "holder, and this is the reason a retry after clearing the lock fixes. `not-found`: no " +
    "document has that id; the other documents are not the caller's mistake, so it is an entry " +
    "here rather than a `404` for the whole request. `not-applicable`: the act does not apply to " +
    "this document (resolving something that is not a thread) — §11 offers an action only when " +
    "it applies to every selected item, so this means the corpus changed between selecting and " +
    "acting. `invalid`: the write would leave the document failing §14 validation, refused with " +
    "its reason. `write-failed`: the file could not be written; nothing about this document " +
    "reached the commit.",
  example: "locked",
});

/**
 * One document the act did not change, and why — §11's third part, "listed apart
 * from both … each named individually with its reason".
 *
 * `lock` is nullable rather than optional, and the refinement ties it to the
 * reason in both directions: a `locked` entry without a holder would leave the
 * board saying "locked" and unable to say by whom, which is exactly the sentence
 * §7 requires a refusal to carry, and a holder on any other reason would invite
 * a client to render a lock banner over a validation failure. Stated as one
 * shape rather than a union of two because §11 describes one list of named
 * refusals, and a `oneOf` here would make every consumer narrow before it could
 * read the id it already has.
 *
 * **`z.union([LockSchema, z.null()])`, never `LockSchema.nullable()`.** `Lock` is
 * a registered component, and zod-to-openapi propagates a registered name onto
 * anything derived from it: `.nullable()` here rewrites the *shared* `Lock`
 * definition to `type: ["object", "null"]` for every route that references it —
 * measured, not assumed, during CONTRACT-037. The union form publishes
 * `anyOf: [{$ref: Lock}, {type: null}]` and leaves the component plain, which is
 * what keeps the field genuinely nullable without paying for it elsewhere.
 * `openapi.test.ts`'s "every named component is a plain, non-nullable,
 * undefaulted object" invariant is what caught it.
 */
export const BulkActionRefusalSchema = z
  .object({
    id: DocumentIdSchema,
    reason: BulkRefusalReasonSchema,
    message: z
      .string()
      .min(1)
      .describe(
        "Human-readable specifics for this document — the holder and when the lease expires, the " +
          "validator's own finding, the write error. Rendered verbatim beside the document's " +
          "title; never parsed. Always present: §11 requires every entry in this part to carry " +
          "its reason, and a class alone does not tell a person what to do next.",
      ),
    lock: z
      .union([LockSchema, z.null()])
      .describe(
        "The lock that refused this document, non-null **exactly when** `reason` is `locked` " +
          "(SPEC.md §7 — a refusal identifies the holder). Null on every other reason.",
      ),
  })
  .refine(({ reason, lock }) => (reason === "locked") === (lock !== null), {
    message: "`lock` must be present exactly when `reason` is `locked`, and absent otherwise",
    path: ["lock"],
  })
  .openapi("BulkActionRefusal");

/**
 * §11's three parts, plus what the act as a whole did.
 *
 * **Ids, not documents.** Twenty archived documents would be twenty full `Doc`
 * bodies on a response nobody reads them from: the board already holds the rows
 * it selected, and the SSE invalidation that follows a mutation is what refreshes
 * them. What the caller cannot reconstruct is *which* documents ended up where,
 * and that is exactly what these lists carry.
 *
 * **The parts partition the request.** Every id in the request appears exactly
 * once across `changed`, `alreadyInState` and `refused` (duplicates having been
 * collapsed), so a caller can total them and compare against what it selected —
 * §11's "if seventeen of twenty changed, the result says seventeen, names the
 * three, and the history agrees with it (§4)".
 *
 * **`changed` and the commit are the same set, computed once.** §4 requires the
 * commit to contain "exactly the documents the action changed", and §11 requires
 * the history to agree with the report; concretely, `changed` and
 * `git show --name-only <commit>` name the same documents. A document that was
 * already in the target state contributes nothing to the commit, and one that
 * was refused leaves nothing in it.
 */
export const BulkActionResultSchema = z
  .object({
    action: BulkActionNameSchema,
    changed: z
      .array(DocumentIdSchema)
      .describe(
        "Documents the act changed — §11's first part, and exactly the files in `commit` (§4). " +
          "Empty is a legal outcome: every document was already in the target state, or every " +
          "one was refused.",
      ),
    alreadyInState: z
      .array(DocumentIdSchema)
      .describe(
        "Documents that were **already in that state** — §11's second part, explicitly a no-op " +
          'and **not a failure**: "a document already archived is a no-op, not a failure". They ' +
          "contribute nothing to the commit, and a board must not colour them as errors. The " +
          "`review` act populates it only when the instant it would write is the one already " +
          "there: instants are second-precision, so repeating `review` on the same document " +
          "inside one second genuinely moves no bytes. Reporting it as changed would put an id " +
          "in `changed` that `git show --name-only` does not list, and that equality is the " +
          "stronger, testable invariant (SERVER-077).",
      ),
    refused: z
      .array(BulkActionRefusalSchema)
      .describe(
        "Documents that **did not change, and why** — §11's third part, listed apart from both " +
          "others because it is the part worth re-reading. After the act, §11 reduces the " +
          "selection to exactly these, so retrying after clearing a lock is one gesture.",
      ),
    orphanedThreadIds: z
      .array(ThreadIdSchema)
      .describe(
        "Threads left as **orphaned records** by a `delete`, totalled across every document " +
          "actually deleted (SPEC.md §9.2 — they keep their `parent` id and stay readable; their " +
          "anchors no longer resolve). Drop their caches. Empty for every other act. §11's " +
          "confirm needs this count *before* the act, which is a `GET /api/docs?type=thread&" +
          "parent=<ids>` the caller makes itself — this field is what the act actually did.",
      ),
    commit: z
      .string()
      .nullable()
      .describe(
        "The **single** auto-commit this act landed as (SPEC.md §4), authored by the acting " +
          "party. One sha, never a list: a server that looped the single-document write path " +
          "would have no honest value to put here. Null in three cases, none of them an error — " +
          "`changed` is empty, so there was nothing to commit and a commit containing nothing is " +
          "not one; the workspace is not a git repository (`commit_skipped` in `warnings`); or " +
          "the workspace's hooks rejected the commit, leaving the writes on disk and uncommitted " +
          "(`commit_failed` in `warnings`, §14).",
      ),
    warnings: warningsField,
  })
  .openapi("BulkActionResult");

export type BulkActionName = (typeof BULK_ACTION_NAMES)[number];
export type BulkAction = z.infer<typeof BulkActionSchema>;
export type BulkActionRequest = z.infer<typeof BulkActionRequestSchema>;
export type BulkRefusalReason = z.infer<typeof BulkRefusalReasonSchema>;
export type BulkActionRefusal = z.infer<typeof BulkActionRefusalSchema>;
export type BulkActionResult = z.infer<typeof BulkActionResultSchema>;
