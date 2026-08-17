import type { ReactElement } from "react";
import type { LaneLiveness } from "./laneRows.js";

/**
 * Whether somebody is on this lane, as one dot — the four states of
 * {@link LaneLiveness} and no fifth.
 *
 * A component rather than a class name each caller writes, because there are now
 * two callers a screen apart: the composer's recipient row (SPEC.md §7) and the
 * board's resident badge (§11). Two hand-written spellings of
 * `` `lane-dot ${liveness}` `` agree on the day they are written, and the one
 * that gets a fifth state later is the one nobody remembers to update.
 *
 * **The dot is never the whole message.** It is `aria-hidden` and carries no
 * title of its own: liveness is stated in words beside it, by `laneLine`, and a
 * surface that leaves the colour to carry the fact is unreadable to a screen
 * reader and to a third of the people who can see it. `unknown` is drawn hollow
 * *and* faint precisely so it does not read as any of the three verdicts —
 * UI-098's rule needs somewhere for "we have not heard" to live, and this is it.
 */
export interface LaneDotProps {
  readonly liveness: LaneLiveness;
}

export function LaneDot({ liveness }: LaneDotProps): ReactElement {
  return (
    <span className={`lane-dot ${liveness}`} data-lane-liveness={liveness} aria-hidden="true" />
  );
}
