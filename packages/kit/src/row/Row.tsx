import type { DocRow } from "@corpus/contract";
import type { ComponentType, KeyboardEvent, MouseEvent, ReactElement } from "react";
import { AgeChip, LockChip, NeedsYouBadge, UnreadBadge, WorkingDot } from "./badges.js";
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
   * The parent document's title for a whole-document thread row.
   *
   * TODO(CONTRACT-011): remove once `DocRow.parentTitle` reaches the wire — the
   * row will read it off `row` and this prop becomes an override. Until then a
   * caller that already holds the title may pass it, and a caller that does not
   * gets a row with no context cell rather than a raw `doc_*` id.
   */
  readonly parentTitle?: string | null | undefined;
  /**
   * Unread turns, when something richer than a `DocRow` knows the count.
   *
   * Two gaps live behind this prop, both wire gaps rather than rendering
   * choices: `DocRow.unread` is a boolean and carries no count, and it is
   * **null on non-thread documents** — so a document row cannot today show the
   * aggregate unread SPEC.md §7 describes ("opening a parent document does not
   * mark its collapsed-chip threads seen"). Deriving it here would mean one
   * `?parent=<id>` query per row, which is the N+1 this component refuses.
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
  const { row, onOpen, onNotify, parentTitle, unreadCount, now, ListItem, showReasons } = props;

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
  const context = rowContext(row, parentTitle);
  const age = ageLabel(row, now ?? new Date());
  const chips = showReasons === false ? [] : reasonChips(row.attention, row.stale);
  const needsYou = needsYouText(row.attention);
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

  const className = ["row", stalenessClass(level), actions.isLeaving ? "leaving" : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      data-row-doc={row.id}
      data-row-type={row.type}
      data-row-level={String(level)}
      aria-label={`${row.type}: ${row.title}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className="row-top">
        <span className="type-glyph">{row.type}</span>
        <span className="row-title">{row.title}</span>
        <span className="row-badges">
          {row.unread === true ? <UnreadBadge count={unreadCount} /> : null}
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
