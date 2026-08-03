import {
  itemProblems,
  parseBodyItems,
  readLegacyItems,
  type ItemsSource,
  type TodoItem,
} from "../items.js";

/**
 * **Which storage state a todo document is in**, as far as the reader has to
 * explain it (PLUGINS-008).
 *
 * Items moved from an `items` frontmatter key into body task lines in
 * PLUGINS-005 (SPEC.md §12), and a workspace written before that lands in one
 * of three states nothing on screen used to name. All three read the same to a
 * user — a todo document with no checkboxes in it — and all three are fixed by
 * the same verb, so they are one branch and one notice rather than three.
 *
 * This module **derives and never writes**. Every answer here comes from
 * `items.ts`'s own exported reads, so the notice cannot claim a state the write
 * path disagrees with: {@link LegacyStorage.problems} is verbatim
 * {@link itemProblems}, which is the same clause `planWrite` refuses with.
 */
export type LegacyStorage =
  /** Nothing to say: body-stored items, or a legacy key with nothing in it. */
  | { readonly kind: "none" }
  /** Items in frontmatter, none in the body — the body renders empty. */
  | { readonly kind: "frontmatter"; readonly items: readonly TodoItem[] }
  /** A hand-edited `items` key that no longer parses; nothing can be read. */
  | { readonly kind: "malformed"; readonly problems: readonly string[] }
  /** Items in the body *and* in frontmatter; every write is refused with 400. */
  | { readonly kind: "dual"; readonly problems: readonly string[] };

const NONE: LegacyStorage = { kind: "none" };

/**
 * The document's storage state.
 *
 * An **empty** legacy key (`items: []`, or a null value) is deliberately
 * `none`: the key still has to go, but the next write clears it silently
 * (`planWrite` → `clearLegacy`), there is nothing invisible and nothing
 * refused. A notice there would announce a problem the user has not got, over
 * a document that is simply an empty todo list.
 */
export function legacyStorage(source: ItemsSource): LegacyStorage {
  const legacy = readLegacyItems(source.extra);
  if (legacy === null) return NONE;
  if (!legacy.ok) return { kind: "malformed", problems: itemProblems(source) };
  if (legacy.items.length === 0) return NONE;
  if (parseBodyItems(source.body ?? "").length > 0) {
    return { kind: "dual", problems: itemProblems(source) };
  }
  return { kind: "frontmatter", items: legacy.items };
}
