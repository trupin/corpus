import type { RevealItem } from "@corpus/kit/plugin";
import "./reveal.css";

/**
 * "Open this document **at this**" — the reader's half of UI-037's seam.
 *
 * A reveal names text, not a position: the caller knows the sentence, the item
 * or the quote it is pointing at, and nothing else. So this searches the
 * *rendered* surface rather than the markdown, which is what makes one
 * mechanism work in the editor, in a `MarkdownView` and inside a plugin's own
 * `View` — three renderers with three DOM shapes and no shared coordinate
 * system between them.
 *
 * **The flash is drawn, never applied.** The obvious implementation — add a
 * class to the element containing the match — puts a mutation into a DOM React
 * and ProseMirror both believe they own, and it cannot highlight half a
 * paragraph anyway. Instead the match's client rectangles are traced by
 * absolutely-positioned boxes over the page, which touches nothing, survives a
 * re-render underneath it, and disappears on its own. That is also why it is
 * transient by construction: there is no state to leave behind and no class to
 * forget to remove (contrast `.anchor-hl`, which is a *persistent* decoration
 * keyed on a thread and is not this).
 */

/** How long the reveal box stays lit — the `.thread-card.flash` duration. */
export const REVEAL_FLASH_MS = 1200;

/** Passes at finding the text before giving up; the body may still be arriving. */
export const REVEAL_ATTEMPTS = 5;

/** Delay between those passes. */
export const REVEAL_RETRY_MS = 80;

/**
 * Where a revealed match is parked when the reader has to scroll to it: a third
 * of the way down, so the text above it — the sentence it belongs to, the list
 * it is an item of — arrives with it.
 */
const REVEAL_MARGIN_RATIO = 3;

/**
 * Text nodes join without a separator, so a block boundary has to be spelled or
 * `<p>Buy milk</p><p>Next</p>` reads as one word. Ancestors, not tag names of
 * the node's own parent: `Buy <strong>milk</strong>` is one block split across
 * three nodes and must **not** gain a space in the middle of it.
 */
const BLOCK_TAGS =
  "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,div,section,article,figcaption,dt,dd,tr,ul,ol";

/** One character of the flattened text, and where it came from. */
interface TextPoint {
  readonly node: Text;
  readonly offset: number;
}

export interface TextIndex {
  /** The surface's text, whitespace collapsed, blocks separated by one space. */
  readonly text: string;
  /** `points[i]` is the DOM position of `text[i]`. */
  readonly points: readonly TextPoint[];
}

/** Whitespace collapsed the way the browser renders it, so a quote can be flat. */
export function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function blockOf(node: Text): Element | null {
  return node.parentElement?.closest(BLOCK_TAGS) ?? null;
}

/**
 * The rendered text of `root`, flattened, with every character's DOM position.
 *
 * Collapsing matters as much as flattening: a quote captured from a markdown
 * source carries the file's line breaks, and the same words on screen carry
 * whatever wrapping the renderer chose. Neither is the other's spelling, and
 * both collapse to the same thing.
 */
export function indexText(root: Node): TextIndex {
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT) ?? null;
  if (walker === null) return { text: "", points: [] };
  let text = "";
  const points: TextPoint[] = [];
  let previous: Text | null = null;

  const push = (character: string, node: Text, offset: number): void => {
    text += character;
    points.push({ node, offset });
  };

  for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
    const node = current as Text;
    if (node.parentElement?.closest("script,style") != null) continue;
    const value = node.data;
    if (value === "") continue;
    if (previous !== null && blockOf(previous) !== blockOf(node) && !text.endsWith(" ")) {
      // The separator borrows the next character's position: a match never
      // starts or ends on it, because the needle is collapsed and trimmed.
      push(" ", node, 0);
    }
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset] ?? "";
      if (/\s/u.test(character)) {
        if (text === "" || text.endsWith(" ")) continue;
        push(" ", node, offset);
        continue;
      }
      push(character, node, offset);
    }
    previous = node;
  }

  return { text, points };
}

/** Every start index of `needle` in `haystack`, in document order. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

/**
 * Which occurrence the caller meant (sprint-023 OC4).
 *
 * `exact` alone is ambiguous the moment a document repeats itself — two "Call
 * the plumber" items in one list is the ordinary case, not the exotic one — so
 * a caller that knows the surrounding text says so, and the occurrence framed
 * by that text wins. When nothing satisfies the frame the **first** occurrence
 * is still revealed: the quote is right and only the frame has drifted, and
 * flashing the first match beats flashing nothing at all.
 */
