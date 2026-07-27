import { createRoute, z } from "@hono/zod-openapi";
import { AttachmentPathSchema } from "../schemas/attachment.js";
import { NOT_FOUND_RESPONSE, UNAUTHORIZED_RESPONSE, VALIDATION_RESPONSE } from "./responses.js";

/**
 * Attachment bytes (SPEC.md §6, §9.2). Declared so the contract describes the
 * whole HTTP surface, but deliberately without a client helper: attachment URLs
 * are used directly in `<img src>` and download links, where a fetch wrapper
 * would be in the way rather than useful.
 */
export const getAttachment = createRoute({
  method: "get",
  path: "/attachments/{path}",
  tags: ["attachments"],
  summary: "Read attachment bytes",
  description:
    "Serves a file from `.corpus/attachments/`. The `path` parameter is slash-bearing " +
    "(`<thread-id>/<turn-ts>/<filename>`), so servers mount it as a wildcard rather than a single " +
    "segment. The declared response type is `application/octet-stream`; the actual `content-type` is " +
    "sniffed from the file, so images render inline in the UI and other files download as chips.",
  request: {
    params: z.object({
      path: AttachmentPathSchema.openapi({ param: { name: "path", in: "path", required: true } }),
    }),
  },
  responses: {
    200: {
      description: "The attachment bytes.",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
