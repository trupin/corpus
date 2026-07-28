import { useEffect, useRef } from "react";

/**
 * Escape precedence, as a registry (SPEC.md §11: "`esc`/`⌫` close/back —
 * overlays and focus mode take precedence, then the column reader").
 *
 * The prototype hard-codes the chain (`overlay → compose → kbd → focus`), which
 * works for exactly as long as the set of layers is known in one file. It is
 * not: UI-009's search overlay, UI-010's composer and cheat-sheet, and UI-008's
 * thread surfaces all want to consume Escape, and each of them adding a branch
 * to a shared conditional is how the precedence quietly stops matching the
 * z-order.
 *
 * So each surface registers a handler while it is open, and the topmost active
 * layer consumes the key. "Topmost" is `priority` first — the layers' z-order,
 * declared as {@link EscapeLayerPriority} — and registration order second, which
 * is mount order and therefore the order overlays actually stacked.
 *
 * The listener is attached once, by the first registration, and removed with the
 * last: nothing has to be mounted at the app root for this to work, which is
 * what lets a component test exercise the precedence without a provider.
 */

/**
 * The z-order, named. A new layer picks the band it visually belongs to rather
 * than inventing a number, and ties inside a band fall to mount order.
 */
export const EscapeLayerPriority = {
  /** A column reader. Bottom of the chain — SPEC.md §11 says "then the column reader". */
  Reader: 0,
  /** Focus mode: full-viewport, `z-index: 35`. */
  Focus: 10,
  /** The search overlay and other modal surfaces above focus mode (`z-index: 40`). */
  Overlay: 20,
  /** Popovers and menus: whatever is open inside the surface below them. */
  Popover: 30,
} as const;

export type EscapeLayerPriorityValue =
  (typeof EscapeLayerPriority)[keyof typeof EscapeLayerPriority];

interface Layer {
  readonly seq: number;
  readonly priority: number;
  readonly handler: (event: KeyboardEvent) => void;
}

/** SPEC.md §11's keyboard scheme: "`esc`/`⌫` close/back". */
const CLOSE_KEYS = new Set(["Escape", "Backspace"]);

/**
 * Whether the key belongs to whatever the user is typing in.
 *
 * The listener is on the capture phase, so without this the chain would consume
 * Escape *before* a field's own "revert my draft" handler ever saw it — and
 * `⌫` would close the reader instead of deleting a character. Same guard, same
 * selector, as `Board.tsx`'s keyboard drag.
 */
function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // The attribute as well as the property: `isContentEditable` is computed from
  // layout, which jsdom does not have, and UI-006's editor is a whole
  // contenteditable subtree that this must already be keeping clear of.
  return (
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !==
    null
  );
}

const layers = new Set<Layer>();
let nextSeq = 0;
let detach: (() => void) | null = null;

/** The layer Escape belongs to right now: highest priority, then latest mounted. */
export function topLayer(candidates: Iterable<Layer>): Layer | null {
  let best: Layer | null = null;
  for (const layer of candidates) {
    if (best === null || layer.priority > best.priority) {
      best = layer;
      continue;
    }
    if (layer.priority === best.priority && layer.seq > best.seq) best = layer;
  }
  return best;
}

function onKeyDown(event: KeyboardEvent): void {
  if (!CLOSE_KEYS.has(event.key) || isEditing(event.target)) return;
  const layer = topLayer(layers);
  if (layer === null) return;
  event.preventDefault();
  // Stops a sibling handler on the same target from also acting on this press —
  // one press closes one layer, which is the whole contract.
  event.stopPropagation();
  layer.handler(event);
}

function ensureListener(): void {
  if (detach !== null || layers.size === 0) return;
  // Capture phase: the chain must win over a component's own inline `onKeyDown`,
  // which would otherwise consume Escape before precedence was consulted.
  document.addEventListener("keydown", onKeyDown, true);
  detach = () => {
    document.removeEventListener("keydown", onKeyDown, true);
  };
}

function releaseListener(): void {
  if (detach === null || layers.size > 0) return;
  detach();
  detach = null;
}

export interface EscapeLayerOptions {
  /** Registered only while true — a closed surface must not consume the key. */
  readonly active: boolean;
  readonly priority: number;
  /**
   * What the press does to this layer. Called at most once per press, with the
   * event, so a layer can distinguish the modified form — `⇧esc` empties a
   * reader's whole navigation stack, exactly as shift-clicking Back does.
   */
  readonly onEscape: (event: KeyboardEvent) => void;
}

export function useEscapeLayer({ active, priority, onEscape }: EscapeLayerOptions): void {
  // The handler is read through a ref so a layer that re-renders (every reader
  // does, on every scroll) does not re-register and jump to the top of the
  // chain: registration order is z-order, and it must be mount order.
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const layer: Layer = {
      seq: nextSeq++,
      priority,
      handler: (event) => {
        handler.current(event);
      },
    };
    layers.add(layer);
    ensureListener();
    return () => {
      layers.delete(layer);
      releaseListener();
    };
  }, [active, priority]);
}

/** Test seam: the registry is module state, and a suite must be able to reset it. */
export function resetEscapeLayers(): void {
  layers.clear();
  releaseListener();
}

/** Test seam: how many layers are registered right now. */
export function escapeLayerCount(): number {
  return layers.size;
}
