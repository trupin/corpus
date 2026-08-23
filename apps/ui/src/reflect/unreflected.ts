import { isUnreflected, type DocRow, type ReflectStatus } from "@corpus/contract";
import { humanizeAge } from "@corpus/kit";

/**
 * What the board says about **what changed since the agent last looked**
 * (SPEC.md §7, rider 9: "the board shows what is unreflected").
 *
 * ## One predicate, and it is not written here
 *
 * The rule — later than the clock, not the agent's own write, not archived — is
 * `isUnreflected`, and it ships from `@corpus/contract` precisely so it is not
 * written twice: `GET /api/workspace/reflect`'s `changed` counts the corpus with
 * that call, and every mark below applies the same one to a row already on
 * screen. A second predicate meaning the same thing is how the number in the
 * control and the dots under it come to disagree, and there would be no way to
 * tell which of them was lying.
 *
 * So nothing in this module decides *whether* a document is unreflected. What
 * lives here is the counting, the copy, and the rule about what to say when the
 * clock has not arrived yet.
 *
 * ## Withholding is a state, and it needs a spelling
 *
 * A clock this browser has not read is **not** a clock of `null`. `null` means
 * "never reflected", and under it every document in the corpus is unreflected —
 * so a surface that let an unread response fall through to `null` would light
 * every row on the board while it waited for one request. Every entry point here
 * therefore takes `ReflectStatus | undefined` or a `reflected` the caller has
 * already committed to, and the undefined case draws nothing rather than
 * drawing everything.
 */

/**
 * How many of these rows are unreflected — the number a column head shows.
 *
 * `reflected` is the clock as the server reports it. It counts the rows the
 * column **has loaded**, which is what makes it free: no per-row request, no
 * second query, just two timestamps already on hand.
 */
export function unreflectedCount(rows: readonly DocRow[], reflected: string | null): number {
  let count = 0;
  for (const row of rows) {
    if (isUnreflected(row, reflected)) count += 1;
  }
  return count;
}

/** `1 change`, `2 changes` — the count's noun, agreeing with it. */
export function changeNoun(count: number): string {
  return count === 1 ? "change" : "changes";
}

/**
 * The clock as a phrase: `3h`, `just now`, or `null` when there is no clock.
 *
 * `humanizeAge` is the board's one spelling of an elapsed time (`just now`,
 * `3h`, `2d`, `3mo`), so the Reflect control reads the same way every row's age
 * chip does rather than inventing a second vocabulary one bar apart.
 */
export function reflectedAgo(reflected: string | null, now: Date): string | null {
  if (reflected === null) return null;
  const at = Date.parse(reflected);
  if (Number.isNaN(at)) return null;
  return humanizeAge(now.getTime() - at);
}

/**
 * The text beside the control, which is also the link to the last digest thread
 * (SPEC.md §7: "one standalone thread per reflection, the digest").
 *
 * `never reflected` is the honest reading of a `null` clock, and it is a
 * statement about the corpus rather than about this browser — which is why it is
 * only ever produced from a status that actually arrived.
 */
export function reflectedLabel(status: ReflectStatus, now: Date): string {
  const ago = reflectedAgo(status.reflected, now);
  return ago === null ? "never reflected" : `reflected ${ago}`;
}

/**
 * What the button says, in three pieces.
 *
 * Split rather than returned as one string because the **count needs a box of
 * its own**: §10's "nothing resizes because of what it holds" is met by giving
 * the digits a fixed-width tabular slot, and a slot cannot be given to a
 * substring of a sentence. `text` is the same thing joined, which is what
 * assistive technology is given — a screen reader must hear one sentence, not
 * three spans.
 */
export interface ReflectLabel {
  /** Everything before the number: `Reflect`, `Reflect · `, `reflecting…`. */
  readonly lead: string;
  /** The unreflected count, or `null` when the label names no number. */
  readonly count: number | null;
  /** Everything after it: ` changes since 3h`, ` change`, `` . */
  readonly trail: string;
  /** The whole label as one string. */
  readonly text: string;
}

function joined(lead: string, count: number | null, trail: string): ReflectLabel {
  return { lead, count, trail, text: `${lead}${count === null ? "" : String(count)}${trail}` };
}

/** What the button says. */
export function reflectControlLabel(status: ReflectStatus | undefined, now: Date): ReflectLabel {
  // Nothing has arrived: the button still works — a person may always ask — and
  // it claims nothing about a corpus it has not read.
  if (status === undefined) return joined("Reflect", null, "");
  // §7: an ask while one is pending is answered with the pending one. So the
  // control reports the reflection rather than offering a second.
  if (status.pending !== null) return joined("reflecting…", null, "");
  if (status.changed === 0) return joined("Reflect", null, "");
  const ago = reflectedAgo(status.reflected, now);
  const noun = changeNoun(status.changed);
  // A clock of `null` is a corpus never reflected on, and there is no "since" to
  // name: the clause is dropped rather than filled with a word for nothing.
  return joined("Reflect · ", status.changed, ago === null ? ` ${noun}` : ` ${noun} since ${ago}`);
}

/**
 * The control's tooltip, which is where the **quiet window** is stated.
 *
 * A `quiet` of `0` disables the automatic path entirely (§7), so the sentence
 * changes rather than quietly reporting a window of nothing: with no automatic
 * reflection, this button and `corpus reflect` are the only two ways one
 * happens, and a person who never presses it would otherwise be waiting for
 * something that is never coming.
 */
export function reflectControlTitle(status: ReflectStatus | undefined): string {
  if (status === undefined) {
    return "Ask the agent to reflect over the whole corpus. The clock has not been read yet.";
  }
  if (status.pending !== null) {
    return (
      "A reflection is already running over the whole corpus. Asking again would not " +
      "start a second one, so the control waits for this one."
    );
  }
  const manual =
    "Reflections are manual only — this workspace sets `reflect.quiet` to 0, so the server " +
    "enqueues none by itself. Ask for one here, or with `corpus reflect`.";
  const automatic =
    `A reflection also happens by itself once the corpus has been quiet for ` +
    `${String(status.quiet)} minutes after a change.`;
  return `Reflect over the whole corpus now. ${status.quiet === 0 ? manual : automatic}`;
}
