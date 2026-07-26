import type { z } from "@hono/zod-openapi";
import {
  LockedErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from "../schemas/error.js";

/** Wraps a schema as a single-content-type JSON response entry for `createRoute`. */
export const jsonContent = <T extends z.ZodType>(schema: T, description: string) =>
  ({ description, content: { "application/json": { schema } } }) as const;

export const UNAUTHORIZED_RESPONSE = jsonContent(
  UnauthorizedErrorSchema,
  "Missing or invalid workspace bearer token.",
);

export const VALIDATION_RESPONSE = jsonContent(
  ValidationErrorSchema,
  "The request failed schema validation; `issues` names the offending fields.",
);

export const NOT_FOUND_RESPONSE = jsonContent(NotFoundErrorSchema, "No such resource.");

export const LOCKED_RESPONSE = jsonContent(
  LockedErrorSchema,
  "The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7).",
);
