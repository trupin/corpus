/**
 * The one tag-delta rule in the server, applied by both writes that carry one:
 * `POST /api/docs/bulk`'s §10 `tag` act and `PUT /api/docs/{id}`'s
 * `addTags`/`removeTags` (SERVER-102).
 *
 * It exists as a shared function rather than as two matching implementations
 * because the two paths are the two halves of one guarantee. SPEC.md §7 says a
 * write that names its own delta "merges with whatever else happened rather than
 * overwriting it", and until SERVER-102 that was true of the bulk act and false
 * of the single-document one — not because the merges disagreed, but because
 * only one of them existed on the server. A second copy of this arithmetic would
 * be the same failure waiting in a subtler form: the two could drift on order,
 * on duplicates, or on a tag named in both lists, and nothing would say so.
 */

/**
 * §10's rule, stated once: **a delta, never a replacement** — "adds or removes
 * the named tags and never replaces a document's tag set".
 *
 * Existing order is preserved and additions are appended, so tagging twenty
 * documents leaves twenty tag sets that still differ from each other. A tag
 * named in both lists is **removed**: `remove` is applied to what is there and
 * then withheld from what would be added, so the answer does not depend on which
 * list the caller wrote first.
 *
 * `current` is the raw YAML value, not a validated list, because that is what
 * both call sites hold: a file whose `tags:` key is a string, a map or absent
 * must still be taggable, and reading it as "no tags" is the same thing every
 * reader in the projection does with it.
 */
export function nextTags(
  current: unknown,
  add: readonly string[] = [],
  remove: readonly string[] = [],
): string[] {
  const removed = new Set(remove);
  const tags = (Array.isArray(current) ? current : [])
    .filter((tag): tag is string => typeof tag === "string")
    .filter((tag) => !removed.has(tag));
  for (const tag of add) {
    if (!removed.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
