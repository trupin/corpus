import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

// Unnamed on purpose — see the note in `id.ts` about derived schemas inheriting
// a registered component name.

/** Every timestamp the API exchanges is an ISO 8601 instant in UTC (SPEC.md §5). */
export const IsoDateTimeSchema = openapi(z.iso.datetime(), { example: "2026-07-19T10:05:00Z" });

/** Calendar dates (`due`) carry no time component. */
export const IsoDateSchema = openapi(z.iso.date(), { example: "2026-08-01" });

export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
