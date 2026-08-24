import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  CreateDocRequestSchema,
  DeleteDocResultSchema,
  DocMutationResponseSchema,
  DocSchema,
  JobOnlyRequestSchema,
  MoveDocRequestSchema,
  UpdateDocRequestSchema,
  UpdateDocResponseSchema,
} from "../schemas/doc.js";
import { DocumentIdSchema } from "../schemas/id.js";
import { DocListSchema, DocsQuerySchema } from "../schemas/query.js";
import { RelatedDocsSchema, RelatedQuerySchema } from "../schemas/retrieval.js";
import {
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  STALE_KEY_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  UNKNOWN_JOB_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";
import { openapi } from "../schemas/openapi-metadata.js";

const DocIdParamSchema = z.object({
  id: openapi(DocumentIdSchema, { param: { name: "id", in: "path", required: true } }),
});

/**
 * The single collection query behind every list (SPEC.md §9.2). Thread lists go
 * through here too, with `type=thread` — there is no separate thread list route.
 */
export const listDocs = createRoute({
  method: "get",
  path: "/api/docs",
  tags: ["docs"],
  summary: "Query the document collection",
  description:
    "Structured filters compose with optional full-text search: values OR within a comma-separated " +
    "parameter and AND across parameters. The default result set excludes `status: archived` " +
    "(SPEC.md §10) unless `status` is passed explicitly. The thread-only filters — `parent`, " +
    "`agent`, `author` and `unread` — no-op for non-thread types rather than erroring (SPEC.md " +
    "§9.2). `isParent` is not one of them: it selects roots — documents with no parent — for " +
    "every type, and is the one filter that is **refused** in combination, since `parent=<id>` " +
    "with `isParent=true` is a contradiction and answers `400`. `folder` matches a folder and " +
    "everything under it, threads included through their parents, unless `folderScope=self` " +
    "narrows it to the documents filed directly in that folder — a modifier, so it too answers " +
    "`400` when it arrives without a `folder`. Every row carries its Attention " +
    "reasons; rows carry search snippets when `q` is set.",
  request: { query: DocsQuerySchema },
  responses: {
    200: jsonContent(DocListSchema, "Matching documents, newest-updated first by default."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const getDoc = createRoute({
  method: "get",
  path: "/api/docs/{id}",
  tags: ["docs"],
  summary: "Read a document, its resolved anchors, and its key",
  description:
    "The read that hands out the document's **key** (SPEC.md §7): `key` names the version this " +
    "response returned, and presenting it back on a write that replaces the body is what keeps " +
    "two writers from overwriting each other. Beside it, `userEditing` says whether a person has " +
    "an edit session open on the document right now — information, never a gate: nothing is " +
    "refused because of it, and no document is ever read-only.",
  request: { params: DocIdParamSchema },
  responses: {
    200: jsonContent(
      DocSchema,
      "Frontmatter, body, this document's anchors, its key, and whether a person is editing it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

/**
 * Expansion from a known document (SPEC.md §7 Retrieval discipline, §9.2 —
 * SHARED-006 Edit 8, signed 2026-07-30): the other half of retrieval, and the
 * endpoint behind `corpus doc related`.
 *
 * Registered next to `getDoc` in `routes/index.ts`. No static-versus-parameter
 * competition arises — `/api/docs/{id}/related` is a `GET` one segment deeper
 * than `/api/docs/{id}`, and the three routes sharing its depth
 * (`move`, `archive`, `unarchive`) are `POST`s — so its placement is for
 * readability rather than for routing.
 */
export const relatedDocs = createRoute({
  method: "get",
  path: "/api/docs/{id}/related",
  tags: ["search"],
  summary: "Documents most related to this one",
  description:
    "The documents most related to this one, ranked, in retrieval's frugal shape: id, title, a " +
    "one-line excerpt, and **why** each is related — never bodies. Retrieval Phase A relates " +
    "through the reference graph only (outgoing `[[refs]]` and backlinks, via the projection's " +
    "`links` table), so every row is `linked`; from Phase B, semantically similar documents join " +
    "the same ranked list and rows are labelled `linked` / `similar` / `both` without the shape " +
    "moving (SPEC.md §9.1). Archived documents are excluded unless `includeArchived` lifts the " +
    "default, like every list. A reference to a document that does not exist is not a row: the " +
    "`links` table stores dangling references on purpose, and an id the caller cannot read is " +
    "worse than no row. `404` when the document itself is unknown. Read-only; no acting party.",
  request: { params: DocIdParamSchema, query: RelatedQuerySchema },
  responses: {
    200: jsonContent(RelatedDocsSchema, "Related documents, most related first."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

/**
 * **The route description carries the short true version; the fields carry the
 * grammar** (PR #49 review, MAJOR).
 *
 * It said flatly that "an omitted `folder` files the document in
 * `data/docs/inbox/`" — a rule SERVER-122 had already given an exception, and
 * the one exception in the product is the one a client author is most likely to
 * hit: `POST /api/docs {"type":"agent-def"}` lands in `.claude/agents/`, where
 * the file is loaded as a subagent definition, not in the inbox. CONTRACT-062
 * fixed the *field* and left the sentence one level up — the first thing an
 * OpenAPI consumer reads — stating the old rule with no exception.
 *
 * The fix is not to copy the field's grammar up here. A route description says
 * what a caller must know before reading further and names where the rest is;
 * `folder`'s and `title`'s descriptions say what each field accepts and why. So
 * both exceptions appear here in one clause each, with the field named as the
 * place to read them out.
 *
 * **Second review, same sentence** (CONTRACT-063 batch): the clause added above
 * said "except for a type SPEC.md §7 gives a document root of its own" — the
 * over-broad form the *field* had already been given a qualifier to avoid. §7
 * gives `type: skill` a root of its own and a skill created with no folder still
 * lands in the inbox (`rootForType` requires `projectionIndexesFolder`, false
 * for a `SKILL.md`-only root; pinned by `apps/server/src/docs/write.test.ts`).
 * The exceptions are therefore **named** here rather than characterised, and
 * both of them are: `agent-def` and — the one no version of this sentence had
 * mentioned — `thread`, which `allocatePath` files flat under `data/threads/`
 * before `folder` is consulted at all. The test for any future edit is to read
 * the sentence against all five entries of `DOCUMENT_ROOTS`.
 *
 * **Third review, same sentence** (PR #49): the thread clause read "whatever
 * `folder` names", which is false for a `folder` that never gets as far as
 * `allocatePath`. `createDocument` calls `resolveFolder(input.folder, input.type)`
 * *first* (`apps/server/src/docs/create.ts`), and it refuses on `type` alone —
 * `{"type":"thread","folder":".claude/agents"}` is a `400` from `admitRoot`,
 * not a thread filed under `data/threads/`. So the clause now says what the
 * *field* has said since CONTRACT-063: a thread's `folder` is checked like
 * anyone else's and only its *effect* is dropped.
 *
 * That is the lesson the first two passes both missed. Reading a sentence
 * against `DOCUMENT_ROOTS` asks only *where a document lands*; every version so
 * far was true of every root and still false of the inputs that never reach one.
 * The check is therefore two-pass: for each root, where does a document land —
 * and for each way `resolveFolder` can throw (an absolute path, a traversal, an
 * unindexed folder, a root that holds another type, a root that takes no
 * ordinary `*.md`), does the sentence still hold. Then read this sentence and
 * `CREATE_FOLDER_DESCRIPTION` side by side: they must make the same claim about
 * every input, refusals included.
 */
export const createDoc = createRoute({
  method: "post",
  path: "/api/docs",
  tags: ["docs"],
  summary: "Create a document",
  description:
    "The body is pre-filled from the type's `template` document when one exists and no body is given " +
    "(SPEC.md §9.2). The server assigns the id; it is immutable thereafter. Creation is inbox-first: " +
    "an omitted `folder` files the document in `data/docs/inbox/` — **except for a type whose own " +
    "document root takes ordinary markdown documents**, which is where an omitted `folder` files it " +
    "instead. There are two: a `type: agent-def` document lands in `.claude/agents/` (SPEC.md §7) " +
    "and not in the inbox, and a `type: thread` document is flat at `data/threads/<id>.md`, " +
    "named by its id (SPEC.md §4) — a `folder` sent with a thread is still checked by the same " +
    "rules as any other create, so one that fails them is still a `400`, and one that passes " +
    "never changes where the thread lands. `type: skill` is **not** one of them, though §7 gives it " +
    "a root too: `.claude/skills` indexes `SKILL.md` files alone, so a skill created here with no " +
    "folder still lands in the inbox. See `folder` for " +
    "that grammar in full, including which roots a request may name outright. A create can also be " +
    "refused on its `title`: in a root where a document's filename is the name it answers to, a " +
    "name already taken is a `400` rather than the deduped filename a title collision gets under " +
    "`data/docs/`.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The document to create. `type` and `title` are mandatory, so the body is too.",
      content: { "application/json": { schema: CreateDocRequestSchema } },
    },
  },
  responses: {
    422: UNKNOWN_JOB_RESPONSE,
    201: jsonContent(DocMutationResponseSchema, "The created document, and any §11 warnings."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const updateDoc = createRoute({
  method: "put",
  path: "/api/docs/{id}",
  tags: ["docs"],
  summary: "Edit a document's body and frontmatter",
  description:
    "Runs anchor reconciliation (SPEC.md §6) in the same save and reports which anchors were " +
    "remapped and which were orphaned. Every field is optional — a request names only what it " +
    "changes — so an omitted body is exactly a `{}` body: a save that names no change, rewrites " +
    "nothing, and needs no key.\n\n" +
    "**A write that replaces the `body` must present the document's `key`** (SPEC.md §7): the " +
    "key names the version you read, and a `body` with no key is a `400` — replacing a block " +
    "without naming what it replaces is the write that can destroy something silently. **A write " +
    "that names its own delta needs none** — a tag, a status, `due`, `reviewed`, `evergreen`, or " +
    "a view key — because it says what it changes and merges with whatever else happened. " +
    "Sending a key on such a write is welcome and is still checked, so a caller that always " +
    "presents what it read needs no rule about which fields are which.\n\n" +
    "**A stale key is a `409`**, carrying the document as it now stands and a fresh key for it — " +
    "one exchange, never a bare refusal, and never a lost edit: nothing was written and the " +
    "content is yours to resend. The saved document in a `200` likewise carries the fresh key for " +
    "the next write, so a writer that keeps writing never has to re-read.\n\n" +
    "**One field on this route is user-only, and it answers `403`**: `origin: null`, the detach " +
    "(SPEC.md §9.2). A request carrying it under `x-corpus-author: agent` is **rejected** with " +
    "`403` and writes nothing, because detaching is a person's correction of where " +
    "their work was filed and an agent that could undo it could quietly move an artifact out of " +
    "the scope it belongs to. Every other field on this route is open to both parties, so the " +
    "`403` is about that one key and never about editing.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description:
        "The fields to change, plus the `key` when they include `body`; omit the body entirely to " +
        "change nothing.",
      content: { "application/json": { schema: UpdateDocRequestSchema } },
    },
  },
  responses: {
    422: UNKNOWN_JOB_RESPONSE,
    200: jsonContent(
      UpdateDocResponseSchema,
      "The saved document — carrying a fresh `key` — and the anchor reconciliation report.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    // CONTRACT-059. `origin: null` is user-only, and the server has always
    // refused it for an agent actor — the field's own description said so in
    // prose while the machine-readable half declared nothing. A consumer
    // reading descriptions knew; a consumer generating handlers did not.
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: STALE_KEY_RESPONSE,
  },
});

/**
 * **The source rule lives here and nowhere else** (CONTRACT-065, found by
 * CONTRACT-064's second sweep). `MoveDocRequest.folder` describes the
 * destination, which is what that field is. Where a document may come *from* is
 * a property of the document rather than of the field, and every published
 * description covered only the destination half — so a caller reading the
 * contract met `assertMovable`'s `400`
 * (`apps/server/src/docs/move.ts`) with nothing having predicted it.
 *
 * Written from that function rather than from SPEC: it refuses on
 * `parseDocumentPath(loaded.path)` returning `null` or a `root` other than
 * `docs`, and its two messages are quoted here verbatim so the contract and the
 * refusal cannot drift into two accounts of one rule.
 */
export const moveDoc = createRoute({
  method: "post",
  path: "/api/docs/{id}/move",
  tags: ["docs"],
  summary: "Move a document to another folder",
  description:
    "Rewrites the file path only (SPEC.md §9.2). **The document id never changes**, so every " +
    "`[[ref]]`, anchor entry and thread `parent` keeps resolving; the projection re-maps id → path. " +
    "**A move names its own delta and presents no key** (SPEC.md §7): it rewrites the path, not " +
    "the content, so it invalidates nobody's key and overwrites nothing. " +
    "**Only a document already under `data/docs/` can be moved**, and its source is checked " +
    "before the destination is resolved, so a document that can never move says so rather than " +
    "complaining about the folder. A `type: thread` document is flat at `data/threads/<id>.md` " +
    "(SPEC.md §4) — its filename is its id, so there is nowhere to move it to — and the `400` " +
    "reads *threads are flat under data/threads/ and cannot be moved*. A document under any " +
    "other root — an `agent-def` in `.claude/agents/`, a skill under `.claude/skills/` — reads " +
    "*<path> is not under data/docs/ and cannot be moved*. That holds in both directions, since " +
    "`folder` reaches no root either: this route never takes a document out of a SPEC.md §7 root " +
    "and never files one into it. **A persona written to the wrong place is repaired by creating " +
    "it in `.claude/agents/`** (`POST /api/docs`, whose `folder` may name a root), not by moving " +
    "the misfiled one.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The destination folder. A move names one, so the body is mandatory.",
      content: { "application/json": { schema: MoveDocRequestSchema } },
    },
  },
  responses: {
    422: UNKNOWN_JOB_RESPONSE,
    200: jsonContent(
      DocMutationResponseSchema,
      "The document at its new path, and any §11 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const archiveDoc = createRoute({
  method: "post",
  path: "/api/docs/{id}/archive",
  tags: ["docs"],
  summary: "Archive a document",
  description:
    "Flips `status` to `archived` — a reversible organizational act, never a deletion (SPEC.md §7). " +
    "**The document id never changes** and nothing leaves git. Archived documents drop out of the " +
    "default result set of `GET /api/docs` and come back with `status=archived`. Archiving a " +
    "`type: skill` document additionally moves its folder to `.claude/skills-archived/`, which " +
    "disables it without unindexing it — carrying every file under that folder, including a " +
    "**nested skill** the request never named, whose id is stamped into it so the move does not " +
    "change its identity (SERVER-078). That carry **disables the nested skill too** (§7: what " +
    "disables a skill is where its folder lives), and the response says so: one `carried_skill` " +
    "warning per carried document, naming it, its path after the move, and that it is now " +
    "**disabled**. It is a report *about* " +
    "the act, not a part of it — a document the request never named never becomes a changed " +
    "document (CONTRACT-047). The id stamp itself is deliberately not reported: it keeps an " +
    "identity rather than changing one. An archive that carries no other skill document warns " +
    "nothing. **Archiving names its own delta and presents no key** (SPEC.md §7): it flips " +
    "`status`, overwriting nothing a reader may have been holding.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description:
        "Optional, and optional in every part: §9.2 lets any write name the job it serves, and " +
        "this route previously took no body at all — so **omit the body entirely** and the call " +
        "is exactly what it has always been. The only thing it can carry is `job`, which buys " +
        "attribution rather than an origin: §9.2 records an origin for a document a job " +
        "*creates*, and this act creates nothing.",
      content: { "application/json": { schema: JobOnlyRequestSchema } },
    },
  },
  responses: {
    422: UNKNOWN_JOB_RESPONSE,
    200: jsonContent(
      DocMutationResponseSchema,
      "The document, now archived, any §11 warnings, and what a skill folder move carried.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const unarchiveDoc = createRoute({
  method: "post",
  path: "/api/docs/{id}/unarchive",
  tags: ["docs"],
  summary: "Restore an archived document",
  description:
    "The inverse flip, back to `status: resolved` — the state archiving already implied (§5). **The document id never changes.** Unarchiving a " +
    "`type: skill` document moves its folder back out of `.claude/skills-archived/`, carrying " +
    "every file under it — including a **nested skill** the request never named, whose id is " +
    "stamped into it so the move does not change its identity, and whose `status` is reconciled " +
    "to the enabled root it now sits in (SERVER-078). Both effects on that carried document are " +
    "reported (CONTRACT-047): a `carried_skill` warning per carried document, naming it, its " +
    "path after the move, and that it is now **enabled**, and — only where a stale " +
    "`status: archived` had to be " +
    "corrected to `resolved` — a `carried_reconciliation` warning naming the document and the key " +
    "rewritten. They are reports *about* the act, not parts of it: a document the request never " +
    "named never becomes a changed document. The id stamp is deliberately not reported, since it " +
    "keeps an identity rather than changing one. An unarchive that carries no other skill " +
    "document warns nothing, and one whose carried documents needed no correction carries no " +
    "`carried_reconciliation`. **Unarchiving names its own delta and presents no key** " +
    "(SPEC.md §7): it flips `status` back, overwriting nothing a reader may have been holding.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description:
        "Optional, and optional in every part: §9.2 lets any write name the job it serves, and " +
        "this route previously took no body at all — so **omit the body entirely** and the call " +
        "is exactly what it has always been. The only thing it can carry is `job`, which buys " +
        "attribution rather than an origin: §9.2 records an origin for a document a job " +
        "*creates*, and this act creates nothing.",
      content: { "application/json": { schema: JobOnlyRequestSchema } },
    },
  },
  responses: {
    422: UNKNOWN_JOB_RESPONSE,
    200: jsonContent(
      DocMutationResponseSchema,
      "The document, restored, any §11 warnings, and what a skill folder move carried.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const deleteDoc = createRoute({
  method: "delete",
  path: "/api/docs/{id}",
  tags: ["docs"],
  summary: "Delete a document (user-only)",
  description:
    "**User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — the agent " +
    "archives, never deletes (SPEC.md §7). Cascade: the document's threads become **orphaned " +
    "records** — they keep their `parent` id and stay readable, but their anchors no longer resolve. " +
    "Nothing is hard-deleted from history; git preserves the file and every version of it. " +
    "Deletion presents no key (SPEC.md §7): it is a user's deliberate act on a document they are " +
    "looking at, behind an explicit confirm, and it destroys the document rather than a version " +
    "of it. It takes **no `job`**, unlike the other writes: §9.2's attribution is for work an " +
    "agent does, and deletion is the one mutation an agent may never perform, so a job field here " +
    "would name work that cannot exist.",
  request: { params: DocIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      DeleteDocResultSchema,
      "The deleted id, the threads it orphaned, and any §11 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
