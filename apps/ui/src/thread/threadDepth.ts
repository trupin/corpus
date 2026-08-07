/**
 * How deep a nest of conversations is drawn, and what happens past that.
 *
 * Two constants and no logic, in their own module because the two components
 * that need them — `ThreadCard` and `ThreadPanel` — are **mutually recursive**
 * (a card contains panels for its child threads; a panel contains a card). That
 * cycle is the model (SPEC.md §6: "commenting on a thread turn creates a child
 * thread"), so it is fine for the components; a constant read at module
 * evaluation time through a cycle is not.
 */

/** Past this depth the card stops indenting and says how deep it is instead. */
export const MAX_NESTED_DEPTH = 3;

/**
 * Deeper than this, a conversation is **placed collapsed** rather than drawn.
 *
 * It used to be the depth at which a conversation stopped being a card and
 * became a link that **navigated away** — a fold whose only way back was losing
 * your place, which SPEC.md §11 now rules out ("every collapse expands again in
 * place"). So the cap stayed and its meaning changed: past it the conversation
 * is collapsed rather than dropped, expands where it stands like every other
 * fold, and opening it in its own reader remains a choice rather than the only
 * way to read it.
 */
export const MAX_DRAWN_DEPTH = 4;
