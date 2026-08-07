import type { Node as PmDocument } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { PmRange } from "./offsetMap";

/**
 * Anchor highlights, as ProseMirror **decorations** — never as marks.
 *
 * SPEC.md §6 is unambiguous: "the body stays clean — no inline markers". An
 * anchor is a text-quote selector in the *parent's frontmatter*, and the
 * highlight is a thing drawn over the document, not a thing written into it. A
 * mark would be in the schema, in the ProseMirror document, and therefore in
 * the serializer's output and on disk — every save would write markup into a
 * file the spec promises stays plain. A decoration cannot: it lives in this
 * plugin's state, `serializeDoc(editor.state.doc)` never sees it, and the proof
 * is a byte comparison (sprint-011 TEST-89).
 *
 * Two sources of truth, in order:
 *
 * 1. **The server**, through a `setAnchors` meta — the `GET /api/docs/{id}`
 *    read on open, and the `PUT` reconciliation report after every save. The
 *    server owns §6's four-step resolution ladder; this plugin never searches
 *    text for an anchor (sprint-011 TEST-99).
 * 2. **The transaction's mapping**, between those reports, so a highlight
 *    follows the words while they are being typed around rather than waiting
 *    700ms for the debounce.
 *
 * A range the local mapping collapses to nothing is **retained and hidden**
 * rather than dropped: deleting an anchored phrase and immediately retyping it
 * must not make the thread blink out of existence and back, and only the server
 * gets to say the anchor is orphaned (sprint-011 TEST-111).
 */

export interface AnchorPlacement {
  readonly anchorId: string;
  readonly threadId: string;
  /** A resolved thread reads as resolved: dotted underline, grey pip. */
  readonly resolved: boolean;
  /** What the pip shows. */
  readonly turnCount: number;
  /** One per textblock the anchor covers; empty for an orphan. */
  readonly segments: readonly PmRange[];
}

export interface AnchorPluginState {
  readonly anchors: readonly AnchorPlacement[];
  readonly set: DecorationSet;
}

export const anchorPluginKey = new PluginKey<AnchorPluginState>("corpusAnchors");

/** The meta a host dispatches to replace the set from server data. */
interface SetAnchorsMeta {
  readonly anchors: readonly AnchorPlacement[];
}

export function anchorState(state: EditorState): AnchorPluginState | undefined {
  return anchorPluginKey.getState(state);
}

/** The transaction that makes the server's answer the truth on screen. */
export function setAnchorsTransaction(
  state: EditorState,
  anchors: readonly AnchorPlacement[],
): Transaction {
  const meta: SetAnchorsMeta = { anchors };
  // Not undoable: an anchor report is not something the user did, and ⌘Z after
  // a save must undo the sentence, not the highlight that arrived with it.
  return state.tr.setMeta(anchorPluginKey, meta).setMeta("addToHistory", false);
}

/** The pip: a widget, so it is drawn beside the text without ever being in it. */
function pip(anchor: AnchorPlacement): HTMLElement {
  const element = document.createElement("span");
  element.className = anchor.resolved ? "anchor-pip resolved" : "anchor-pip";
  element.setAttribute("data-pip-thread", anchor.threadId);
  element.setAttribute("contenteditable", "false");
  element.textContent = String(anchor.turnCount);
  return element;
}

function visibleSegments(anchor: AnchorPlacement, size: number): PmRange[] {
  return anchor.segments
    .map((segment) => ({ from: Math.min(segment.from, size), to: Math.min(segment.to, size) }))
    .filter((segment) => segment.to > segment.from);
}

export interface DecorationHosts {
  /**
   * The element this thread's collapsed chip renders into, or `null` for none.
   *
   * SPEC.md §11 puts the chip **at the anchor** in a narrow column, and the
   * body is one contenteditable surface — so the chip is a widget decoration
   * placed after the anchor's top-level block, and React portals the real
   * `ThreadPanel` into the element this returns. The element is owned by the
   * host and reused across rebuilds, which is what keeps an expanded card's
   * state (and its composer's text) alive through a keystroke elsewhere in the
   * document.
   */
  readonly slotFor?: ((threadId: string) => HTMLElement | null) | undefined;
}

