import { useEffect, type RefObject } from "react";

/**
 * How a plugin-rendered popover gets dismissed — the one convention `apps/ui`
 * cannot lend a plugin, written once so the surfaces in this directory cannot
 * drift apart.
 *
 * **Escape is listened for on `window`, in the capture phase.** Core popovers
 * join an escape *registry* (`useEscapeStack`) that resolves precedence between
 * the reader, focus mode and popovers; a plugin cannot register with it, and a
 * `document` listener would be too late — the registry's own capture listener
 * runs first and `stopPropagation()`s, so the reader behind this surface would
 * swallow the key and close instead. `window` captures before `document` does,
 * so the surface gets the press, stops it, and the layer underneath is left
 * alone: the outcome `EscapeLayerPriority.Popover` gives a core popover.
 *
 * **Both listeners are global, not scoped to the surface.** A popover whose
 * Escape handler hangs off its own field only answers while that field has
 * focus — press the agent toggle and Escape falls through to the app, which
 * closes the reader *underneath* while the popover stays open (PR #19 review).
 * Whatever has focus inside the surface, the surface answers.
 *
 * UI-045 item 3 is the real fix: a kit seam a plugin can register a layer with,
 * so two plugin surfaces have a defined order between them. This is the
 * workaround until then, and it is deliberately the *only* copy of it.
 *
 * **An outside click never throws away unsaved text** (UI-048 item 3). A menu
 * should close when you press elsewhere; a data-entry surface holding a draft
 * should not, and the signed composer contract made `↵` a newline, which
 * actively encourages drafts long enough to be worth losing. Core reached the
 * same place from the other direction — `apps/ui`'s `CommentPopover` has no
 * outside-click dismissal at all — and a plugin imitating a behaviour core has
 * abandoned is worse than either behaviour. So the surface may declare what it
 * would lose, through {@link DismissOptions.guard}, and an empty one still
 * closes on a click away, because closing it costs nothing. Escape is untouched
 * either way: it is the explicit "put this down", and it is what a caller who
 * wants out of a guarded surface presses.
 */

export interface DismissOptions {
  /**
   * True while the surface holds something an outside click would destroy.
   *
   * Read at the moment of the click rather than captured, so a draft typed after
   * the listener was attached still counts. Absent — a menu, a sheet — means
   * there is nothing to lose and an outside click closes as it always did.
   */
  readonly guard?: () => boolean;
}

export function useDismissable(
  surface: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: DismissOptions = {},
): void {
  const { guard } = options;
  useEffect(() => {
    const onKeyDownCapture = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Before `document`, so the escape registry behind this surface never
      // sees the press and the reader underneath stays open.
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: MouseEvent): void => {
      // `target` is whatever was pressed; the DOM types it as `EventTarget`,
      // and `contains` is the only question being asked of it.
      if (surface.current?.contains(event.target as Node) === true) return;
      // Asked now, not when the listener was attached: the draft this protects
      // is typed after that. Escape still closes — see the module docblock.
      if (guard?.() === true) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDownCapture, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [surface, onClose, guard]);
}
