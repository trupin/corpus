import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import type { MenuPlacement } from "./menuModel";
import { useRovingMenu } from "./useRovingMenu";
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
 * The keyboard half — item discovery, open-focus, the arrows, Tab-dismissal and
 * focus restore — now lives in {@link useRovingMenu}, because the reader's ⋯ and
 * 💬 popovers are the same kind of surface and had none of it (UI-030). This
 * component keeps what is genuinely its own: where it is painted, `esc` at
 * `Popover` priority, and the outside click.
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

export function ContextMenu({
  label,
  placement,
  autoFocus,
  onClose,
  children,
}: ContextMenuProps): ReactElement {
  const menu = useRef<HTMLDivElement>(null);
  const roving = useRovingMenu(menu, { autoFocus, onDismiss: onClose });

  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

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
      style={{ left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }}
      {...roving}
    >
      {children}
    </div>
  );
}
