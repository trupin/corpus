import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

/**
 * Roving focus for a `role="menu"` surface — the keyboard half of SPEC.md §11's
 * menu conventions ("arrows move, `↵` activates, `esc` closes"), owned in one
 * place.
 *
 * It exists because there are three of these surfaces and only one of them had
 * the behaviour: the pointer-positioned `ContextMenu`, the reader's ⋯ `DocMenu`
 * and the 💬 `CommentsPopover` all paint a menu over the page, and in the two
 * popovers focus never entered at all — `↓` left `activeElement` on the trigger,
 * so `↵` re-toggled the trigger and no action ever ran from the keyboard
 * (UI-030). The fix is this extraction rather than two more copies of the same
 * fifty lines, which is what "share the mechanism, don't fork it" asks for.
 *
 * **`↵` is deliberately not handled here.** A focused `<button>` activates on
 * `↵` and on Space through its default action; re-implementing that would be a
 * second activation path that can disagree with the click one, and on the frame
 * that already worked it would fire twice. What activation needs instead is for
 * nothing else to claim the key first — which is UI-028's job, done in scope
 * resolution (`shell/overlays.ts`), not here.
 *
 * **What is not here either**: dismissal on `esc` (the caller's own
 * {@link useEscapeLayer} registration, so priority stays the caller's
 * declaration) and outside-click dismissal (only `ContextMenu` claims the whole
 * page). This hook is exactly item discovery, open-focus, arrow/Home/End
 * movement, Tab-dismissal and focus restore.
 */

export interface RovingMenuOptions {
  /**
   * Focus the first item on open. True when the keyboard opened the surface
   * (⇧F10, the menu key); false — the default — focuses the menu container
   * itself, so the arrows work without moving focus onto an item the user did
   * not ask for.
   */
  readonly autoFocus?: boolean | undefined;
  /** Tab, which dismisses rather than walking out of a surface over the page. */
  readonly onDismiss: () => void;
}

/**
 * Spread onto the `role="menu"` element. `tabIndex` is part of the contract and
 * not the caller's to remember: without it the container cannot hold focus, and
 * a pointer-opened menu would have no focus to rove from.
 */
export interface RovingMenuProps {
  readonly tabIndex: number;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** The enabled items, in document order — what the arrow keys walk. */
export function menuItems(menu: HTMLElement | null): HTMLElement[] {
  if (menu === null) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
}

export function useRovingMenu(
  menu: RefObject<HTMLElement | null>,
  { autoFocus, onDismiss }: RovingMenuOptions,
): RovingMenuProps {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /*
     * The menu takes focus even when a pointer opened it, because otherwise the
     * arrow keys land on the body and "arrows navigate" (SPEC.md §11) is a
     * promise the menu cannot keep. A key-opened menu goes one step further and
     * focuses the first item, which is what ⇧F10 means.
     */
    if (autoFocus === true) menuItems(menu.current)[0]?.focus();
    else menu.current?.focus();
    return () => {
      // Focus goes back where it came from — the row, the header button, the
      // job. A menu that dropped focus on the body would strand the keyboard.
      opener.current?.focus();
    };
  }, [autoFocus, menu]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      /*
       * Tab dismisses, which is what native menus do (PR #12 review, MINOR 16).
       * It is not optional politeness: this frame is painted over the page, so a
       * Tab that neither moved focus within it nor closed it left the menu on
       * screen with the keyboard walking the document behind it. The default is
       * prevented so focus lands back on the opener — the unmount effect's job —
       * rather than on whatever happens to follow the menu in the DOM; the next
       * Tab then continues from the control the user actually came from.
       */
      if (event.key === "Tab") {
        event.preventDefault();
        onDismiss();
        return;
      }
      const enabled = menuItems(menu.current);
      if (enabled.length === 0) return;
      const at = enabled.findIndex((item) => item === document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
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
    },
    [menu, onDismiss],
  );

  return { tabIndex: -1, onKeyDown };
}
