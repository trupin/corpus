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
 *
 * **Strict bodies, tolerant reads (CONTRACT-017).** Every request *body* schema
 * — JSON and multipart alike — is `z.strictObject`: an unknown top-level key is
 * a `400` naming the key, never a silent no-op. A body is an instruction, and
 * an unknown key in one is either a typo of a declared key (`anchor` for
 * `selector` earned this issue: a `200` with a silently unanchored thread) or a
 * semantic the server would silently drop — accepting it means performing a
 * *different* mutation than the caller asked for, without telling them.
 * Openness stays where openness is the contract, one level down: `extra`,
 * `ViewQuery` and the queue event `payload` are open *values* of closed keys.
 * Query, path and header schemas stay tolerant: headers are an open set by
 * nature, and an unknown query parameter on a read yields a visible, recoverable
 * result rather than a wrong write. Responses are unchanged — clients do not
 * runtime-validate them, and the server builds them from these types anyway.
 *
 * `src/openapi.test.ts` enforces this too: every request body in the published
 * document must carry `additionalProperties: false`.
 */

export * from "./actor.js";
export * from "./anchor.js";
export * from "./attachment.js";
export * from "./capture.js";
export * from "./check.js";
export * from "./context.js";
export * from "./db.js";
export * from "./doc.js";
export * from "./edit.js";
export * from "./error.js";
export * from "./extra.js";
export * from "./form-answer.js";
export * from "./form.js";
export * from "./health.js";
export * from "./id.js";
export * from "./index-maintenance.js";
export * from "./job.js";
export * from "./lock.js";
export * from "./pagination.js";
export * from "./query.js";
export * from "./queue.js";
export * from "./retrieval.js";
export * from "./skill.js";
export * from "./sse.js";
export * from "./thread.js";
export * from "./time.js";
export * from "./tree.js";
export * from "./upgrade.js";
export * from "./warning.js";
