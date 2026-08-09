import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  CreateDocRequestSchema,
  DeleteDocResultSchema,
  DocMutationResponseSchema,
  DocSchema,
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
  LOCKED_RESPONSE,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

const DocIdParamSchema = z.object({
  id: DocumentIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
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
    "(SPEC.md §11) unless `status` is passed explicitly. The thread-only filters — `parent`, " +
    "`agent`, `author` and `unread` — no-op for non-thread types rather than erroring (SPEC.md " +
    "§9.2). `isParent` is not one of them: it selects roots — documents with no parent — for " +
    "every type, and is the one filter that is **refused** in combination, since `parent=<id>` " +
    "with `isParent=true` is a contradiction and answers `400`. Every row carries its Attention " +
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
  summary: "Read a document with its resolved anchors",
  request: { params: DocIdParamSchema },
  responses: {
    200: jsonContent(DocSchema, "Frontmatter, body, and this document's anchors."),
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

export const createDoc = createRoute({
  method: "post",
  path: "/api/docs",
  tags: ["docs"],
  summary: "Create a document",
  description:
    "The body is pre-filled from the type's `template` document when one exists and no body is given " +
    "(SPEC.md §9.2). The server assigns the id; it is immutable thereafter. Creation is inbox-first: " +
    "an omitted `folder` files the document in `data/docs/inbox/`.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The document to create. `type` and `title` are mandatory, so the body is too.",
      content: { "application/json": { schema: CreateDocRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(DocMutationResponseSchema, "The created document, and any §14 warnings."),
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
    "Runs anchor reconciliation (SPEC.md §6) in the same save and reports which anchors were remapped " +
    "and which were orphaned. Refused with `423` when the other party holds the document's edit lock. " +
    "Every field is optional — a request names only what it changes — so an omitted body is exactly a " +
    "`{}` body: a save that names no change and rewrites nothing.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description: "The fields to change; omit the body entirely to change nothing.",
      content: { "application/json": { schema: UpdateDocRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      UpdateDocResponseSchema,
      "The saved document and the anchor reconciliation report.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
  },
});

export const moveDoc = createRoute({
  method: "post",
  path: "/api/docs/{id}/move",
  tags: ["docs"],
  summary: "Move a document to another folder",
  description:
    "Rewrites the file path only (SPEC.md §9.2). **The document id never changes**, so every " +
    "`[[ref]]`, anchor entry and thread `parent` keeps resolving; the projection re-maps id → path. " +
    "Refused with `423` when the other party holds the document's edit lock.",
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
    200: jsonContent(
      DocMutationResponseSchema,
      "The document at its new path, and any §14 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
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
    "change its identity (SERVER-078). Refused with `423` when the other party holds the lock on " +
    "the named document **or on any document the folder move carries**, since the act writes " +
    "those files too; the refusal names which document's lock is held.",
  request: { params: DocIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      DocMutationResponseSchema,
      "The document, now archived, and any §14 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
  },
});

export const unarchiveDoc = createRoute({
  method: "post",
  path: "/api/docs/{id}/unarchive",
  tags: ["docs"],
  summary: "Restore an archived document",
  description:
    "The inverse flip, back to `status: open`. **The document id never changes.** Unarchiving a " +
    "`type: skill` document moves its folder back out of `.claude/skills-archived/`, carrying " +
    "every file under it — including a **nested skill** the request never named, whose id is " +
    "stamped into it so the move does not change its identity, and whose `status` is reconciled " +
    "to the enabled root it now sits in (SERVER-078). Refused with `423` when the other party " +
    "holds the edit lock on the named document **or on any document the folder move carries**, " +
    "since the act writes those files too; the refusal names which document's lock is held.",
  request: { params: DocIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(DocMutationResponseSchema, "The document, restored, and any §14 warnings."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
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
    "Nothing is hard-deleted from history; git preserves the file and every version of it. Refused " +
    "with `423` when the other party holds the document's edit lock.",
  request: { params: DocIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      DeleteDocResultSchema,
      "The deleted id, the threads it orphaned, and any §14 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
  },
});
