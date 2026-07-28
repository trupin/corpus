import type { DocRow } from "@corpus/contract";
import type { ComponentType, KeyboardEvent, MouseEvent, ReactElement } from "react";
import {
  AgeChip,
  LockChip,
  NeedsYouBadge,
  UnreadBadge,
  WorkingDot,
  unreadBadgeProps,
} from "./badges.js";
import { reasonChips } from "./reasons.js";
import { ageLabel, hasStaleActions, stalenessClass, stalenessLevel } from "./staleness.js";
import { isThreadRow, rowContext, rowExcerpt } from "./threadRow.js";
import { useRowActions, type RowNotice } from "./useRowActions.js";
import { useAgentActivity, useDocLock } from "./useRowSignals.js";

/**
 * The single list-item renderer every column uses (SPEC.md §11 — type-aware rows).
 *
 * **A row knows nothing about any column.** It takes a `DocRow` and callbacks;
 * it never reads a board, a view document or a query. That is what lets the same
 * component render in the board, in a search result list, and inside a plugin's
 * own surface — and it is why {@link RowProps} is exported: a plugin's
 * registered `ListItem` (PLUGINS-001) is a component with exactly this prop
 * shape, and it cannot be written without the type.
 *
 * Everything the row *derives* is derived from what the server already computed:
 * the staleness tier, the attention reasons, the unread and awaiting-agent
 * flags. The row re-derives none of them. Its own contributions are presentation
 * — the ladder class, the humanized age label, and the layout below.
 */

export interface RowProps {
  readonly row: DocRow;
  /** Opening the row. Never fired by a quick action, which stops propagation. */
  readonly onOpen?: ((row: DocRow) => void) | undefined;
  /**
   * Overrides the number the unread badge shows. **Optional, and normally
   * omitted** — the row already carries its own count.
   *
   * For a **document** row that count is `DocRow.unreadThreads`
   * (CONTRACT-012): the server-computed number of this document's unread
   * threads, carried on the row itself, so the aggregate SPEC.md §7 describes
   * ("opening a parent document does not mark its collapsed-chip threads seen")
   * needs neither a richer type here nor the per-row `?parent=<id>` query that
   * would be the N+1 this component refuses. Because it rides on the row, the
   * pill needs no wiring at any call site — every host that renders a `Row`
   * gets the aggregate, and no host can forget to pass it. This prop exists for
   * the surface that genuinely knows better (a thread row, whose `unread` is a
   * bare boolean on the wire, rendered next to a turn count it already has).
   */
  readonly unreadCount?: number | null | undefined;
  /** Narration for a host's toast surface. Errors also render inside the row. */
  readonly onNotify?: ((notice: RowNotice) => void) | undefined;
  /**
   * Whether to render the attention reason line. Defaults to **on**: `attention`
   * is populated on every response "rather than only under `needs=`, so any list
   * can render reason chips" (the contract's own note), and a column that would
   * rather stay quiet says so.
   */
  readonly showReasons?: boolean | undefined;
  /** Injectable clock, so a test can pin the age label and the `reviewed` instant. */
  readonly now?: Date | undefined;
  /**
   * The plugin seam (SPEC.md §10). When a host resolves a registered `ListItem`
   * for this document's type it passes it here and the row delegates wholesale.
   * The registry lookup itself is PLUGINS-001's, which keeps that issue purely
   * additive: the seam already exists and is already tested.
   */
  readonly ListItem?: ComponentType<RowProps> | undefined;
  /**
   * The keyboard row cursor is on this row (SPEC.md §11's `↑`/`↓`, `j`/`k`) —
   * the prototype's `.row.kbd` outline.
   *
   * A prop rather than a class the host adds from outside, because the host that
   * moves the cursor (a board column) does not own this element and reaching
   * into it would make the outline a second, silent source of truth about which
   * row is highlighted.
   */
  readonly cursor?: boolean | undefined;
}

/** What a plugin's registered list item must accept. */
export type ListItemComponent = ComponentType<RowProps>;

