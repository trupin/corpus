import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { menuRoom, type MenuPlacement, type MenuRoom } from "./menuModel";
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
  const [room, setRoom] = useState<MenuRoom | null>(null);

  /**
   * The measured room (SHARED-061), applied inline.
   *
   * Inline rather than through a class deliberately: a bound written as
   * `.ctx-menu { max-height: … }` ties on specificity with `@corpus/kit`'s
   * `.ac-menu { max-height: 200px }`, and the kit's sheet is injected last, so
   * the app's number silently lost — which is UI-145, the whole of it. An
   * inline declaration cannot lose a tie, and this one has to be computed
   * anyway, because the room depends on where the pointer was.
   *
   * A layout effect, so nothing is painted at the wrong size first, and with no
   * dependency list, so a menu whose items change while it is open (delete
   * arming its confirmation) is re-measured. The equality guard is what stops
   * that from looping.
   *
   * `scrollHeight` is the content's full height whether or not a ceiling is
   * already clipping it, so the measurement is stable across those re-runs;
   * `offsetHeight - clientHeight` adds back the borders `scrollHeight` leaves
   * out, since `box-sizing` is `border-box` app-wide and `max-height` therefore
   * bounds the border box.
   */
  useLayoutEffect(() => {
    const element = menu.current;
    if (element === null) return;
    const borders = element.offsetHeight - element.clientHeight;
    const next = menuRoom(placement.top, element.scrollHeight + borders, globalThis.innerHeight);
    setRoom((current) =>
      current !== null && current.top === next.top && current.maxHeight === next.maxHeight
        ? current
        : next,
    );
  });

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
      style={{
        left: `${String(placement.left)}px`,
        top: `${String(room?.top ?? placement.top)}px`,
        ...(room === null ? {} : { maxHeight: `${String(room.maxHeight)}px` }),
      }}
      {...roving}
    >
      {children}
    </div>
  );
}
