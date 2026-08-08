import type { ThreadTurn } from "@corpus/kit";

/**
 * Which model wrote a turn — and, just as importantly, when to say nothing
 * (SPEC.md §11, rider signed 2026-08-07).
 *
 * The rider's sentence is short and every clause of it is a rule this function
 * enforces: "A turn a person wrote names no model, and a turn written before
 * this was recorded shows **nothing** rather than a guess: an unknown that says
 * so is worth more than a plausible attribution nobody can check."
 *
 * So there is exactly one thing to render — a name somebody recorded — and three
 * ways to have nothing, all of which render identically to nothing at all. No
 * "unknown", no `—`, no greyed placeholder: a dash in the slot where a model
 * goes is read as a value, and the whole point of the field is that a reader can
 * trust what it says.
 */

/**
 * The author whose turns can carry one. `ACTORS` is `user | agent`
 * (`@corpus/contract`), and only the agent's turn ever names a model.
 */
const AGENT_AUTHOR = "agent";

/**
 * The model to show beside this turn's author and timestamp, or `null` for
 * nothing.
 *
 * Three refusals, in the order they can occur:
 *
 * 1. **A person's turn names no model.** `POST …/turns` already `400`s on a
 *    model supplied for a non-`agent` author, so the only way one reaches here
 *    is a hand-edited `turnModels` entry in the thread file's frontmatter — an
 *    attribution the server would have refused to write. Publishing it because
 *    it happens to be on disk would be the UI making the claim on its behalf.
 * 2. **No record is nothing.** `model` is required-and-nullable on the wire
 *    (CONTRACT-043) precisely so that "nobody recorded one" is a value rather
 *    than a missing key; `undefined` is covered too, because a cache entry
 *    written by an older build of this app is a shape TypeScript cannot see.
 * 3. **A blank record is no record.** The contract's `TurnModelSchema` refuses a
 *    blank string, but the projection reads a file a person can edit, and a
 *    whitespace-only entry would otherwise draw an empty chip — a marker with
 *    nothing in it, which asserts that a model is named and then declines to say
 *    which.
 *
 * The name is returned trimmed for the same reason it is checked: it is drawn
 * inside a bordered chip, where stray whitespace is visible as lopsided padding.
 */
export function turnModelLabel(turn: ThreadTurn): string | null {
  if (turn.author !== AGENT_AUTHOR) return null;
  const named = turn.model?.trim() ?? "";
  return named === "" ? null : named;
}
