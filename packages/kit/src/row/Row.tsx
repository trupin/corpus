import type { DocRow } from "@corpus/contract";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactElement } from "react";
import {
  AgentActivityDot,
  AgeChip,
  ChangedMark,
  NeedsYouBadge,
  UnreadBadge,
  unreadBadgeProps,
} from "./badges.js";
import { reasonChips } from "./reasons.js";
import { ageLabel, hasStaleActions, stalenessClass, stalenessLevel } from "./staleness.js";
import { isThreadRow, rowContext, rowExcerpt } from "./threadRow.js";
import { useRowActions, type RowNotice } from "./useRowActions.js";
import { useAgentActivity } from "./useRowSignals.js";

/**
 * The single list-item renderer every column uses (SPEC.md §10 — type-aware rows).
 *
 * **A row knows nothing about any column.** It takes a `DocRow` and callbacks;
 * it never reads a board, a view document or a query. That is what lets the same
 * component render in a board column, in a search result list, and in an
 * anchored-thread list — and it is why {@link RowProps} is exported: a host that
 * wraps a row, or builds its props before it has one, needs the type.
 *
 * **There is exactly one renderer, and no seam for a second.** No delegate prop
 * swaps the layout out per document type, which is what makes the row safe
 * against a `type:` it has never seen: the set of types on the wire is not the
 * set any one build knows — an older workspace's documents, a hand-written file,
 * or a server newer than this client can each name one (SPEC.md §5) — and a row
 * that had to be claimed before it could be drawn would render those as nothing.
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
   * The keyboard row cursor is on this row (SPEC.md §10's `↑`/`↓`, `j`/`k`) —
   * the prototype's `.row.kbd` outline.
   *
   * A prop rather than a class the host adds from outside, because the host that
   * moves the cursor (a board column) does not own this element and reaching
   * into it would make the outline a second, silent source of truth about which
   * row is highlighted.
   */
  readonly cursor?: boolean | undefined;
  /**
   * This document changed since the agent last reflected on the corpus
   * (SPEC.md §7's rider 9) — the diamond in the badge cluster.
   *
   * **A prop, and never derived here.** The rule is `isUnreflected` in
   * `@corpus/contract`, and it takes a second argument this row does not have
   * and must not go looking for: the corpus's reflection clock, which arrives on
   * `GET /api/workspace/reflect` and belongs to the surface that hosts the
   * column, not to a list item. A row that fetched the clock for itself would be
   * one request per row for a fact that is one request per board.
   *
   * Absent means **unmarked**, which is also what an unread clock produces: a
   * host that has not read the status yet passes nothing, and the row says
   * nothing, rather than claiming the agent has never been round.
   */
  readonly unreflected?: boolean | undefined;
  /**
   * This row is the **origin** of an open path (SPEC.md §10, rider 3): the
   * document it names is the root of the chain of reader columns to this
   * column's right. Accent wash, accent bar, and `▸` in the badge cluster.
   *
   * A prop derived by the host from its strip at render time, never stored on
   * the row — the same rule as {@link RowProps.cursor}, for the same reason.
   */
  readonly origin?: boolean | undefined;
  /**
   * The row may be picked up and dragged (SPEC.md §10, rider 6 — a kanban's
   * rows move between its stage columns).
   *
   * **A prop, like every other, because a row knows nothing about any column.**
   * What a drag *means* is the host's entirely: which field it writes, which
   * columns will take it, and whether the graph allows the drop. This row only
   * says "this element is draggable" and reports the two events, so the same
   * component still renders in a search result list, where nothing drags.
   *
   * Absent means not draggable, which is what every list but a kanban's is.
   */
  readonly draggable?: boolean | undefined;
  /** The drag began on this row. The host decides what is in flight. */
  readonly onDragStart?: ((row: DocRow, event: DragEvent<HTMLDivElement>) => void) | undefined;
  /** The drag ended, dropped or not — the host clears whatever it lit. */
  readonly onDragEnd?: (() => void) | undefined;
  /**
   * The document is open elsewhere on the board — the top of some other path
   * column or in-place reader — and this row is not the origin: a small dot in
   * the badge cluster (rider 3: "a row open elsewhere on the board carries a
   * dot").
   */
  readonly openElsewhere?: boolean | undefined;
}

/**
 * The prototype's `.needs-you` text, derived from the row's own reasons.
 *
 * It stays the bare kind — `form` — and does **not** carry
 * `unansweredForms`. The pill is "short text only — the reason line carries the
 * sentence" ({@link NeedsYouBadge}), the mockup's own form pill reads `form`
 * with no number, and §10's "says how many" is one statement: putting the count
 * in two places on the same row is two things to keep in step for no second
 * reader.
 */
function needsYouText(attention: readonly string[]): string | null {
  if (attention.includes("form")) return "form";
  if (attention.includes("due")) return "due";
  return null;
}

export function Row(props: RowProps): ReactElement {
  const { row, onOpen, onNotify, unreadCount, now, showReasons, cursor, unreflected } = props;
  const { origin, openElsewhere, draggable, onDragStart, onDragEnd } = props;

  const level = stalenessLevel(row.stale);
  const showActions = hasStaleActions(level);
  const actions = useRowActions(row, {
    ...(onNotify ? { onNotify } : {}),
    ...(now ? { now: () => now } : {}),
  });
  const activity = useAgentActivity(row);

  const excerpt = rowExcerpt(row);
  const context = rowContext(row);
  const age = ageLabel(row, now ?? new Date());
  const chips =
    showReasons === false ? [] : reasonChips(row.attention, row.stale, row.unansweredForms);
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
    // Origin outranks the dot: a row cannot be both, and the host already
    // resolves the tie (SPEC.md §10, rider 3).
    origin === true ? "origin" : openElsewhere === true ? "open-elsewhere" : "",
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
      /* `undefined` rather than `false`: the attribute's presence is what the
         prototype's `.row[draggable="true"]` grab cursor selects on, and a row
         nobody made draggable must not carry it at all. */
      draggable={draggable === true ? true : undefined}
      onClick={open}
      onKeyDown={onKeyDown}
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        if (draggable !== true) return;
        // Chromium refuses to start a drag with an empty data transfer.
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.id);
        onDragStart?.(row, event);
      }}
      onDragEnd={() => {
        if (draggable !== true) return;
        onDragEnd?.();
      }}
    >
      <div className="row-top">
        <span className="type-glyph">{row.type}</span>
        <span className="row-title">{row.title}</span>
        <span className="row-badges">
          {unread !== null ? <UnreadBadge {...unread} /> : null}
          {needsYou !== null ? <NeedsYouBadge text={needsYou} /> : null}
          <AgentActivityDot activity={activity} />
          {unreflected === true ? <ChangedMark /> : null}
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
