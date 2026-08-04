import type { SelectionRange } from "../editor/selection";

/**
 * A rendered surface's text, and the DOM ranges that address it.
 *
 * The counterpart of `sourceTrace.ts` on the other side of the render: that one
 * says what text a markdown body produces, this one says what text a *rendered*
 * body is showing and where in the DOM each character sits. Between them a
 * selection made with a mouse becomes a §6 text-quote selector, and an anchor
 * the server resolved becomes a highlight.
 *
 * **Chrome is not content.** A rendered body carries elements nobody wrote: the
 * fence's copy button and its info-string label (`CodeFence`), and the resolved
 * *title* a `[[ref]]` renders as. None of them is in the file, so none of them
 * is in this text — including them would shift every offset after the first one
 * and make a quote describe words the document does not contain.
 */

/** Elements whose text belongs to the renderer rather than to the document. */
const CHROME =
  "button, [data-fence-label], [data-corpus-ref], [data-corpus-ref-broken], [aria-hidden='true']";

interface TextRun {
  readonly node: Text;
  /** Where this node's text starts in {@link RenderedText.text}. */
  readonly start: number;
}

export interface RenderedText {
  readonly root: Element;
  readonly text: string;
  readonly runs: readonly TextRun[];
}

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/**
 * Chrome-ness is asked of the ancestors **up to the root**, never past it: a
 * `closest()` walking the whole tree would let one `aria-hidden` wrapper
 * somewhere above the reader empty out every body on the page.
 */
function inChrome(node: Node, root: Element): boolean {
  for (let element = node.parentElement; element !== null; element = element.parentElement) {
    if (element === root) return false;
    if (element.matches(CHROME)) return true;
  }
  return false;
}

/** The text a rendered surface is showing, in document order. */
export function renderedTextOf(root: Element): RenderedText {
  const runs: TextRun[] = [];
  let text = "";
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!isText(node) || inChrome(node, root)) continue;
    runs.push({ node, start: text.length });
    text += node.data;
  }
  return { root, text, runs };
}

/**
 * Where a DOM range sits in the rendered text, or `null` when it touches none of
 * it.
 *
 * Asked of the **text nodes**, never of their containers: a range's boundary can
 * be an element plus an offset into its children, and a container-based reading
 * would answer about the block rather than about the characters.
 */
export function renderedOffsetsOfRange(
  rendered: RenderedText,
  range: Range,
): SelectionRange | null {
  let start: number | null = null;
  let end = 0;
  for (const run of rendered.runs) {
    if (!range.intersectsNode(run.node)) continue;
    const from = range.startContainer === run.node ? range.startOffset : 0;
    const to = range.endContainer === run.node ? range.endOffset : run.node.data.length;
    if (start === null) start = run.start + from;
    end = run.start + to;
  }
  if (start === null || end <= start) return null;
  return { start, end };
}

/** A live DOM range over `[start, end)` of the rendered text, for a highlight. */
export function domRangeOfRendered(
  rendered: RenderedText,
  start: number,
  end: number,
): Range | null {
  if (end <= start) return null;
  const range = rendered.root.ownerDocument.createRange();
  let opened = false;
  for (const run of rendered.runs) {
    const stop = run.start + run.node.data.length;
    if (!opened && start < stop) {
      range.setStart(run.node, start - run.start);
      opened = true;
    }
    if (opened && end <= stop) {
      range.setEnd(run.node, end - run.start);
      return range;
    }
  }
  return null;
}

/**
 * The selection with its whitespace edges removed.
 *
 * A double-click drags a trailing space in, and a drag across a paragraph break
 * picks up the newline between two blocks. Neither is what the person meant to
 * quote, and `exact` is `min(1)` on the wire (SPEC.md §6) — a quote of spaces
 * would resolve against every indent in the document.
 */
export function trimToText(text: string, range: SelectionRange): SelectionRange | null {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  return end > start ? { start, end } : null;
}
