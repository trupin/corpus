import type { Doc } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { useRef, type ReactElement } from "react";
import { useDocActions } from "../menu/docActions";
import { MenuItems } from "../menu/MenuItems";
import { useRovingMenu } from "../menu/useRovingMenu";
import { usePopoverShift } from "./popover";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";

/**
 * The reader's ⋯ menu (SPEC.md §10): Comments, Still current, Resolve/Reopen for
 * threads, Archive, and Delete.
 *
 * **It declares nothing.** The items come from `useDocActions`, which the
 * reader's *context* menu reads too — one source of actions, two presentations
 * (sprint-016 TEST-440). What is left here is the presentation: an anchored
 * sheet that slides to stay inside the viewport, at `Popover` escape priority.
 *
 * Its keyboard behaviour is `ContextMenu`'s, through the same
 * {@link useRovingMenu} (UI-030): the sheet takes focus when it opens, the
 * arrows walk the items, `↵`/Space activate the focused one natively, Tab and
 * `esc` dismiss, and focus returns to the ⋯ button. Before that it had
 * `role="menuitem"` buttons focus never reached.
 *
 * **The prototype's publish items are deliberately absent.** Its menu carries
 * "Copy for Google Docs" and "Push update to Google Doc…". Nothing in Corpus
 * publishes anywhere: a workspace is local files behind a localhost server, so
 * there is no target to push to and no address to copy. They are not stubbed
 * here, because an inert menu item is a promise the product does not keep.
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
  /**
   * Show the document's comments list (SPEC.md §10's rider, UI-063).
   *
   * Here as well as on the head's own toggle, because the toggle appears only
   * once a document has conversations — see `comments/CommentsSwitch`, which
   * measures why the head cannot carry it unconditionally. This item is what
   * makes "comment without selecting" reachable on a document with none.
   */
  readonly onComments?: (() => void) | undefined;
  /** The document left: the host pops it off the navigation stack. */
  readonly onGone: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function DocMenu({
  doc,
  threadStatus,
  onClose,
  onComments,
  onGone,
  onNotify,
}: DocMenuProps): ReactElement {
  const pop = useRef<HTMLDivElement>(null);
  const shift = usePopoverShift(pop, true);
  const roving = useRovingMenu(pop, { onDismiss: onClose });
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Popover, onEscape: onClose });

  const actions = useDocActions(
    {
      id: doc.frontmatter.id,
      title: doc.frontmatter.title,
      type: doc.frontmatter.type,
      status: threadStatus ?? doc.frontmatter.status,
    },
    {
      surface: "reader",
      onNotify,
      close: onClose,
      onGone,
      ...(onComments === undefined ? {} : { onComments }),
    },
  );

  return (
    <div
      ref={pop}
      className="comments-pop open"
      role="menu"
      aria-label="Document actions"
      data-dm-pop
      style={shift === 0 ? undefined : { transform: `translateX(${String(-shift)}px)` }}
      {...roving}
    >
      <MenuItems actions={actions} variant="popover" onDone={onClose} />
    </div>
  );
}
