/**
 * Surgery on a document's `anchors` map (SPEC.md §6).
 *
 * Anchor entries live in the frontmatter of the **commented** document, and
 * exactly two writes ever touch them outside reconciliation: a comment being
 * created adds one, and a thread being deleted removes one. Both write paths
 * need the same two rules, so they live here rather than being restated on each
 * side:
 *
 * - **Unrecognised entries survive.** The map is read as raw YAML, not through
 *   the selector schema. A hand-edited file with one malformed entry must not
 *   lose it just because someone commented on the document — `doc check` reports
 *   it (§14), the write path preserves it.
 * - **The map is always an object.** A file whose `anchors` key is missing, null
 *   or (wrongly) a list starts from an empty map rather than failing the write;
 *   the alternative is refusing to accept a comment because of a typo elsewhere
 *   in the frontmatter.
 *
 * Pure functions over plain values: no I/O, no schema, no parser.
 */

/** The raw `anchors` mapping of a frontmatter block, or `{}` when there is none usable. */
export const anchorEntries = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
};

/** The map with one entry added or replaced. The selector is stored verbatim. */
export const withAnchorEntry = (
  value: unknown,
  anchorId: string,
  selector: Readonly<Record<string, unknown>>,
): Record<string, unknown> => ({ ...anchorEntries(value), [anchorId]: { ...selector } });

/**
 * The map with one entry removed, or `null` when the key was not there — which
 * is how a caller tells "the cascade removed an anchor" from "there was nothing
 * to remove" without re-reading the map.
 */
export const withoutAnchorEntry = (
  value: unknown,
  anchorId: string,
): Record<string, unknown> | null => {
  const entries = anchorEntries(value);
  if (!Object.hasOwn(entries, anchorId)) return null;
  delete entries[anchorId];
  return entries;
};