/** The prototype's `.needs-you` text, derived from the row's own reasons. */
function needsYouText(attention: readonly string[]): string | null {
  if (attention.includes("form")) return "form";
  if (attention.includes("due")) return "due";
  return null;
}

export function Row(props: RowProps): ReactElement {
  const { row, onOpen, onNotify, unreadCount, now, ListItem, showReasons, cursor } = props;

  const level = stalenessLevel(row.stale);
  const showActions = hasStaleActions(level);
  const actions = useRowActions(row, {
    ...(onNotify ? { onNotify } : {}),
    ...(now ? { now: () => now } : {}),
  });
  const lock = useDocLock(row.id);
  const activity = useAgentActivity(row);

  // Hooks run unconditionally; the delegation happens after them, so a plugin
  // item swapping in and out never changes this component's hook order.
  // `ListItem: undefined` on the delegate is what stops a plugin item that
  // re-renders `Row` as its own fallback from recursing forever.
  if (ListItem !== undefined) return <ListItem {...props} ListItem={undefined} />;

  const excerpt = rowExcerpt(row);
  const context = rowContext(row);
  const age = ageLabel(row, now ?? new Date());
  const chips = showReasons === false ? [] : reasonChips(row.attention, row.stale);
  const needsYou = needsYouText(row.attention);
  const unread = unreadBadgeProps(row, unreadCount);
  const anchorQuote = isThreadRow(row) ? row.anchorQuote : null;

  const open = (): void => {
    if (onOpen !== undefined) onOpen(row);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // The row is a control, so Space must activate it rather than scroll the column.
    event.preventDefault();
    open();
  };

  // A quick action must not also open the document. `stopPropagation` on the
  // wrapper covers pointer and keyboard activation alike, because both bubble
  // through it.
  const swallow = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
  };

  const className = [
    "row",
    stalenessClass(level),
    actions.isLeaving ? "leaving" : "",
    cursor === true ? "kbd" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      data-row-doc={row.id}
      data-row-type={row.type}
      data-row-status={row.status}
      data-row-level={String(level)}
      aria-label={`${row.type}: ${row.title}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className="row-top">
        <span className="type-glyph">{row.type}</span>
        <span className="row-title">{row.title}</span>
        <span className="row-badges">
          {unread !== null ? <UnreadBadge {...unread} /> : null}
          {needsYou !== null ? <NeedsYouBadge text={needsYou} /> : null}
          {activity.active ? <WorkingDot title={activity.title} /> : null}
          {lock !== null ? <LockChip holder={lock.holder} /> : null}
          {/* One age element per row. It sits in the badge cluster exactly when
              the quick actions have taken the meta line's place. */}
          {showActions ? <AgeChip label={age} /> : null}
        </span>
      </div>

      {anchorQuote !== null ? <blockquote className="row-quote">{anchorQuote}</blockquote> : null}
      {excerpt !== null ? <div className="row-excerpt">{excerpt}</div> : null}

      {chips.length > 0 ? (
        <div className="reason">
          {chips.map((chip) => (
            <span
              key={chip.code}
              className={`r-chip ${chip.chipClass}`.trimEnd()}
              data-reason={chip.code}
            >
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}

      {showActions ? (
        <div className="stale-actions" onClick={swallow} onKeyDown={swallow} role="presentation">
          <button
            type="button"
            data-act="archive"
            disabled={actions.isBusy}
            onClick={actions.archive}
          >
            Archive
          </button>
          <button
            type="button"
            className="keep"
            data-act="keep"
            disabled={actions.isBusy}
            onClick={actions.stillCurrent}
          >
            Still current
          </button>
          <button
            type="button"
            className="keep"
            data-act="triage"
            disabled={actions.isBusy}
            onClick={actions.triage}
          >
            @agent triage
          </button>
        </div>
      ) : null}

      {actions.error !== null ? (
        <p className="row-error" role="alert">
          {actions.error.message}
        </p>
      ) : null}

      {showActions ? null : (
        <div className="row-meta">
          <span className="row-context">{context ?? ""}</span>
          <AgeChip label={age} />
        </div>
      )}
    </div>
  );
}
