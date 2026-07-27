import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { DocumentIdSchema } from "../schemas/id.js";
import {
  AcquireLockRequestSchema,
  LockListSchema,
  LockReapResultSchema,
  LockSchema,
  ReleaseLockResultSchema,
} from "../schemas/lock.js";
import {
  FORBIDDEN_RESPONSE,
  jsonContent,
  LOCK_CONFLICT_RESPONSE,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * Per-document edit locks (SPEC.md §7). Two failure codes are deliberately
 * distinguished across the API: `409` here means "your lock request conflicts
 * with an existing holder", while `423` on the document write paths means "this
 * write is refused because the document is locked by someone else". Conflating
 * them would leave a client unable to tell "try again as a lock" from "you may
 * not write at all".
 */
const DocIdParamSchema = z.object({
  docId: DocumentIdSchema.openapi({ param: { name: "docId", in: "path", required: true } }),
});

export const listLocks = createRoute({
  method: "get",
  path: "/api/locks",
  tags: ["locks"],
  summary: "List active locks",
  description:
    "Read on load so lock banners are correct before the first SSE frame arrives; lock state is " +
    "projected and broadcast like any other state (SPEC.md §7).",
  responses: {
    200: jsonContent(LockListSchema, "Every lock currently held."),
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const reapLocks = createRoute({
  method: "post",
  path: "/api/locks/reap",
  tags: ["locks"],
  summary: "Clear expired locks",
  description:
    "Clears every lock past its TTL, so a crashed editor cannot wedge a document — the same pattern " +
    "as `POST /api/queue/reap-stale` (SPEC.md §7).",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(LockReapResultSchema, "The documents whose expired locks were cleared."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const acquireLock = createRoute({
  method: "post",
  path: "/api/locks/{docId}",
  tags: ["locks"],
  summary: "Acquire a document's edit lock",
  description:
    "One holder at a time. The agent takes the lock before editing (the CLI's edit verbs do this " +
    "implicitly) and the user's editor session holds it while actively editing (SPEC.md §7). " +
    "Re-acquiring a lock you already hold renews its lease; a lock held by the other party is a " +
    "`409` carrying that lock. The body is optional in full: a bare `POST` takes the lock for the " +
    "default lease, and `ttl`, when given, sets a different one.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description: "Optional lease override; omit the body entirely to take the default lease.",
      content: { "application/json": { schema: AcquireLockRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(LockSchema, "The lock, now held by the acting party."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: LOCK_CONFLICT_RESPONSE,
  },
});

export const releaseLock = createRoute({
  method: "delete",
  path: "/api/locks/{docId}",
  tags: ["locks"],
  summary: "Release a document's edit lock",
  description:
    "Only the holder may release: a request whose `x-corpus-author` is not the holder is rejected " +
    "with `403`. To clear somebody else's lock, break it.",
  request: { params: DocIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(ReleaseLockResultSchema, "The lock is gone."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const breakLock = createRoute({
  method: "post",
  path: "/api/locks/{docId}/break",
  tags: ["locks"],
  summary: "Force-unlock a document (user-only)",
  description:
    "The human escape hatch for a stuck agent lock — the banner's Force unlock button and " +
    "`corpus lock break <docId>` (SPEC.md §7). **User-only**: a request carrying " +
    "`x-corpus-author: agent` is rejected with `403`, because an agent breaking its own contention " +
    "would defeat the mechanism. Breaks are recorded in the audit trail commit message, and the " +
    "agent's deferred edit re-enters the queue rather than being lost.",
  request: { params: DocIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(ReleaseLockResultSchema, "The lock is broken; `holder` names who held it."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
