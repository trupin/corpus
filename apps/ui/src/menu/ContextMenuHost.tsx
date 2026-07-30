import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ContextMenu } from "./ContextMenu";
import { clampToViewport, type MenuPlacement } from "./menuModel";

/**
 * One open context menu, app-wide.
 *
 * A menu per surface would mean four pieces of state, four dismissal stories,
 * and no answer at all for the keyboard: ⇧F10 is dispatched by the shortcut
 * registry at the shell, and the row it acts on lives three components down.
 * One host means the board can open a row's menu without the column knowing,
 * and means two menus can never be open at once.
 *
 * **The items arrive as an element, not as data.** Every action list here is
 * built from hooks (`useRowActions`, `useSetThreadStatus`, `useRetryJob`…), and
 * hooks cannot be called at the moment a pointer event fires — so the caller
 * hands over a function returning the *component element* that will call them,
 * and this host renders it inside the frame.
 */

export interface ContextMenuRequest {
  /** The menu's accessible name — "Actions for «Mortgage options»". */
  readonly label: string;
  readonly clientX: number;
  readonly clientY: number;
  /** True when a key opened it: the first item takes focus. */
  readonly autoFocus?: boolean;
  readonly items: (close: () => void) => ReactNode;
}

interface OpenMenu extends ContextMenuRequest {
  readonly seq: number;
  readonly placement: MenuPlacement;
}

export interface ContextMenuApi {
  readonly open: (request: ContextMenuRequest) => void;
  readonly close: () => void;
  readonly isOpen: boolean;
}

const NOT_HOSTED: ContextMenuApi = {
  open: () => undefined,
  close: () => undefined,
  isOpen: false,
};

const Context = createContext<ContextMenuApi>(NOT_HOSTED);

/**
 * The API, from anywhere under the host.
 *
 * Defaults to a no-op rather than throwing: a component test that renders a row
 * without the shell should render a row, not fail on a menu nobody opened.
 */
export function useContextMenu(): ContextMenuApi {
  return useContext(Context);
}

export function ContextMenuProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const close = useCallback(() => {
    setMenu(null);
  }, []);

  const open = useCallback((request: ContextMenuRequest) => {
    setMenu((current) => ({
      ...request,
      seq: (current?.seq ?? 0) + 1,
      placement: clampToViewport(request.clientX, request.clientY, {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
      }),
    }));
  }, []);

  const api = useMemo<ContextMenuApi>(
    () => ({ open, close, isOpen: menu !== null }),
    [close, menu, open],
  );

  return (
    <Context.Provider value={api}>
      {children}
      {menu === null ? null : (
        <ContextMenu
          // Keyed by the opening: a second right-click on another item is a new
          // menu, with its arming and its focus reset rather than inherited.
          key={menu.seq}
          label={menu.label}
          placement={menu.placement}
          autoFocus={menu.autoFocus === true}
          onClose={close}
        >
          {menu.items(close)}
        </ContextMenu>
      )}
    </Context.Provider>
  );
}