export function buildDecorations(
  doc: PmDocument,
  anchors: readonly AnchorPlacement[],
  hosts: DecorationHosts = {},
): Decoration[] {
  const decorations: Decoration[] = [];
  anchors.forEach((anchor, index) => {
    const segments = visibleSegments(anchor, doc.content.size);
    for (const segment of segments) {
      decorations.push(
        Decoration.inline(
          segment.from,
          segment.to,
          {
            class: anchor.resolved ? "anchor-hl resolved" : "anchor-hl",
            "data-thread": anchor.threadId,
            "data-anchor": anchor.anchorId,
          },
          // Typing at either edge is typing *beside* the quote, not inside it.
          { inclusiveStart: false, inclusiveEnd: false },
        ),
      );
    }
    const last = segments.at(-1);
    if (last === undefined) return;
    decorations.push(
      Decoration.widget(last.to, () => pip(anchor), {
        // Negative side puts the pip inside the highlight's span, where
        // `design/index.html` draws it. Distinct per anchor so two anchors
        // ending on the same word render their pips side by side in a stable
        // order rather than fighting over one slot (sprint-011 TEST-100).
        side: -1 - index,
        key: `pip:${anchor.threadId}:${String(anchor.turnCount)}:${String(anchor.resolved)}`,
        ignoreSelection: true,
        stopEvent: () => false,
      }),
    );

    const slot = hosts.slotFor?.(anchor.threadId) ?? null;
    if (slot === null) return;
    decorations.push(
      Decoration.widget(afterBlockOf(doc, last.to), () => slot, {
        // Keyed by thread alone: the chip must survive every rebuild the
        // decoration set goes through, or an expanded card would remount (and
        // re-mark itself seen) on every keystroke in the paragraph above it.
        key: `slot:${anchor.threadId}`,
        side: 1 + index,
        ignoreSelection: true,
        // The slot is a React tree, not text. ProseMirror must not read events
        // inside it as edits to the document underneath.
        stopEvent: () => true,
      }),
    );
  });
  return decorations;
}

/** The position just after the top-level block containing `position`. */
export function afterBlockOf(doc: PmDocument, position: number): number {
  const at = doc.resolve(Math.min(position, doc.content.size));
  return at.depth === 0 ? at.pos : at.after(1);
}

/** Follows the text through one transaction, keeping collapsed ranges. */
export function mapAnchors(
  anchors: readonly AnchorPlacement[],
  transaction: Transaction,
): AnchorPlacement[] {
  return anchors.map((anchor) => ({
    ...anchor,
    segments: anchor.segments.map((segment) => {
      const from = transaction.mapping.map(segment.from, 1);
      const to = transaction.mapping.map(segment.to, -1);
      return { from, to: Math.max(from, to) };
    }),
  }));
}

/** The anchor whose range is shortest among those covering `position`. */
export function innermostAt(
  anchors: readonly AnchorPlacement[],
  position: number,
): AnchorPlacement | null {
  let best: AnchorPlacement | null = null;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    for (const segment of anchor.segments) {
      if (segment.to <= segment.from) continue;
      if (position < segment.from || position > segment.to) continue;
      const width = segment.to - segment.from;
      if (width < bestWidth) {
        best = anchor;
        bestWidth = width;
      }
    }
  }
  return best;
}

export interface AnchorPluginOptions {
  /** Clicking a highlight opens its thread. Read through a ref so it can change. */
  readonly onActivate: { current: ((threadId: string) => void) | undefined };
  /** Where the inline chips render, in chip mode. Read through a ref for the same reason. */
  readonly slotFor?: { current: ((threadId: string) => HTMLElement | null) | undefined };
}

export function anchorDecorationPlugin({ onActivate, slotFor }: AnchorPluginOptions): Plugin {
  const hosts: DecorationHosts = { slotFor: (threadId) => slotFor?.current?.(threadId) ?? null };
  return new Plugin<AnchorPluginState>({
    key: anchorPluginKey,
    state: {
      init: () => ({ anchors: [], set: DecorationSet.empty }),
      apply(transaction, value) {
        const meta = transaction.getMeta(anchorPluginKey) as SetAnchorsMeta | undefined;
        if (meta !== undefined) {
          return {
            anchors: meta.anchors,
            set: DecorationSet.create(
              transaction.doc,
              buildDecorations(transaction.doc, meta.anchors, hosts),
            ),
          };
        }
        if (!transaction.docChanged) return value;
        const anchors = mapAnchors(value.anchors, transaction);
        return {
          anchors,
          set: DecorationSet.create(
            transaction.doc,
            buildDecorations(transaction.doc, anchors, hosts),
          ),
        };
      },
    },
    props: {
      decorations(state) {
        return anchorPluginKey.getState(state)?.set;
      },
      /**
       * Opening the thread and placing the caret are not exclusive: SPEC.md §11
       * says clicking a highlight opens its thread and typing inside one just
       * edits, so this reports the click and declines to consume it.
       */
      handleClick(view, position) {
        const anchors = anchorPluginKey.getState(view.state)?.anchors ?? [];
        const hit = innermostAt(anchors, position);
        if (hit !== null) onActivate.current?.(hit.threadId);
        return false;
      },
    },
  });
}
