import { z } from "@hono/zod-openapi";

/**
 * Attachment plumbing for the two multipart request bodies (SPEC.md §6). Bytes
 * live under `.corpus/attachments/<thread-id>/<turn-ts>/` and are gitignored;
 * what lands in the committed markdown is a relative link the server writes into
 * the turn body. There is deliberately no `AttachmentRef` resource here: the
 * projection's `turns` table carries only `body_md` (SPEC.md §9.1), so no
 * endpoint can produce a structured attachment list, and a schema no route
 * returns would be contract surface with no producer.
 */

/**
 * One uploaded part. `z.custom` rather than `z.instanceof(File)` so the schema
 * carries a readable message, and the OpenAPI shape is pinned by hand because
 * "a file" has no Zod primitive.
 */
export const AttachmentFileSchema = z
  .custom<File>((value) => value instanceof File, { message: "Expected an uploaded file part." })
  .openapi({ type: "string", format: "binary" });

/**
 * The repeated `files` part, normalised to an array.
 *
 * Hono's form parser returns a bare `File` for a single occurrence of a key and
 * an array only from the second onwards, so a schema demanding an array would
 * reject exactly the common case of one attachment. The preprocess absorbs that
 * asymmetry; the published OpenAPI shape stays a plain array of binaries.
 */
export const AttachmentFilesSchema = z
  .preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(AttachmentFileSchema).default([]),
  )
  .openapi({
    type: "array",
    items: { type: "string", format: "binary" },
    description:
      "Attached files, sent as repeated `files` parts. Bytes are stored under " +
      "`.corpus/attachments/<thread-id>/<turn-ts>/` and referenced from the turn body by relative " +
      "markdown links (SPEC.md §6).",
  });

/**
 * Path of an attachment relative to `.corpus/attachments/`. It contains slashes,
 * so servers mount it as a wildcard segment and clients must encode each
 * component rather than the string as a whole.
 */
export const AttachmentPathSchema = z
  .string()
  .min(1)
  .openapi({
    description:
      "Attachment path relative to `.corpus/attachments/`, i.e. " +
      "`<thread-id>/<turn-ts>/<filename>`. Slash-bearing, so it occupies the rest of the URL path.",
    example: "th_x9y8/2026-07-19T10:05:00Z/screenshot.png",
  });

export type AttachmentPath = z.infer<typeof AttachmentPathSchema>;
