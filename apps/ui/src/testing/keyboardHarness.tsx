import type { ReactElement, ReactNode } from "react";
import { BoardCommandsProvider, useBoardCommands } from "../keyboard/boardCommands";
import type { ShortcutContext } from "../keyboard/shortcuts";
import { useShortcuts } from "../keyboard/useShortcuts";

/**
 * The shell's keyboard, without the shell.
 *
 * A component test that fires a real key event needs the same thing the running
 * app has — the registry bound to one listener, over a board that has published
 * its commands — and nothing else the shell brings (a console, a search overlay,
 * a top bar). Wrapping the subject in this is how a keyboard assertion stays an
 * assertion about the registry rather than about `Shell`'s render tree.
 */

export interface KeyboardHarnessProps {
  readonly children?: ReactNode;
  /** Overrides for the shell-level acts; each defaults to a recorded no-op. */
  readonly overrides?: Partial<Omit<ShortcutContext, "board">>;
}

function Bind({ children, overrides }: KeyboardHarnessProps): ReactElement {
  const board = useBoardCommands();
  useShortcuts({
    openCompose: () => undefined,
    openSearch: () => undefined,
    toggleCheatSheet: () => undefined,
    ...overrides,
    board,
  });
  return <>{children}</>;
}

export function KeyboardHarness({ children, overrides }: KeyboardHarnessProps): ReactElement {
  return (
    <BoardCommandsProvider>
      <Bind {...(overrides === undefined ? {} : { overrides })}>{children}</Bind>
    </BoardCommandsProvider>
  );
}