export function chooseOccurrence(
  haystack: string,
  needle: string,
  prefix: string,
  suffix: string,
): number | null {
  const found = occurrences(haystack, needle);
  if (found.length === 0) return null;
  // Trimmed on both sides of the join: whether the caller's quote carried the
  // space between the frame and the text is an accident of how it was captured,
  // and it must not be the difference between the right item and the first one.
  const head = prefix.trim();
  const tail = suffix.trim();
  if (head === "" && tail === "") return found[0] ?? null;
  const framed = found.find(
    (at) =>
      haystack.slice(0, at).trimEnd().endsWith(head) &&
      haystack
        .slice(at + needle.length)
        .trimStart()
        .startsWith(tail),
  );
  return framed ?? found[0] ?? null;
}

/**
 * The DOM range covering the target's text, or `null` when the surface does not
 * contain it — a body that has not arrived, or an item that was edited away
 * between the click and the open.
 */
export function findRevealRange(root: Node, target: RevealItem): Range | null {
  const needle = collapse(target.exact);
  if (needle === "") return null;
  const index = indexText(root);
  const at = chooseOccurrence(
    index.text,
    needle,
    collapse(target.prefix ?? ""),
    collapse(target.suffix ?? ""),
  );
  if (at === null) return null;
  const start = index.points[at];
  const end = index.points[at + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  const range = start.node.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/**
 * Scrolls the reader so the match is on screen — and only then. A match that is
 * already visible is left exactly where it is: the flash says where it is, and
 * yanking a surface the user can already see is the behaviour scroll
 * restoration goes to such lengths to avoid.
 *
 * The container's own `scrollTop` is moved rather than `scrollIntoView`, which
 * would also scroll the board sideways and the page under it.
 */
export function scrollRangeIntoView(container: HTMLElement, range: Range): void {
  // jsdom implements no layout, and therefore no range geometry at all.
  if (typeof range.getBoundingClientRect !== "function") return;
  const rect = range.getBoundingClientRect();
  const view = container.getBoundingClientRect();
  const offset = rect.top - view.top;
  if (offset >= 0 && offset + rect.height <= container.clientHeight) return;
  container.scrollTop += offset - container.clientHeight / REVEAL_MARGIN_RATIO;
}

/**
 * The rectangles a match occupies — one per rendered line — or none at all
 * under jsdom, which implements no layout. An empty answer still produces the
 * layer below: "revealed, with nothing to draw" is a real state, and hiding it
 * would make the surface untestable outside a browser.
 */
function rectsOf(range: Range): DOMRect[] {
  const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
  if (rects.length > 0) return rects;
  return typeof range.getBoundingClientRect === "function" ? [range.getBoundingClientRect()] : [];
}

/**
 * Draws the transient highlight over `range` and returns the undo.
 *
 * One box per client rectangle, so a match that wraps across two lines is lit
 * as two lines rather than as the rectangle enclosing both — which would cover
 * the text either side of it.
 */
export function flashRange(range: Range, host: HTMLElement): () => void {
  const layer = host.ownerDocument.createElement("div");
  layer.className = "reveal-flash-layer";
  layer.dataset["revealFlash"] = "";
  layer.setAttribute("aria-hidden", "true");

  for (const rect of rectsOf(range)) {
    if (rect.width === 0 && rect.height === 0) continue;
    const box = host.ownerDocument.createElement("div");
    box.className = "reveal-flash";
    box.style.top = `${String(rect.top)}px`;
    box.style.left = `${String(rect.left)}px`;
    box.style.width = `${String(rect.width)}px`;
    box.style.height = `${String(rect.height)}px`;
    layer.append(box);
  }
  host.append(layer);

  const timer = setTimeout(() => {
    layer.remove();
  }, REVEAL_FLASH_MS);

  return () => {
    clearTimeout(timer);
    layer.remove();
  };
}

/**
 * Reveals `target` inside `container`: scroll, then flash. Returns the flash's
 * undo, or `null` when the text is not on the surface — which is the caller's
 * signal to try again while the document is still arriving.
 */
export function revealItem(container: HTMLElement, target: RevealItem): (() => void) | null {
  const range = findRevealRange(container, target);
  if (range === null) return null;
  scrollRangeIntoView(container, range);
  const host = container.ownerDocument.body;
  return flashRange(range, host);
}
