import type { Doc } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { useCallback, type MouseEvent } from "react";
import { DocMenuItems } from "./DocMenuItems";
import { useContextMenu } from "./ContextMenuHost";
import { keepsNativeMenu } from "./nativeMenu";

/**
 * The open reader's right-click (SPEC.md §10): the same set its ⋯ menu offers.
 *
 * One hook, both hosts — the column reader and focus mode render one `DocView`
 * and must not differ here either.
 *
 * **What it declines is as much of the contract as what it opens.** Inside the
 * editor with nothing selected, and inside the title field, the browser's own
 * menu is the useful one and survives untouched: spellcheck is the concrete
 * case, and losing it is a regression a user notices immediately.
 *
 * A **selection** in the document body is handled before this ever runs, by
 * `useSelectionContextMenu` on the document view, which stops the event when it
 * opens its own menu (SPEC.md §10). What reaches here is therefore the reader's
 * chrome — and a selection elsewhere on the page never suppresses it.
 */

export interface ReaderContextMenuOptions {
  readonly doc: Doc | undefined;
  readonly threadStatus: string | null;
  /** The document left: the host pops it off its navigation stack. */
  readonly onGone: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function useReaderContextMenu({
  doc,
  threadStatus,
  onGone,
  onNotify,
}: ReaderContextMenuOptions): (event: MouseEvent<HTMLElement>) => void {
  const menu = useContextMenu();

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (doc === undefined) return;
      if (keepsNativeMenu({ target: event.target })) return;
      event.preventDefault();
      menu.open({
        label: `Actions for ${doc.frontmatter.title}`,
        clientX: event.clientX,
        clientY: event.clientY,
        items: (close) => (
          <DocMenuItems
            doc={doc}
            threadStatus={threadStatus}
            close={close}
            onGone={onGone}
            onNotify={onNotify}
          />
        ),
      });
    },
    [doc, menu, onGone, onNotify, threadStatus],
  );
}
