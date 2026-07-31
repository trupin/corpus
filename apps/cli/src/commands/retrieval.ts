/**
 * What `corpus search` and `corpus doc related` share beyond their filters: the
 * one thing either of them says that is not a result.
 *
 * Retrieval ships in phases (SPEC.md §9.1). Phase A ranks lexically; Phase B
 * adds semantic relevance to the *same* ranked lists. The seam is already on
 * both response envelopes — `semanticIndex`, absent or `current` throughout
 * Phase A with nothing computing it — so the day ranking is running on half an
 * index, the agent reading these lines is told instead of quietly getting worse
 * answers.
 */

/**
 * The degraded-ranking note, or `undefined` when there is nothing to say.
 *
 * **Any value other than `current` is degraded**, which is the contract's
 * published rule rather than this module's shortcut: a Phase B state a released
 * CLI has never heard of must still read as "degraded", so the field can gain
 * values without a client upgrade. That is why the parameter is a plain string
 * and there is no exhaustive match — an unknown state is reported by name.
 *
 * Absent means the server makes no claim, which is Phase A's normal answer and
 * is silent. The note is `#`-prefixed and goes through the human channel only:
 * the result lines are a parse target an agent reads positionally, and `--json`
 * carries the same field in the envelope, so a machine caller never needs the
 * prose.
 */
export function semanticIndexNote(state: string | undefined): string | undefined {
  if (state === undefined || state === "current") return undefined;
  return (
    `# ranking is degraded — the semantic index is "${state}" (SPEC.md §9.1); ` +
    "these results are ranked on the lexical half alone."
  );
}
