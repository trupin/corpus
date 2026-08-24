import type { MouseEvent, ReactElement } from "react";

/**
 * A conversation's `⋯` — the affordance UI-167 found missing.
 *
 * Every other object in the product exposes its actions to a left click: the
 * reader's head has a `⋯`, so does a column head, a path column and an
 * explorer row. A conversation had two visible buttons — resolve and the fold —
 * and its whole menu, the designation of a resident included, behind a
 * right-click and nothing else. The user who signed §7's designation rider went
 * looking for the control and reported it gone; it had never been there.
 *
 * ## One control, drawn in two places
 *
 * The card's head and the collapsed line both render this, so a folded
 * conversation is not a conversation with fewer actions (§10: *"collapsed is
 * never hidden"*). It is a component rather than two copies of a `<button>`
 * because the accessible name is derived — a glyph is not a name, and the two
 * sites must announce the same thing about the same conversation.
 *
 * ## What it does not decide
 *
 * **Not what it is called**: the name arrives from the panel, which is also what
 * names the menu (`panelMenuLabel.ts`), so the button and the surface it opens
 * cannot describe the same conversation differently.
 * **Not what is in the menu**: it calls the panel's one `openMenu`, which builds
 * the list once for both triggers (`menuModel.ts` is why there is only one).
 * **Not where the menu goes**: it hands over its own box and the host clamps and
 * measures (`clampToViewport`, then `menuRoom`) — a card sits inside a scrolling
 * reader and sometimes inside a 300px margin, and placement by preference is
 * what put a menu off screen in UI-159.
 */

export interface ThreadMenuTriggerProps {
  readonly threadId: string;
  /** `Actions for “lender spreads”` — the menu's own name (`panelMenuTitle`). */
  readonly label: string;
  readonly onOpen: (event: MouseEvent<HTMLElement>) => void;
}

export function ThreadMenuTrigger({
  threadId,
  label,
  onOpen,
}: ThreadMenuTriggerProps): ReactElement {
  return (
    <button
      type="button"
      className="t-menu"
      data-thread-menu={threadId}
      aria-label={label}
      aria-haspopup="menu"
      title={label}
      onClick={onOpen}
    >
      ⋯
    </button>
  );
}
