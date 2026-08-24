import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

// Primitives are deliberately *not* registered as named OpenAPI components.
// zod-to-openapi carries a schema's registered name onto anything derived from
// it, so `SomeNamed.nullable()` re-registers the nullable variant under the same
// name and silently corrupts the component definition. Only object/resource
// schemas — which are always used unmodified — get names; primitives inline.

/**
 * Ids are opaque, immutable, and prefixed by kind (SPEC.md §5): documents are
 * `doc_*`, threads `th_*`, anchors `anc_*`, queue events `evt_*`. The prefix is
 * validated so a caller cannot pass a thread id where a queue event belongs.
 */
const prefixed = (prefix: string): RegExp => new RegExp(`^${prefix}_[A-Za-z0-9]+$`);

export const DocIdSchema = openapi(z.string().regex(prefixed("doc")), {
  description: "Identifier of a non-thread document.",
  example: "doc_a1b2c3",
});

export const ThreadIdSchema = openapi(z.string().regex(prefixed("th")), {
  description: "Identifier of a thread document.",
  example: "th_x9y8",
});

/**
 * Any document id. Threads are documents (SPEC.md §6), so routes that address a
 * document — and a thread's `parent` — accept either prefix.
 */
export const DocumentIdSchema = openapi(z.string().regex(/^(doc|th)_[A-Za-z0-9]+$/), {
  description: "Identifier of any document; threads are documents too.",
  example: "doc_a1b2c3",
});

export const AnchorIdSchema = openapi(z.string().regex(prefixed("anc")), {
  description: "Identifier of an anchor entry, unique within its document.",
  example: "anc_k4f7",
});

export const EventIdSchema = openapi(z.string().regex(prefixed("evt")), {
  description: "Identifier of a queue event.",
  example: "evt_7c1d",
});

/**
 * Identifier of **one designation of a resident** (CONTRACT-071, SPEC.md §7).
 *
 * The only id here that names an **act** rather than a stored thing: `doc_`,
 * `th_`, `anc_` and `evt_` all address something a caller can fetch, while this
 * addresses nothing — there is no designation resource, and adding one would
 * publish a second way to ask what `Resident` (`./agents.ts`) already answers.
 * It exists to be **compared**, and comparison is the whole of what it is for.
 *
 * Opaque in the way §5 already means: no part of it is derived from the profile,
 * the weight, the thread or the instant, so nothing may be recovered from it and
 * two of them have no order. A caller that wants to know *what* a designation
 * says reads the fields beside it.
 */
export const DesignationIdSchema = openapi(z.string().regex(prefixed("des")), {
  description:
    "Identifier of one designation of a resident (SPEC.md §7). Opaque and comparable, and " +
    "nothing else: it addresses no resource, encodes nothing about the designation it names, " +
    "and two of them have no order — the only sound operation on it is equality.",
  example: "des_9f2a1c",
});

export type DocId = z.infer<typeof DocIdSchema>;
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type DocumentId = z.infer<typeof DocumentIdSchema>;
export type AnchorId = z.infer<typeof AnchorIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type DesignationId = z.infer<typeof DesignationIdSchema>;
