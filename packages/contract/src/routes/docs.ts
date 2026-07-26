import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  CreateDocRequestSchema,
  DocListSchema,
  DocSchema,
  DocsQuerySchema,
  UpdateDocRequestSchema,
  UpdateDocResponseSchema,
} from "../schemas/doc.js";
import { DocumentIdSchema } from "../schemas/id.js";
import {
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
  request: { query: DocsQuerySchema },
  responses: {
    200: jsonContent(DocListSchema, "Matching documents, newest-updated first."),
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

export const createDoc = createRoute({
  method: "post",
  path: "/api/docs",
  tags: ["docs"],
  summary: "Create a document",
  description:
    "The body is pre-filled from the type's `template` document when one exists and no body is given " +
    "(SPEC.md §9.2). The server assigns the id; it is immutable thereafter.",
  request: {
    headers: ActorHeaderSchema,
    body: { content: { "application/json": { schema: CreateDocRequestSchema } } },
  },
  responses: {
    201: jsonContent(DocSchema, "The created document."),
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
    "and which were orphaned. Refused with `423` when the other party holds the document's edit lock.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: { content: { "application/json": { schema: UpdateDocRequestSchema } } },
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
