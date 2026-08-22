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
 *
 * ## The provisional highlight
 *
 * One more range, held apart from the anchors: the words a comment is being
 * written **about**, lit from the moment the composer opens until it is
 * abandoned or the server's own anchor arrives to take their place (UI-112). It
 * is painted with `.anchor-hl`, the same paint and literally the same rule,
 * because it is about to become one — the only difference in the DOM is a
 * `data-provisional` flag and the absence of a pip, since there is no
 * conversation to count turns of yet.
 *
 * It is a separate slot rather than a placement in {@link AnchorPluginState}'s
 * list for two reasons, and both are about who owns the offsets. The anchors are
 * the *server's*, and its host declines to apply them whenever the editor is
 * showing anything but the body they index — so a highlight smuggled in with
 * them would go dark for the whole of an editing session, which is exactly when
 * someone is commenting. And the mapping rule is the opposite one:
 *
 * **A provisional range reconciles with edits around it and yields to edits
 * through it.** It maps like an anchor, so typing above the quote — the common
 * case while a composer is open — moves the mark with its words instead of
 * drifting it onto other ones. But where an anchor collapsed to nothing is
 * retained and hidden, this is dropped: retention exists because a *conversation*
 * hangs off that anchor and only the server may declare it orphaned, and a
 * provisional range has neither. It is a promise about words that are about to
 * be quoted, and once those words have been typed over the promise is false. A
 * zero-width mark asserting that the selection survives its own deletion would
 * be the worse failure — the highlight going out is the surface's only honest
 * signal that the quote being composed no longer matches the document.
 *
 * ## The handover (UI-121)
 *
 * A provisional mark that the server has accepted is not replaced by the
 * anchor it becomes — it **acquires an owner**. `claimProvisionalTransaction`
 * writes the thread id the server assigned onto the mark that is already up,
 * and from then on {@link handOver} ends the mark in the very transaction that
 * first draws that thread's anchor.
 *
 * Both halves of that follow from the same premise, and neither works alone.
 * Ending it any *earlier* — which is what dropping it in the mutation's
 * `onSuccess` did — leaves the words dark for a whole round trip, because the
 * server's ranges arrive only with the invalidated document read: measured at
 * 244 ms against a real server one 250 ms round trip away. Ending it any
 * *later* would paint the same words twice. The two events being one
 * transaction is what makes "one mark throughout" true by construction rather
 * than by two clocks agreeing.
 *
 * The owner is matched by **thread id, not by range**. The server's anchor is
 * frequently not the same shape as the selection it came from — a quote
 * crossing `**` splits into two segments where the selection was one — so
 * comparing ranges would fail exactly where the split makes the mark most
 * visible.
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

/**
 * The words a comment is being written about — and, once the server has
 * accepted it, the conversation that now owns them.
 */
export interface ProvisionalMark {
  readonly range: PmRange;
  /**
   * The thread the server assigned, or `null` while nothing has been sent.
   *
   * An owned mark is one waiting to be handed over: the comment exists, its
   * anchor is on its way with the next document read, and until it is drawn
   * this mark is the only thing saying so.
   */
  readonly owner: string | null;
}

export interface AnchorPluginState {
  readonly anchors: readonly AnchorPlacement[];
  /** The words an open composer is about, before the server has seen them. */
  readonly provisional: ProvisionalMark | null;
  readonly set: DecorationSet;
}

export const anchorPluginKey = new PluginKey<AnchorPluginState>("corpusAnchors");

/** What a host dispatches: the server's answer, the composer's own range, or its new owner. */
type AnchorMeta =
  | { readonly kind: "anchors"; readonly anchors: readonly AnchorPlacement[] }
  | { readonly kind: "provisional"; readonly range: PmRange | null }
  | { readonly kind: "claim"; readonly owner: string };

export function anchorState(state: EditorState): AnchorPluginState | undefined {
  return anchorPluginKey.getState(state);
}

/** Neither is undoable: ⌘Z must undo the sentence, not the highlight over it. */
function metaTransaction(state: EditorState, meta: AnchorMeta): Transaction {
  return state.tr.setMeta(anchorPluginKey, meta).setMeta("addToHistory", false);
}

/** The transaction that makes the server's answer the truth on screen. */
export function setAnchorsTransaction(
  state: EditorState,
  anchors: readonly AnchorPlacement[],
): Transaction {
  return metaTransaction(state, { kind: "anchors", anchors });
}

/**
 * The transaction that lights (or puts out) the open composer's selection.
 *
 * A range always arrives unowned: this is a *new* mark, and the previous one's
 * owner has nothing to do with it.
 */
export function setProvisionalTransaction(state: EditorState, range: PmRange | null): Transaction {
  return metaTransaction(state, { kind: "provisional", range });
}

/**
 * The transaction that names the thread the mark now belongs to (UI-121).
 *
 * Deliberately separate from {@link setProvisionalTransaction}: the mark's
 * range has been mapped through every keystroke since the composer opened, and
 * the host's copy of it is stale from the first one. A claim says who owns the
 * mark and touches nothing else.
 */
