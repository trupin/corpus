import type { Doc } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { useRef, type ReactElement } from "react";
import { useDocActions } from "../menu/docActions";
import { MenuItems } from "../menu/MenuItems";
import { usePopoverShift } from "./popover";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";

/**
 * The reader's ⋯ menu (SPEC.md §11): Still current, Resolve/Reopen for threads,
 * Archive, and Delete.
 *
 * **It declares nothing.** The items come from `useDocActions`, which the
 * reader's *context* menu reads too — one source of actions, two presentations
 * (sprint-016 TEST-440). What is left here is the presentation: an anchored
 * sheet that slides to stay inside the viewport, at `Popover` escape priority.
 *
 * **The publish-plugin items are deliberately absent.** The prototype's menu
 * carries "Copy for Google Docs" and "Push update to Google Doc…", but SPEC.md
 * §13 says the publish *plugin* adds them and §10 says the core must not know a
 * plugin's name. They arrive through the manifest with the plugin, not as inert
 * placeholders here.
 */

export {
  DELETE_ARMED_LABEL,
  DELETE_ARMED_META,
  DELETE_LABEL,
  DELETE_META,
} from "../menu/docActions";

export interface DocMenuProps {
  readonly doc: Doc;
  /** Thread status, for the Resolve/Reopen label; `null` on non-threads. */
  readonly threadStatus: string | null;
  readonly onClose: () => void;
  /** The document left: the host pops it off the navigation stack. */
  readonly onGone: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function DocMenu({
  doc,
  threadStatus,
  onClose,
  onGone,
  onNotify,
}: DocMenuProps): ReactElement {
  const pop = useRef<HTMLDivElement>(null);
  const shift = usePopoverShift(pop, true);
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  const actions = useDocActions(
    {
      id: doc.frontmatter.id,
      title: doc.frontmatter.title,
      type: doc.frontmatter.type,
      status: threadStatus ?? doc.frontmatter.status,
    },
    { surface: "reader", onNotify, close: onClose, onGone },
  );

  return (
    <div
      ref={pop}
      className="comments-pop open"
      role="menu"
      aria-label="Document actions"
      data-dm-pop
      style={shift === 0 ? undefined : { transform: `translateX(${String(-shift)}px)` }}
    >
      <MenuItems actions={actions} variant="popover" onDone={onClose} />
    </div>
  );
}
