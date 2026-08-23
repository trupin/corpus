/**
 * The one-line form of a registry description (CLI-056).
 *
 * `corpus <verb> --help=brief` needs a gloss for every flag and every argument,
 * and there were two ways to get one: a second field per declaration, or the
 * first sentence of the one that already exists. A second field is a second
 * source of truth, and its failure mode is silent — a flag whose long text is
 * rewritten and whose gloss still describes the old behaviour reads as
 * authoritative and is wrong. So the gloss is **derived**, and there is exactly
 * one string per declaration: brief help cannot drift from full help, because
 * they are the same sentence.
 *
 * What keeps the derived form worth reading is `registry/validate.ts`: the first
 * sentence of every description must be at most {@link MAX_GLOSS_WORDS} words,
 * checked when the registry module loads. That turns "the opening sentence
 * should stand alone as a gloss" from a hope into a property the surface cannot
 * ship without. It costs the long text nothing — splitting a 35-word opening
 * sentence in two improves the prose a person reads as well.
 */

/**
 * The cap `registry/validate.ts` enforces on an opening sentence. Thirty words
 * is about two wrapped terminal lines beside a flag name, which is the most a
 * reader scanning a list will take in before it stops being a gloss.
 */
export const MAX_GLOSS_WORDS = 30;

const TERMINATORS: ReadonlySet<string> = new Set([".", "?", "!"]);

/**
 * Markup allowed between a terminator and the space that follows it. Registry
 * prose is markdown, so a sentence routinely ends `…board's scope.**` or
 * `…(SPEC.md §10, rider 2).` — treating the terminator as mid-sentence there
 * would run the gloss into the next two paragraphs.
 *
 * A backtick is deliberately absent: a terminator inside a code span is skipped
 * by the span tracking below and never reaches this set.
 */
const CLOSERS: ReadonlySet<string> = new Set(["*", "_", ")", "]", '"', "'"]);

/** Abbreviations whose full stop is not the end of a sentence. */
const ABBREVIATION = /(?:^|[\s([])(?:e\.g|i\.e|cf|vs|etc)$/i;

/**
 * The first sentence of `description`, trimmed — what `--help=brief` prints and
 * what `registry/validate.ts` measures.
 */
export function gloss(description: string): string {
  return description.slice(0, firstSentenceEnd(description)).trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Index just past the first sentence.
 *
 * Three things end one: a blank line (whatever follows is a new paragraph, and
 * no gloss spans two), the end of the string, and a terminator that is outside a
 * code span, not part of an abbreviation, and followed — past any closing markup
 * — by whitespace. That last clause is what keeps `SPEC.md`, `§9.2` and `1.5`
 * from splitting a sentence in half: their full stops are followed by a letter
 * or a digit, never by a space.
 */
function firstSentenceEnd(text: string): number {
  let inCodeSpan = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "`") {
      inCodeSpan = !inCodeSpan;
      continue;
    }
    if (inCodeSpan || char === undefined) continue;
    if (char === "\n" && text[index + 1] === "\n") return index;
    if (!TERMINATORS.has(char)) continue;
    if (ABBREVIATION.test(text.slice(0, index))) continue;

    let after = index + 1;
    while (after < text.length && CLOSERS.has(text[after] ?? "")) after += 1;
    const next = text[after];
    if (next === undefined || /\s/.test(next)) return after;
  }

  return text.length;
}
