import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";
import "@corpus/kit/autocomplete.css";
import "./todos.css";

/**
 * A context menu for a **plugin-rendered** surface (SPEC.md §11, as amended
 * 2026-08-02).
 *
 * The amendment lets a plugin's own rows contribute a menu "through the plugin
 * kit, under the same rules as every other menu". The kit does not publish one
 * yet — `@corpus/kit` exports rows, badges, staleness and the query hooks, and
 * nothing from `apps/ui/src/menu/`, which is lint-forbidden to reach into — so
 * this is the plugin's own frame, written to the conventions the app already
 * establishes rather than to new ones:
 *
 * - **`.ac-menu` / `.ac-item`**, from `@corpus/kit/autocomplete.css`: the one
 *   positioned-menu surface every menu in the product renders (the column ⋯,
 *   the new-list picker, the search overlay's pickers). Imported from the kit,
 *   so this menu inherits the app's look and its theme instead of approximating
 *   them.
 * - **`role="menu"` / `role="menuitem"`**: not decoration. `apps/ui`'s shortcut
 *   dispatcher decides what owns the keyboard by querying `[role="menu"]`
 *   (`shell/overlays.ts`), so declaring it truthfully is what takes the board's
 *   `↵`, `j`/`k` and arrows out of scope while this menu is up — the UI-028 fix,
 *   inherited rather than re-implemented.
 * - **`esc` dismisses, arrows navigate, `↵` activates**, focus returns to the
 *   opener, `Tab` dismisses — `apps/ui/src/menu/useRovingMenu.ts`'s contract,
 *   including its deliberate omission: `↵` is a focused `<button>`'s own default
 *   action and is never re-implemented here.
 *
 * **Escape is listened for on `window`, in the capture phase**, which is the one
 * place this frame cannot simply follow core. Core menus join an escape
 * *registry* (`useEscapeStack`) that resolves precedence between the reader,
 * focus mode and popovers; a plugin cannot register with it. A `document`
 * listener would be too late — the registry's own capture listener runs first
 * and `stopPropagation()`s, so a reader open behind this menu would swallow the
 * key and close instead. `window` captures before `document` does, so the menu
 * gets the press, stops it, and the layer underneath is left alone: the same
 * outcome `EscapeLayerPriority.Popover` produces for a core menu.
 */

export interface PluginMenuAction {
  /** Stable: the React key and the `data-act` attribute. */
  readonly id: string;
  readonly label: string;
  /** The second line — what the act does, in the app's own voice. */
  readonly meta: string;
  readonly disabled?: boolean | undefined;
  readonly run: () => void;
}

export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
}

/** Roughly what this menu occupies; only used to keep it inside the viewport. */
export const MENU_SIZE = { width: 260, height: 200 } as const;

/**
 * At the pointer, and never off screen — slides back from an edge rather than
 * flipping, exactly as `apps/ui/src/menu/menuModel.ts` does, so a menu opened
 * near the bottom of a column does not appear somewhere the user did not click.
 */
export function clampToViewport(
  clientX: number,
  clientY: number,
  viewport: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number } = MENU_SIZE,
): MenuPlacement {
  return {
    left: Math.max(4, Math.min(clientX, viewport.width - size.width - 4)),
    top: Math.max(4, Math.min(clientY, viewport.height - size.height - 4)),
  };
}

export interface PluginMenuProps {
  /** The menu's accessible name — "Actions for «Call the plumber»". */
  readonly label: string;
  readonly clientX: number;
  readonly clientY: number;
  /** True when a key opened it (⇧F10, the menu key): the first item takes focus. */
  readonly autoFocus?: boolean | undefined;
  readonly actions: readonly PluginMenuAction[];
  readonly onClose: () => void;
}

/** The enabled items, in document order — what the arrow keys walk. */
function enabledItems(menu: HTMLElement | null): HTMLElement[] {
  if (menu === null) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
}

export function PluginMenu({
  label,
  clientX,
  clientY,
  autoFocus,
  actions,
  onClose,
}: PluginMenuProps): ReactElement {
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The menu takes focus even from a pointer, or "arrows navigate" is a
    // promise it cannot keep; a key-opened menu goes one step further.
    if (autoFocus === true) enabledItems(menu.current)[0]?.focus();
    else menu.current?.focus();
    return () => {
      opener.current?.focus();
    };
  }, [autoFocus]);

  useEffect(() => {
    const onKeyDownCapture = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Before `document`, so the escape registry behind this menu never sees
      // the press and the reader underneath stays open.
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (menu.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDownCapture, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      // Tab dismisses rather than walking the document behind the frame.
      if (event.key === "Tab") {
        event.preventDefault();
        onClose();
        return;
      }
      const items = enabledItems(menu.current);
      if (items.length === 0) return;
      const at = items.findIndex((item) => item === document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = at < 0 ? (step === 1 ? 0 : items.length - 1) : at + step;
        items[Math.min(items.length - 1, Math.max(0, next))]?.focus();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        items.at(-1)?.focus();
      }
    },
    [onClose],
  );

  const placement = clampToViewport(clientX, clientY, {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  });

  return (
    <div
      ref={menu}
      className="ac-menu open todo-menu"
      role="menu"
      aria-label={label}
      data-todo-menu
      tabIndex={-1}
      style={{ left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }}
      onKeyDown={onKeyDown}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="ac-item"
          role="menuitem"
          data-act={action.id}
          disabled={action.disabled === true}
          onClick={() => {
            action.run();
            onClose();
          }}
        >
          {action.label}
          <span className="d">{action.meta}</span>
        </button>
      ))}
    </div>
  );
}
