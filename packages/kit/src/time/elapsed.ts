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

/**
 * ## Why the format did not change under SHARED-057
 *
 * SPEC.md §10's rider (signed 2026-08-20) forbids a component resizing because
 * of what it holds, and this function has three shapes of different widths by
 * construction: `18m`, `2h 05m`, `1d 03h`. The `padStart(2, "0")` already here
 * says the author was thinking about the digits; it does not make the three
 * shapes one width, and nothing added here could without changing what the
 * string *says*.
 *
 * It was left alone because **every caller renders it into a box that already
 * absorbs the change** (UI-134, measured):
 *
 * - SPEC.md §8's pending row (`.working`) ends its sentence with the duration
 *   and ends the row with the sentence. Nothing is aligned against it.
 * - SPEC.md §7's `last seen 18m ago` reaches `.t-resident-line` and
 *   `.address-line-text`, both of which truncate with an ellipsis and hold the
 *   whole sentence on a `title`.
 *
 * Both stylesheets set `font-variant-numeric: tabular-nums`, which is what makes
 * `18m → 19m` — the tick that happens with nobody touching anything — move
 * nothing. A unit crossing changes the sentence's length once, hours apart, and
 * displaces nothing that is aligned against it. Making the three shapes one
 * width would be a **copy** decision about what a duration says, and that is not
 * a layout fix. If a future caller aligns something after this string, that
 * caller reserves the slot — this function keeps saying the shortest true thing.
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
