/**
 * `CSS.escape`, or a sufficient stand-in.
 *
 * Every id this is used on is a `doc_*`, `th_*` or `anc_*` — letters, digits
 * and underscores, which need no escaping at all. The call is still made,
 * because a selector built by concatenation is a selector injection waiting for
 * the first id that is not, and jsdom (which the component tests run in)
 * implements no `CSS` object, so the guard is what keeps the same code path
 * working in both.
 */
export function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^\w-]/g, (character) => `\\${character}`);
}