export function claimProvisionalTransaction(state: EditorState, owner: string): Transaction {
  return metaTransaction(state, { kind: "claim", owner });
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

/** The parts of a range that are still inside a document this size. */
function visibleSegments(segments: readonly PmRange[], size: number): PmRange[] {
  return segments
    .map((segment) => ({ from: Math.min(segment.from, size), to: Math.min(segment.to, size) }))
    .filter((segment) => segment.to > segment.from);
}

export interface DecorationHosts {
  /**
   * The element this thread's collapsed chip renders into, or `null` for none.
   *
   * SPEC.md §10 puts the chip **at the anchor** in a narrow column, and the
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
  provisional: ProvisionalMark | null = null,
): Decoration[] {
  const decorations: Decoration[] = [];
  if (provisional !== null) {
    const [only] = visibleSegments([provisional.range], doc.content.size);
    if (only !== undefined) {
      decorations.push(
        Decoration.inline(
          only.from,
          only.to,
          // `.anchor-hl` and nothing else: §10 asks for the same paint as an
          // anchor's, and a second class would be a second appearance waiting
          // to drift from the first. No pip — there is no conversation to count.
          { class: "anchor-hl", "data-provisional": "true" },
          { inclusiveStart: false, inclusiveEnd: false },
        ),
      );
    }
  }
  anchors.forEach((anchor, index) => {
    const segments = visibleSegments(anchor.segments, doc.content.size);
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

/**
 * Follows the composer's own range through one transaction — and drops it when
 * the edit went through the words rather than around them.
 *
 * The asymmetry with {@link mapAnchors} is deliberate; the module comment says
 * why. Note that a wholesale replacement of the document (an external change
 * adopted while the composer is open) collapses it too, and that is the right
 * outcome: after a replacement these offsets describe a document that is no
 * longer on screen, and there is no server anchor to repair them from.
 */
export function mapProvisional(
  mark: ProvisionalMark | null,
  transaction: Transaction,
): ProvisionalMark | null {
  if (mark === null) return null;
  const from = transaction.mapping.map(mark.range.from, 1);
  const to = transaction.mapping.map(mark.range.to, -1);
  return to > from ? { ...mark, range: { from, to } } : null;
}

/**
 * The handover: an owned mark ends the moment its thread's anchor can be drawn
 * (UI-121).
 *
 * Called on every transaction rather than only on an `anchors` meta, because
 * the anchor can also become drawable through the mapping — the same rule
 * either way, and the mark comes down in the transaction that puts the anchor
 * up, never one after it.
 *
 * A segment that has collapsed to nothing does not count: a retained-and-hidden
 * anchor (the rule above) paints no highlight, so handing over to it is handing
 * over to nothing, and this mark is still the only thing on those words.
 */
export function handOver(
  mark: ProvisionalMark | null,
  anchors: readonly AnchorPlacement[],
): ProvisionalMark | null {
  if (mark === null || mark.owner === null) return mark;
  const owner = mark.owner;
  const drawn = anchors.some(
    (anchor) =>
      anchor.threadId === owner && anchor.segments.some((segment) => segment.to > segment.from),
  );
  return drawn ? null : mark;
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

/** What a meta says about the mark, before this transaction's mapping. */
function provisionalAfter(
  current: ProvisionalMark | null,
  meta: AnchorMeta | undefined,
): ProvisionalMark | null {
  if (meta?.kind === "provisional") {
    return meta.range === null ? null : { range: meta.range, owner: null };
  }
  // A claim with no mark to land on is a comment whose highlight has already
  // gone — typed over, or lost to a wholesale replacement. Nothing to own.
  if (meta?.kind === "claim" && current !== null) return { ...current, owner: meta.owner };
  return current;
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
      init: () => ({ anchors: [], provisional: null, set: DecorationSet.empty }),
      apply(transaction, value) {
        const meta = transaction.getMeta(anchorPluginKey) as AnchorMeta | undefined;
        if (meta === undefined && !transaction.docChanged) return value;
        let anchors = meta?.kind === "anchors" ? meta.anchors : value.anchors;
        let provisional = provisionalAfter(value.provisional, meta);
        if (transaction.docChanged) {
          anchors = mapAnchors(anchors, transaction);
          provisional = mapProvisional(provisional, transaction);
        }
        // Last, and after the mapping: the anchors this transaction leaves
        // behind are the ones a mark can hand over to.
        provisional = handOver(provisional, anchors);
        return {
          anchors,
          provisional,
          set: DecorationSet.create(
            transaction.doc,
            buildDecorations(transaction.doc, anchors, hosts, provisional),
          ),
        };
      },
    },
    props: {
      decorations(state) {
        return anchorPluginKey.getState(state)?.set;
      },
      /**
       * Opening the thread and placing the caret are not exclusive: SPEC.md §10
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
