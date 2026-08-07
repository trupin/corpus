import type { DocRow } from "@corpus/contract";
import type { MouseEvent, ReactElement } from "react";
import { readStateOf, RESOLVED_STATUS, type ThreadReadState } from "./threadCollapse";

/**
 * A collapsed conversation: one line that still says what it is.
 *
 * SPEC.md §11 fixes the contents, and every clause of it is load-bearing —
 * **collapsed is never hidden**, so the line reports that the conversation
 * exists, what it is about, who spoke last, how many turns are inside and
 * whether it holds anything unseen. A fold that dropped any of those would be a
 * worse bug than the density it fixes: a resolved conversation is part of the
 * document's record, and the reader has to be able to tell, without expanding
 * it, whether it is the one they are looking for.
 *
 * **The turn count is the whole size, not a remainder.** That is the same
 * instinct the fence clipping already ships ("Show all 60 lines"), and §11 makes
 * it the rule for a fold: the difference between a collapse and a truncation is
 * whether the thing tells you how big it is.
 *
 * **It renders no conversation, and that is what keeps SPEC.md §7 true.** A
 * collapsed conversation has displayed nothing and so never counts as read —
 * which is enforced structurally rather than by discipline: this component does
 * not fetch the thread and does not mount `ThreadCard`, so there is no way to
 * show the turns without recording that they were shown, and no way to record it
 * without showing them.
 */

/**
 * What a placement knows about a conversation without opening it.
 *
 * It is the projection's thread row, narrowed to the fields §11's collapsed line
 * needs plus the two the expanded card renders before its own fetch lands. One
 * shape for both states is deliberate: a fold must not change what the reader is
 * told the conversation is, and two shapes are how a chip and a card quietly
 * start disagreeing about which passage they are about.
 */
export interface ThreadSummary {
  readonly id: string;
  readonly status: string;
  /** How many turns are inside — the conversation's whole size. */
  readonly turnCount: number;
  readonly lastAuthor: string | null;
  /**
   * Whether it holds something unseen — or whether the placement has no way to
   * tell (see {@link ThreadReadState}). The line announces only a definite
   * `unread`: a badge is a claim, and so is its absence, but the only way to see
   * this line at all with the answer `unknown` is a fold the reader took with
   * the card in front of them, and this browser is not the authority on what the
   * server recorded as seen.
   */
  readonly readState: ThreadReadState;
  /** The anchored words, or `""` for a conversation about no particular passage. */
  readonly quote: string;
  /** The commented document; `null` is SPEC.md §6's standalone thread. */
  readonly parent: string | null;
  readonly parentTitle: string | null;
}

/** The projection's row is already this, so a placement never has to ask twice. */
export function summaryFromRow(row: DocRow): ThreadSummary {
  return {
    id: row.id,
    status: row.status,
    turnCount: row.turnCount ?? 0,
    lastAuthor: row.lastAuthor,
    readState: readStateOf(row.unread),
    quote: row.anchorQuote?.trim() ?? "",
    parent: row.parent,
    parentTitle: row.parentTitle,
  };
}

/** What the conversation is about — the third thing §11 requires the line to say. */
export function summarySubject(summary: ThreadSummary): string {
  if (summary.quote !== "") return `“${summary.quote}”`;
  return summary.parent === null ? "standalone" : "whole document";
}

/**
 * The line itself.
 *
 * `💬 3 turns · agent · resolved · “lender spreads”`, which is the shipped chip
 * label with the two things §11 added to it: the count says its unit, and the
 * conversation says what it is about.
 */
export function collapsedLabel(summary: ThreadSummary): string {
  const turns = `${String(summary.turnCount)} turn${summary.turnCount === 1 ? "" : "s"}`;
  const who = summary.lastAuthor ?? "new";
  const resolved = summary.status === RESOLVED_STATUS ? " · resolved" : "";
  return `💬 ${turns} · ${who}${resolved} · ${summarySubject(summary)}`;
}

export interface CollapsedThreadProps {
  readonly summary: ThreadSummary;
  readonly onExpand: () => void;
  readonly onContextMenu?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}

export function CollapsedThread({
  summary,
  onExpand,
  onContextMenu,
}: CollapsedThreadProps): ReactElement {
  return (
    <button
      type="button"
      className={summary.status === RESOLVED_STATUS ? "t-chip resolved-chip" : "t-chip"}
      /*
       * An ordinary focusable control, which is the whole of §11's keyboard
       * requirement here: the fold claims **no new key**, so being a button —
       * reachable by Tab, activated by `↵` and by Space — is what makes it
       * operable without a pointer.
       */
      aria-expanded={false}
      data-thread-expand={summary.id}
      title="Expand thread"
      onClick={onExpand}
      {...(onContextMenu === undefined ? {} : { onContextMenu })}
    >
      {collapsedLabel(summary)}
      {summary.readState === "unread" ? <span className="unread">new</span> : null}
    </button>
  );
}
