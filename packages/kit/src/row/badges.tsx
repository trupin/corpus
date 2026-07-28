import type { ReactElement } from "react";

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

export interface UnreadBadgeProps {
  /**
   * Unread turns, when the caller knows. **The wire does not**: `DocRow.unread`
   * is a boolean, so the badge reads `new` from collection data alone and shows
   * a number only when something richer supplies one.
   */
  readonly count?: number | null | undefined;
}

/** The accent pill with the leading 6px dot; `.unread::before` draws the dot. */
export function UnreadBadge({ count }: UnreadBadgeProps): ReactElement {
  const known = typeof count === "number" && count > 0;
  const text = known ? String(count) : "new";
  const label = known ? `${String(count)} unread turns` : "Unread — a turn you have not seen";
  return (
    <span className="unread" aria-label={label} title={label}>
      {text}
    </span>
  );
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

export interface LockChipProps {
  /** The party holding the edit lock (SPEC.md §7). */
  readonly holder: string;
}

/**
 * The `.chip.warn` lock indicator. Lock state never rides a `DocRow`; it comes
 * from the lock projection through `useLocks()`, which is what makes it appear
 * and clear live over SSE.
 */
export function LockChip({ holder }: LockChipProps): ReactElement {
  const label = `${holder} is editing this document`;
  return (
    <span className="chip warn row-lock" aria-label={label} title={label}>
      🔒 {holder} editing
    </span>
  );
}
