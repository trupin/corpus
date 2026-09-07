import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { trapTab } from "./Popover.js";

/**
 * The {@link Popover} guarantees at surface grain (UI-191/UI-193): a scrim
 * over everything, a panel that is the only thing the keyboard can reach,
 * and no way to express a modal without an exit.
 *
 * - the ✕ is always rendered;
 * - Escape dismisses with focus returned, consumed before any layer behind;
 * - a press on the scrim dismisses;
 * - Tab cycles inside the panel.
 *
 * The scrim renders the `.overlay.open` class pair — the DOM contract the
 * app's `overlays.ts` reads to decide that a modal owns the keyboard
 * (`isOverlayOpen`), satisfied by markup rather than by an import.
 */
export interface ModalProps {
  /** The accessible name. Required — there is no unlabelled surface. */
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Modal({ label, onClose, children, className }: ModalProps): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // Focus starts on the panel, so the first Tab and the first Escape are
    // already the modal's — never the surface behind it.
    panel.current?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    const surface = panel.current;
    if (surface === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      trapTab(surface, event);
    };
    surface.addEventListener("keydown", onKeyDown);
    return () => {
      surface.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="overlay open kit-modal-scrim"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={panel}
        className={className === undefined ? "kit-modal-panel" : `kit-modal-panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-kit-modal=""
        // The chain marker (see Popover): close keys aimed inside this panel
        // are this panel's, consumed by its own subtree listener.
        data-kit-menu=""
        tabIndex={-1}
      >
        <button
          type="button"
          className="kit-modal-close"
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
          onClick={onClose}
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
