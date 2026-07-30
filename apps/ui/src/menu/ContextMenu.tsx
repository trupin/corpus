import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import type { MenuPlacement } from "./menuModel";
import "./menu.css";

/**
 * The one menu frame (sprint-016 TEST-442: "three dismissal implementations
 * after this issue is a fail").
 *
 * Everything about *behaving like a menu* lives here — `esc` through the
 * precedence registry rather than a private key listener, an outside click,
 * `↑`/`↓`/Home/End between items, `↵` to activate (a `<button>` does that on its
 * own), and focus returned to whatever opened it. What is *in* the menu is the
 * caller's declaration and never this component's.
 *
 * `esc` goes through {@link useEscapeLayer} at `Popover` priority deliberately:
 * a menu open over focus mode must eat the key before focus mode does, and a
 * private `keydown` listener would be racing the chain instead of joining it —
 * which is exactly what `ColumnMenu` did before this existed.
 */

export interface ContextMenuProps {
  readonly label: string;
  readonly placement: MenuPlacement;
  /**
   * Focus the first item on open. True when the keyboard opened it (⇧F10 or the
   * menu key); false for a pointer, where moving focus would be a surprise.
   */
  readonly autoFocus?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** The enabled items, in document order — what the arrow keys walk. */
function items(menu: HTMLElement | null): HTMLElement[] {
  if (menu === null) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
}

export function ContextMenu({
  label,
  placement,
  autoFocus,
  onClose,
  children,
}: ContextMenuProps): ReactElement {
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /*
     * The menu takes focus even when a pointer opened it, because otherwise the
     * arrow keys land on the body and "arrows navigate" (SPEC.md §11) is a
     * promise the menu cannot keep. A key-opened menu goes one step further and
     * focuses the first item, which is what ⇧F10 means.
     */
    if (autoFocus === true) items(menu.current)[0]?.focus();
    else menu.current?.focus();
    return () => {
      // Focus goes back where it came from — the row, the header button, the
      // job. A menu that dropped focus on the body would strand the keyboard.
      opener.current?.focus();
    };
  }, [autoFocus]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (menu.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    // Capture, so a click that also opens something else still closes this.
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menu}
      className="ac-menu open ctx-menu"
      role="menu"
      aria-label={label}
      data-ctx-menu
      tabIndex={-1}
      style={{ left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }}
      onKeyDown={(event) => {
        const enabled = items(menu.current);
        if (enabled.length === 0) return;
        const at = enabled.findIndex((item) => item === document.activeElement);
        const step =
          event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowUp"
              ? -1
              : event.key === "Tab"
                ? 0
                : 0;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = at < 0 ? (step === 1 ? 0 : enabled.length - 1) : at + step;
          enabled[Math.min(enabled.length - 1, Math.max(0, next))]?.focus();
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          enabled[0]?.focus();
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          enabled.at(-1)?.focus();
        }
      }}
    >
      {children}
    </div>
  );
}
