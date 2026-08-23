import type { DocRow } from "@corpus/contract";
import type { ReactElement } from "react";
import type { AgentActivity } from "./useRowSignals.js";

/**
 * The row's badge vocabulary, ported from `design/index.html`.
 *
 * Every badge carries accessible text. The prototype's badges are colour and
 * shape — an accent pill, a signal pill, a pulsing dot — and a pulsing dot with
 * no label is simply invisible to a screen reader, so each one below pairs its
 * visual with a `title` and an `aria-label` naming what it means.
 *
 * The three axes are disjoint and stay that way (UI-001): `--accent` is the
 * agent/unread axis, `--signal` is the needs-you axis, `--sepia` is the
 * staleness axis. No badge here borrows another's colour.
 */

/** What the number on an unread pill counts. Only the accessible copy differs. */
export type UnreadUnit = "turns" | "threads";

export interface UnreadBadgeProps {
  /**
   * The count, when there is an honest one. A *thread* row usually has none —
   * `DocRow.unread` is a boolean — and then the badge reads `new`. A *document*
   * row always has one: `DocRow.unreadThreads` (CONTRACT-012).
   */
  readonly count?: number | null | undefined;
  /**
   * What `count` counts. A document row's number is unread **threads**, not
   * turns, and telling a screen reader "3 unread turns" about a document with
   * three unread conversations is simply a false statement.
   */
  readonly unit?: UnreadUnit | undefined;
}

/** The accent pill with the leading 6px dot; `.unread::before` draws the dot. */
export function UnreadBadge({ count, unit = "turns" }: UnreadBadgeProps): ReactElement {
  const known = typeof count === "number" && count > 0;
  const text = known ? String(count) : "new";
  // "1 unread threads" is the sort of thing only a screen reader has to sit
  // through, which is exactly why it gets fixed rather than shrugged at.
  const noun = count === 1 ? unit.slice(0, -1) : unit;
  const label = known ? `${String(count)} unread ${noun}` : "Unread — a turn you have not seen";
  return (
    <span className="unread" aria-label={label} title={label}>
      {text}
    </span>
  );
}

/**
 * Which unread pill a row shows — **at most one, never two** (sprint-010
 * TEST-116).
 *
 * The two axes look alike and are not the same fact, and the wire keeps them
 * apart by type:
 *
 * - a **thread** row carries `unread: boolean` — has *this conversation* moved
 *   since you last looked — and no count, so its pill reads `new` unless a host
 *   supplies something richer;
 * - a **document** row carries `unread: null` by contract and
 *   `unreadThreads: number` — how many of *its* threads have moved — which is
 *   the aggregate the prototype renders as `<span class="unread">2</span>`
 *   (`design/index.html`, `doc_mortgage`). Gating on `unread === true` alone is
 *   why that pill was computed on the wire and never drawn.
 *
 * `override` is the host's `unreadCount` and wins over both, for a surface that
 * knows better than the collection row does. Returns the badge's props, or
 * `null` for "this row has nothing unread to say".
 */
export function unreadBadgeProps(
  row: Pick<DocRow, "unread" | "unreadThreads">,
  override?: number | null,
): UnreadBadgeProps | null {
  const supplied = typeof override === "number" ? override : null;
  if (row.unread !== null) {
    // A thread row. The boolean decides; the count is decoration when present.
    if (!row.unread) return null;
    return supplied === null ? { unit: "turns" } : { count: supplied, unit: "turns" };
  }
  const count = supplied ?? row.unreadThreads;
  return count > 0 ? { count, unit: "threads" } : null;
}

export interface NeedsYouBadgeProps {
  /** Short text, as the prototype spells it: `form`, `3 due`. */
  readonly text: string;
  /** Long form for assistive tech; defaults to the short text. */
  readonly label?: string | undefined;
}

/** The `--signal` pill. Short text only — the reason line carries the sentence. */
export function NeedsYouBadge({ text, label }: NeedsYouBadgeProps): ReactElement {
  const description = label ?? text;
  return (
    <span className="needs-you" aria-label={description} title={description}>
      {text}
    </span>
  );
}

export interface WorkingDotProps {
  /** What is actually running — a job title, a thread the agent was drawn into. */
  readonly title: string;
}

/**
 * The pending-agent indicator (SPEC.md §8): a pulsing dot and nothing else. No
 * progress bar, no percentage, no token stream — a row cannot honestly claim to
 * know how far along the agent is, so it claims only that something is running.
 * The escalating "still working…" copy belongs to the reader and thread
 * surfaces, which have room for a sentence.
 */
export function WorkingDot({ title }: WorkingDotProps): ReactElement {
  return <span className="working-dot" role="status" aria-label={title} title={title} />;
}

/**
 * The same dot for work **nobody has taken** — a hollow ring that does not pulse
 * (SPEC.md §8's rider, signed 2026-08-12; UI-097).
 *
 * The pulse is the claim. It is what a person reads as "something is happening
 * right now", so a queue of unclaimed events pulsing across a column said the
 * agent was busy with every one of them while no agent was running at all. A
 * still, unfilled ring says the opposite in the same glance and in the same
 * place: the row is spoken for, and nothing has started.
 */
export function QueuedDot({ title }: WorkingDotProps): ReactElement {
  return <span className="queued-dot" role="status" aria-label={title} title={title} />;
}

export interface AgentActivityDotProps {
  readonly activity: AgentActivity;
}

/**
 * The row's agent signal, whichever of the two it is — so a row draws it with
 * one call and cannot draw the pulsing one for an unclaimed event by mistake.
 *
 * It exists because the choice between the two dots is a rule, not a rendering
 * detail: any surface that draws this signal calls this one function, and a rule
 * each caller re-derives is a rule that holds in some of them.
 */
export function AgentActivityDot({ activity }: AgentActivityDotProps): ReactElement | null {
  if (activity.state === "working") return <WorkingDot title={activity.title} />;
  if (activity.state === "waiting") return <QueuedDot title={activity.title} />;
  return null;
}

/**
 * **Changed since the agent last looked** (SPEC.md §7's rider 9): the diamond a
 * row, a column head and a board tab all draw.
 *
 * Shipped as a component rather than left to each surface's markup for the
 * reason `row.css` gives its class: it is one mark meaning one thing, and it
 * carries a name — a bare `<span>` with a class is invisible to a screen reader,
 * and this is the only cue on the row that says the agent has not been round.
 *
 * It says nothing about *how many* and nothing about *when*. The count is the
 * column head's, and the clock is the Reflect control's; a mark that repeated
 * either would be two places to keep in step.
 */
export const CHANGED_MARK_LABEL = "Changed since the agent last reflected";

export function ChangedMark(): ReactElement {
  return (
    <span
      className="changed-mark"
      role="img"
      aria-label={CHANGED_MARK_LABEL}
      title={CHANGED_MARK_LABEL}
    />
  );
}

export interface AgeChipProps {
  readonly label: string;
}

/** The mono age chip. Its colour comes from the row's `.age-N` class, not from here. */
export function AgeChip({ label }: AgeChipProps): ReactElement {
  return (
    <span className="age" title={`Last activity: ${label}`}>
      {label}
    </span>
  );
}
