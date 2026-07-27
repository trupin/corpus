/**
 * The contract's Zod schemas, one module per resource.
 *
 * **Optional-in, defaulted-out.** A request-side field the server fills in is
 * `.optional()` on the wire, with the server-applied default stated in its
 * description. `.default()` is reserved for response- and parse-side schemas,
 * where the parsed object should carry the value.
 *
 * The reason is mechanical rather than stylistic: `openapi-typescript` promotes
 * any property carrying a JSON Schema `default` to a **required** member of the
 * generated type, ignoring the schema's `required` array. A `.default()` on a
 * request field therefore forces every typed caller to send exactly the field
 * the default exists to spare it — inverting the intent (CONTRACT-003).
 *
 * A schema serving both roles is split rather than compromised: see
 * `TextQuoteSelectorSchema` (parse-side, defaults the context strings) beside
 * `TextQuoteSelectorRequestSchema` (wire-side, leaves them optional). A
 * Zod-level default that must survive for server parsing belongs in a
 * server-side parse wrapper, never in the shared request schema.
 *
 * `src/openapi.test.ts` enforces the rule across the whole request surface.
 */

export * from "./actor.js";
export * from "./anchor.js";
export * from "./attachment.js";
export * from "./capture.js";
export * from "./db.js";
export * from "./doc.js";
export * from "./error.js";
export * from "./form.js";
export * from "./health.js";
export * from "./id.js";
export * from "./job.js";
export * from "./lock.js";
export * from "./pagination.js";
export * from "./query.js";
export * from "./queue.js";
export * from "./sse.js";
export * from "./thread.js";
export * from "./time.js";
export * from "./tree.js";
export * from "./warning.js";
