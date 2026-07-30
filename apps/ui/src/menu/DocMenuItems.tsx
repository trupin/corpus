import type { Doc } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { useDocActions } from "./docActions";
import { MenuItems } from "./MenuItems";

/**
 * The open document's actions, in the context menu's presentation.
 *
 * The reader's ⋯ sheet renders the same declaration in its own
 * (`DocMenu`) — one source of actions, two presentations (sprint-016
 * TEST-440), which is what makes an action that becomes unavailable become
 * unavailable in both at once.
 */

export interface DocMenuItemsProps {
  readonly doc: Doc;
  readonly threadStatus: string | null;
  readonly close: () => void;
  readonly onGone: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function DocMenuItems({
  doc,
  threadStatus,
  close,
  onGone,
  onNotify,
}: DocMenuItemsProps): ReactElement {
  const actions = useDocActions(
    {
      id: doc.frontmatter.id,
      title: doc.frontmatter.title,
      type: doc.frontmatter.type,
      status: threadStatus ?? doc.frontmatter.status,
    },
    { surface: "reader", onNotify, close, onGone },
  );
  return <MenuItems actions={actions} onDone={close} />;
}
