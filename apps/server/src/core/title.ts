/**
 * **The title a document goes by** — one derivation, for every reader and for
 * the one writer (SPEC.md §5, and §4's edit acknowledgment).
 *
 * A document's frontmatter need not carry `title:` at all. §7's hand-written
 * skills and personas carry Claude Code's `name:` instead, and a file dropped
 * into `data/docs/` by hand may carry neither. Every surface in the product
 * still shows such a document under a name: the projection row, `GET
 * /api/docs/{id}`, the board, the search index and an auto-commit's subject all
 * resolve `title:`, then `name:`, then a last-resort name taken from the path.
 * That resolved value — not the raw key — is what the spec means by "the title
 * it goes by", so it is what a *write* has to compare against too.
 *
 * That last point is the reason this function exists rather than the expression
 * being written wherever it is wanted (SERVER-100). §4 opens an edit session on
 * "a change to what the document **says** — its body, or the title it goes by",
 * and closes with "a save re-sending a body or title identical to the stored one
 * changes nothing and opens nothing". The reader autosaves the title it is
 * displaying, which is this value. Comparing it against the raw `title:` key
 * instead made a document that had never carried one look renamed on the first
 * save after it was opened: the file gained `title:`, `updated` moved, a commit
 * landed and the agent was woken to reflect on an edit nobody made. It is the
 * same trap `docs/update.ts`'s `origin` stamp fell into and PR #47 closed — a
 * write whose comparison asks a different question from the one the reader
 * answers is a write that disagrees with what the caller was shown.
 *
 * `fallback` is what the caller has when the file names nothing: the projection
 * derives it from the path, and every caller downstream of the projection passes
 * the row's own `title` so the two cannot part company.
 *
 * A blank or whitespace-only value is *not* a name, and falls through to the
 * next rung — the same rule the projection and the wire frontmatter apply, so a
 * `title: ""` left by hand reads as "unnamed" everywhere rather than as a title
 * on one surface and a filename on another.
 */
export function documentTitle(data: Readonly<Record<string, unknown>>, fallback: string): string {
  return named(data["title"]) ?? named(data["name"]) ?? fallback;
}

const named = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;
