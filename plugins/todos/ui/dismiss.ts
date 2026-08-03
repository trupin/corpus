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
 */
export function useDismissable(surface: RefObject<HTMLElement | null>, onClose: () => void): void {
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
      onClose();
    };
    window.addEventListener("keydown", onKeyDownCapture, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [surface, onClose]);
}
