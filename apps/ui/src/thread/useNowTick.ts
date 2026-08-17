import { useEffect, useState } from "react";

/**
 * A clock the conversation surface reads, ticked coarsely.
 *
 * Two things on a thread card go stale **without anything arriving**: SPEC.md
 * §8's pending row counts up from a turn nobody is going to re-send, and §7's
 * liveness verdict expires on its own — `isAgentPresent` treats a `live: true`
 * whose evidence has aged past the grace window as lapsed, so a badge that only
 * repainted on data would keep saying somebody is there after they left.
 *
 * One spelling for both, because they are one interval on one card and the
 * console pill already picked it: 15 s, which is the pending row's original
 * constant and the cadence `AgentPill` re-evaluates presence on. Coarse on
 * purpose — nothing here changes faster than every 45 s except a lapse, and a
 * lapse is measured in minutes.
 */

/** Coarse on purpose: nothing that reads this changes faster than this. */
export const TICK_MS = 15_000;

/** `Date.now()`, re-read every {@link TICK_MS} for as long as the caller is mounted. */
export function useNowTick(period: number = TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, period);
    return () => {
      clearInterval(timer);
    };
  }, [period]);
  return now;
}
