import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * A dismissable floating surface (UI-191, guarantees per UI-193's filing).
 *
 * **An overlay without an exit cannot be expressed.** None of the following
 * is a prop, so no caller can switch one off:
 *
 * - a visible close affordance (the ✕, always rendered);
 * - Escape dismisses, with focus returned to whatever opened it;
 * - an outside press dismisses;
 * - Tab cycles inside — focus never lands behind the surface while it is up.
 *
 * Escape is consumed on this surface's own subtree and its propagation is
 * stopped, so a layer behind it never acts on the same press. The app's
 * escape chain cannot be imported from kit (dependency direction), so the
 * contract is the DOM, both ways: the panel renders `data-kit-menu`, the
 * marker the chain's capture listener yields to, and `role="dialog"` for
 * what it is. Positioning is the caller's (`style`), because where a popover
 * belongs is the one thing only its surface knows.
 */
export interface PopoverProps extends ComponentPropsWithoutRef<"div"> {
  /** The accessible name. Required — there is no unlabelled surface. */
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * The control that anchors and toggles this popover, where one exists — a
   * `Select`'s trigger is the in-built precedent. A press inside it is the
   * toggle's own business, so the outside-press dismissal ignores it: without
   * this the dismissal and the toggle race on the same `mousedown`/`click`
   * pair, and whether a press on the trigger closes or re-opens depends on
   * when the state flush lands between the two events (UI-192, found against
   * the real browser). No exit is lost — every press genuinely outside still
   * dismisses, and the ✕ and Escape are untouched.
   */
  readonly anchor?: RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Tab wraps inside `surface`; the return value says the key was handled. */
export function trapTab(surface: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const focusables = [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return true;
  }
  const active = document.activeElement;
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && (active === first || !surface.contains(active))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  return false;
}

export function Popover({
  label,
  onClose,
  children,
  className,
  style,
  anchor,
  ...rest
}: PopoverProps): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  /** Whatever had focus when this mounted — where Escape and ✕ return it. */
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    // Recorded once: a StrictMode replay re-runs this effect after a consumer
    // may have moved focus *into* the surface (ComposerAddress does, UI-192),
    // and re-reading activeElement then would make "the opener" an inner row.
    opener.current ??= document.activeElement;
    const surface = panel.current;
    return () => {
      // A real close has already detached the surface by the time passive
      // cleanups run; a StrictMode replay runs this with it still in the
      // document, and returning focus there would yank it back out of the
      // surface the instant it opened (found by the overlay battery under the
      // dev build, UI-192).
      if (surface?.isConnected === true) return;
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    const surface = panel.current;
    if (surface === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // Consumed here, invisibly to every layer behind: one press, one
        // surface. Focus return rides the unmount effect above.
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

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (panel.current?.contains(event.target as Node) === true) return;
      // The anchor's presses are the toggle's, never a dismissal — see
      // `PopoverProps.anchor`.
      if (anchor?.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    // Capture, so a press that also opens something else still closes this.
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose, anchor]);

  return (
    <div
      // The caller's own attributes (a `data-*` hook, an aria detail) spread
      // first, so nothing can overwrite the guaranteed contract below — the
      // markers and the role are exactly what UI-193 forbids switching off.
      {...rest}
      ref={panel}
      className={className === undefined ? "kit-popover" : `kit-popover ${className}`}
      role="dialog"
      aria-label={label}
      data-kit-popover=""
      data-kit-menu=""
      style={style}
    >
      <button
        type="button"
        className="kit-popover-close"
        aria-label={`Close ${label}`}
        title={`Close ${label}`}
        onClick={onClose}
      >
        ✕
      </button>
      {children}
    </div>
  );
}
