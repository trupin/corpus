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

/**
 * At the pointer, and never off screen.
 *
 * A menu opened near the right or bottom edge slides back rather than flipping:
 * the same choice `reader/popover.ts` makes, for the same reason — a flipped
 * menu appears somewhere the user did not click.
 */
export function clampToViewport(
  clientX: number,
  clientY: number,
  viewport: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number } = MENU_SIZE,
): MenuPlacement {
  return {
    left: Math.max(4, Math.min(clientX, viewport.width - size.width - 4)),
    top: Math.max(4, Math.min(clientY, viewport.height - size.height - 4)),
  };
}
