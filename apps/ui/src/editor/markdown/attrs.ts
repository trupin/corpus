/**
 * Reading node attributes without lying about their type.
 *
 * ProseMirror types `node.attrs` as `Record<string, any>` — it has to, because
 * a schema is assembled at runtime — so every read is an `any` escaping into
 * typed code. Funnelling them through these two narrows the escape to one file
 * and gives every attribute a defined value: a `docRef` whose `id` came back
 * `undefined` renders as an empty reference rather than as the string
 * `"undefined"` written into the user's file.
 */

/** A required string attribute, or `""` when the attribute is anything else. */
export function stringAttr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** An optional string attribute; empty and absent are both `null`. */
export function optionalStringAttr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A numeric attribute, or the fallback when it is anything else. */
export function numberAttr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
