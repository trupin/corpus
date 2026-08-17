/**
 * How long, in words — the one spelling of a duration the board uses.
 *
 * It lives in the kit rather than beside its first caller because it now has
 * two, in the same few square centimetres of screen: SPEC.md §8's pending row
 * ("still waiting — 18m") and SPEC.md §7's recipient picker ("last seen 18m
 * ago"). Two implementations would be two shapes of the same fact sitting one
 * line apart, which is the drift `docs/TS_GUIDELINES.md` names when it says a
 * shared helper earns a named module.
 */

/** `18m`, `2h 05m`, `1d 03h`. */
export function humanizeElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ${String(hours % 24).padStart(2, "0")}h`;
}
