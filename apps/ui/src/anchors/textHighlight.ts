/**
 * Anchor highlights on a **rendered** body (SPEC.md §11: a selection commented
 * on inside a turn "is highlighted in the turn the way an anchor is highlighted
 * in a document").
 *
 * In a document the highlight is a ProseMirror decoration, which the editor owns
 * and can draw inside its own DOM. A turn is `react-markdown` output: React owns
 * every node, and wrapping the anchored words in a `<mark>` would be a second
 * writer of that tree — undone by the next render, and fighting it with a
 * portal or a mutation observer would be worse. The CSS Custom Highlight API
 * paints over live `Range`s instead, touching nothing: the styling lives in
 * `thread.css` under `::highlight()`, and the ranges live here.
 *
 * **One registry, many painters.** The API is keyed by name on the document, so
 * the several thread cards a board shows at once cannot each own the name.
 * Painters register under their own token and the union is what is set, which is
 * also what makes a card's cleanup remove exactly its own ranges.
 *
 * Absent support is not an error. Every browser Corpus targets has the API; a
 * test environment (jsdom) has none, and the fallback is simply no highlight,
 * never a crash — the anchor is still listed, still opens, and still says what
 * it quotes.
 */

/** The name `thread.css` styles. */
export const TURN_ANCHOR_HIGHLIGHT = "corpus-turn-anchor";

/** What this module needs of `CSS.highlights`. */
interface HighlightRegistryLike {
  set(name: string, highlight: Highlight): void;
  delete(name: string): boolean;
}

const painters = new Map<object, readonly Range[]>();

function registry(): HighlightRegistryLike | null {
  const api = globalThis.CSS as { highlights?: HighlightRegistryLike } | undefined;
  if (api?.highlights === undefined) return null;
  return typeof globalThis.Highlight === "function" ? api.highlights : null;
}

function repaint(): void {
  const highlights = registry();
  if (highlights === null) return;
  const all = [...painters.values()].flat();
  if (all.length === 0) {
    highlights.delete(TURN_ANCHOR_HIGHLIGHT);
    return;
  }
  highlights.set(TURN_ANCHOR_HIGHLIGHT, new Highlight(...all));
}

/**
 * Replace one painter's ranges. An empty list unregisters it, which is what a
 * card's effect cleanup calls.
 */
export function setAnchorHighlights(painter: object, ranges: readonly Range[]): void {
  if (ranges.length === 0) painters.delete(painter);
  else painters.set(painter, ranges);
  repaint();
}

/** How many ranges are painted, in total — the test seam for a jsdom run. */
export function anchorHighlightCount(): number {
  return [...painters.values()].reduce((total, ranges) => total + ranges.length, 0);
}

/** Test seam: forgets every painter. */
export function resetAnchorHighlights(): void {
  painters.clear();
  repaint();
}
