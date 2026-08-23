import { createCorpusTestHarness } from "@corpus/kit/testing";
import type { ReactElement, ReactNode } from "react";
import { BoardsProvider } from "../board/BoardsProvider";
import { ToastProvider } from "../shell/Toasts";

/**
 * The board's providers, without the shell (UI-148).
 *
 * Everything that reads a board — the board itself, the bar, a column's width,
 * "save as view" — now goes through `BoardsProvider`, which owns which board is
 * showing and every write to a board document. A test that renders one of those
 * surfaces needs the provider mounted for the same reason it needs the kit's
 * data layer: without it the component under test cannot answer the question it
 * exists to answer.
 *
 * `ToastProvider` comes with it because the provider reports every board write
 * through one, exactly as the shell arranges them.
 */

export interface BoardHarness {
  readonly Wrapper: (props: { readonly children?: ReactNode }) => ReactElement;
  readonly queryClient: ReturnType<typeof createCorpusTestHarness>["queryClient"];
}

export function createBoardHarness(fetch: typeof globalThis.fetch): BoardHarness {
  const corpus = createCorpusTestHarness({ fetch });
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <corpus.Wrapper>
        <ToastProvider>
          <BoardsProvider>{children}</BoardsProvider>
        </ToastProvider>
      </corpus.Wrapper>
    );
  }
  return { Wrapper, queryClient: corpus.queryClient };
}
