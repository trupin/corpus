import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import {
  DEFAULT_EXPLORER_WIDTH,
  useExplorerLayout,
  type ExplorerLayout,
} from "./useExplorerLayout";

/**
 * One explorer layout, shared by the three surfaces that touch it.
 *
 * The panel draws itself from it, the board bar's toggle flips it, and `⌘B`
 * flips it from the shortcut registry at the shell — three components in three
 * places, over one `localStorage` blob. Two `useExplorerLayout()` calls would be
 * two `useState` copies of one blob, diverging on the first write, which is the
 * same failure `BoardsProvider` records for the board's own local state.
 *
 * **The default is inert rather than a throw.** A component test that renders
 * the board bar without a shell should render a board bar, with a toggle that
 * reports "closed" and does nothing — not fail on a panel nobody mounted. That
 * is `ContextMenuProvider`'s rule, for the same reason.
 */

const CLOSED: ExplorerLayout = {
  open: false,
  width: DEFAULT_EXPLORER_WIDTH,
  dragging: false,
  toggle: () => undefined,
  isExpanded: () => false,
  toggleFolder: () => undefined,
  onResizerPointerDown: () => undefined,
  onResizerKeyDown: () => undefined,
};

const ExplorerContext = createContext<ExplorerLayout>(CLOSED);

export function ExplorerProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const layout = useExplorerLayout();
  return <ExplorerContext.Provider value={layout}>{children}</ExplorerContext.Provider>;
}

export function useExplorer(): ExplorerLayout {
  return useContext(ExplorerContext);
}
