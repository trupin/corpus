/**
 * One action, declared once and presented twice (SPEC.md §10's right-click
 * bullet: "listing exactly that item's existing actions — the same set its ⋯ /
 * header menu offers, nothing invented").
 *
 * The point of the declaration is that the ⋯ menu and the context menu cannot
 * drift: they render the same array, so an action that becomes unavailable —
 * a thread resolved, a job that stopped being retryable — becomes unavailable
 * in both at once. Two hand-maintained lists that agree on the day they were
 * written is the defect this shape exists to prevent (sprint-016 TEST-440).
 */

export interface MenuAction {
  /** Stable across renders; also the `data-act` attribute and the React key. */
  readonly id: string;
  readonly label: string;
  /** The second line: what the act does, in the app's own voice. */
  readonly meta: string;
  readonly danger?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /**
   * The explicit confirmation §9 requires of deletion: the first activation
   * only re-labels the item, and the second is the one that reaches the wire.
   */
  readonly confirm?: { readonly label: string; readonly meta: string } | undefined;
  /**
   * The action closes the menu itself.
   *
   * Deletion does: its request can be refused, and a menu that had already
   * closed would leave the refusal with nothing to re-arm.
   */
  readonly keepOpen?: boolean | undefined;
  /**
   * Performs the act. `disarm` puts a confirmed item back to its unarmed copy —
   * what a refused deletion needs, and the reason this is a parameter rather
   * than state the action cannot reach.
   */
  readonly run: (disarm: () => void) => void;
}

export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
}

/** Roughly what a menu occupies; only used to keep it inside the viewport. */
export const MENU_SIZE = { width: 260, height: 200 } as const;

/** The gap a menu keeps from every edge of the window. */
export const MENU_MARGIN = 4;

/**
 * At the pointer, and never off screen.
 *
 * A menu opened near the right or bottom edge slides back rather than flipping:
 * the same choice `reader/popover.ts` makes, for the same reason — a flipped
 * menu appears somewhere the user did not click.
 *
 * This is the **first paint** only, and {@link MENU_SIZE} is a guess about a
 * menu nobody has measured yet. {@link menuRoom} re-derives the vertical half
 * from the menu's real height before the browser paints it.
 */
export function clampToViewport(
  clientX: number,
  clientY: number,
  viewport: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number } = MENU_SIZE,
): MenuPlacement {
  return {
    left: Math.max(MENU_MARGIN, Math.min(clientX, viewport.width - size.width - MENU_MARGIN)),
    top: Math.max(MENU_MARGIN, Math.min(clientY, viewport.height - size.height - MENU_MARGIN)),
  };
}

/** Where a menu sits, and the ceiling the room it landed in gives it. */
export interface MenuRoom {
  readonly top: number;
  readonly maxHeight: number;
}

/**
 * **The room, not a number** — SPEC.md §10 (SHARED-061): *"a bound is derived
 * from the room, not chosen as a number"*, and *"scrolling is for content that
 * cannot fit, never for content that was not given room"*.
 *
 * `menu.css` used to answer this with `max-height: min(60vh, 420px)`, and
 * UI-145 measured that the declaration never applied at all: `.ac-menu`'s
 * `max-height: 200px` ties with `.ctx-menu` on specificity and the kit's sheet
 * is injected last, so a five-item row menu scrolled at 198px of a 720px window
 * with 520px going spare. A constant could not have been right anyway — the
 * room a menu has depends on where the pointer was.
 *
 * So the ceiling is a subtraction and never a literal: whatever lies between
 * the menu's top edge and the foot of the window. A menu too tall for the room
 * below the pointer first **slides up** to claim more of it, exactly as far as
 * it needs and no further, and only then accepts a scrollbar — which is the one
 * honest use of one, for content that genuinely cannot fit the window.
 *
 * **Where SHARED-057 stands in this**, since the two halves have to hold at
 * once. The content is read to decide *how far up the menu slides*, and the
 * ceiling is then a function of the window and that one number. It is not
 * SHARED-057's case: that rule governs a surface with a place of its own — a
 * column, a card, a row — which must not grow or shrink under the reader as
 * what it holds changes. A menu is drawn at the size of its own items by
 * definition, has no place until a pointer gives it one, and lives only until
 * the next click. What the rule forbids is a menu that keeps re-sizing while it
 * stands open, and nothing here re-measures on a clock or a fetch.
 */
export function menuRoom(
  anchorTop: number,
  contentHeight: number,
  viewportHeight: number,
  margin: number = MENU_MARGIN,
): MenuRoom {
  const room = Math.max(0, viewportHeight - 2 * margin);
  const wanted = Math.min(contentHeight, room);
  const top = Math.max(margin, Math.min(anchorTop, viewportHeight - margin - wanted));
  return { top, maxHeight: Math.max(0, viewportHeight - margin - top) };
}
