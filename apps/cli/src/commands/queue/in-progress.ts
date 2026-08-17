import type { InProgressSet } from "@corpus/contract";
import type { Output } from "../../output.js";
import { formatAge } from "../age.js";
import { oneLine, renderColumns } from "../columns.js";

/**
 * What the server still thinks the agent is doing, rendered for a person
 * (SPEC.md §7, "The agent can see what the server still thinks it is doing").
 *
 * The set arrives beside every claim, so the loudest requirement is **silence
 * when there is nothing to say**: an empty set is the overwhelmingly common case
 * and must not add a line to every iteration of the loop.
 *
 * Three things this rendering owes the reader, all of them from the rider:
 *
 * - **It is not the batch.** The header says so in as many words, because the
 *   one failure mode worth engineering against is an agent that reads these rows
 *   as work it just claimed and does it again. In `--json` the separation is
 *   structural (`inProgress` is its own key, published verbatim); here it is the
 *   sentence plus the stream — the block goes to stderr while the claimed batch
 *   goes to stdout ({@link Output.note}).
 * - **The cut is never silent.** `total` and `truncated` both reach the surface:
 *   the header carries the total and, when the cap bit, a final row says how
 *   many more are held. A capped list that reads as a complete one is exactly
 *   what the contract's overflow pair exists to prevent.
 * - **`heldSince` is an instant on the wire, and an age here.** The contract's
 *   docblock assigns the rendering to this layer explicitly and keeps the
 *   instant in `--json`, so an agent computes the age against its own clock.
 */

/**
 * `held 45s` / `held 12m` / `held 3h` / `held 2d` — one significant unit, which
 * is all this row is for: the reader is deciding whether they recognise the
 * work, not measuring it. The ladder itself is `../age.ts`'s, shared with
 * `corpus agents` so two verbs cannot disagree about what three hours looks
 * like.
 *
 * A future `heldSince` (clock skew between the server and this machine) clamps
 * to `held 0s` rather than rendering a negative age, and a value that is not a
 * date at all falls back to printing it raw — a wrong-looking instant is
 * debuggable, `held NaNs` is not.
 */
export function formatHeldFor(heldSince: string, now: number): string {
  const since = Date.parse(heldSince);
  if (Number.isNaN(since)) return `held since ${heldSince}`;
  return `held ${formatAge(now - since)}`;
}

/**
 * The block, or no lines at all when nothing is held.
 *
 * The origin cell prefers the title, falls back to the id when the document has
 * been deleted since (the contract nulls the title in exactly that case, and an
 * id still tells the reader *which* document), and shows an em dash for an event
 * that names no document at all.
 */
export function renderInProgress(set: InProgressSet, now: number): readonly string[] {
  if (set.total === 0 && set.events.length === 0) return [];

  // A server that under-reported `total` must not make the header claim fewer
  // held events than it went on to list.
  const held = Math.max(set.total, set.events.length);
  const lines = [
    `the server still holds ${String(held)} ${held === 1 ? "event" : "events"} ` +
      `in-progress — not claimed by this call:`,
  ];

  const rows = set.events.map((event) => [
    event.id,
    event.type,
    formatHeldFor(event.heldSince, now),
    originOf(event.originTitle, event.originId),
  ]);
  for (const row of renderColumns(rows)) lines.push(`  ${row}`);

  // Either half of the overflow pair is enough on its own: `truncated` is what
  // the contract says to branch on, and a positive remainder is the arithmetic
  // that proves it. Trusting only one of them would make a server that dropped
  // that one print a capped list as if it were complete.
  const more = Math.max(0, held - set.events.length);
  if (set.truncated || more > 0) {
    lines.push(`  … and ${String(more)} more held, not shown (${String(held)} in total)`);
  }

  return lines;
}

/**
 * Writes the block to stderr, in human mode only.
 *
 * **`set` is typed as possibly absent even though the contract makes the field
 * required**, and that is deliberate rather than defensive habit: by the time
 * this runs, `claim-all` has already moved the events out of `pending/`. A throw
 * here would strand a batch the server has already handed over, so a server that
 * omits the report costs a diagnostic instead of costing the work.
 */
export function reportInProgress(
  out: Output,
  set: InProgressSet | undefined,
  now = Date.now(),
): void {
  if (set === undefined) return;
  for (const line of renderInProgress(set, now)) out.note(line);
}

function originOf(title: string | null, id: string | null): string {
  if (title !== null && title.trim() !== "") return oneLine(title);
  return id ?? "—";
}
