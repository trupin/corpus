import { useEffect, useState, type ReactElement } from "react";

/**
 * The honest pending indicator of SPEC.md §8: while an agent response is
 * outstanding, a `.working` row that says how long it has been outstanding —
 * and **nothing else**.
 *
 * No progress bar, no percentage, no token stream. The server does not know how
 * far along a job is (SPEC.md §2.2 keeps document content off the wire entirely,
 * and a job's progress is not a thing the queue measures), so any bar drawn here
 * would be an animation pretending to be information. What the UI *does* know is
 * when the requesting turn was written, so that is what it reports.
 *
 * **Elapsed is measured from the turn, not from mount.** Reloading the page in
 * the middle of a fifteen-minute job must not reset the message to "agent is
 * working…" — the wait did not restart, and a page that says it did is lying
 * about the only fact this row carries.
 */

export const WORKING_TIERS = {
  /** Under 45 s. */
  fresh: "agent is working…",
  /** 45 s – 3 m. */
  slow: "still working…",
  /** 3 m – 15 m. */
  longer: "still working — longer than usual",
} as const;

export const SLOW_AFTER_MS = 45_000;
export const LONGER_AFTER_MS = 3 * 60_000;
export const ELAPSED_AFTER_MS = 15 * 60_000;

/** Coarse on purpose: nothing here changes faster than every 45 s. */
const TICK_MS = 15_000;

/** `18m`, `2h 05m`, `1d 03h` — the shape the row already uses for ages. */
export function humanizeElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ${String(hours % 24).padStart(2, "0")}h`;
}

export function workingLabel(elapsedMs: number): string {
  if (elapsedMs >= ELAPSED_AFTER_MS) return `still working — ${humanizeElapsed(elapsedMs)}`;
  if (elapsedMs >= LONGER_AFTER_MS) return WORKING_TIERS.longer;
  if (elapsedMs >= SLOW_AFTER_MS) return WORKING_TIERS.slow;
  return WORKING_TIERS.fresh;
}

export interface PendingIndicatorProps {
  /** Timestamp of the turn that asked for the agent. */
  readonly since: string;
}

export function PendingIndicator({ since }: PendingIndicatorProps): ReactElement {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const started = new Date(since).getTime();
  // An unparseable timestamp is not a reason to claim a duration.
  const elapsed = Number.isNaN(started) ? 0 : Math.max(0, now - started);

  return (
    <div className="working" role="status" data-working-since={since}>
      <span className="working-dot" aria-hidden="true" />
      {workingLabel(elapsed)}
    </div>
  );
}
