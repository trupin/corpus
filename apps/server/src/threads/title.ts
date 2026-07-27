// Where a thread's title comes from when the client does not supply one
// (SPEC.md §6: "derived from anchor quote or first turn").
//
// A title is presentation, not identity, and the agent is expected to improve it
// after the first exchange (§6's standalone-thread note). So the rules below aim
// at "recognisable in a list today", not at being final.

import { fencedCodeRanges, splitLines } from "../core/index.js";

/** How much of the quote an anchored thread's title carries. */
export const ANCHOR_TITLE_QUOTE_LENGTH = 60;

/** How much of the first turn a standalone thread's title carries. */
export const STANDALONE_TITLE_LENGTH = 80;

/** When nothing usable can be derived — a first turn that is only a code fence. */
export const UNTITLED_THREAD = "Untitled thread";

/**
 * The first line of a body that is prose. Fenced code is skipped, so a turn that
 * opens with a stack trace or a snippet is titled by its first sentence rather
 * than by a fence marker — and a turn that is *only* a fence yields nothing,
 * which is the fallback's cue.
 */
export function firstProseLine(body: string): string | null {
  const fenced = fencedCodeRanges(body);
  for (const line of splitLines(body)) {
    const inCode = fenced.some((range) => line.start < range.end && line.contentEnd > range.start);
    if (inCode) continue;
    const text = line.text.trim();
    if (text !== "") return text;
  }
  return null;
}

export interface TitleInput {
  /** An explicit `title` from the request always wins, whatever the mode. */
  readonly title?: string | undefined;
  /** The anchored mode's quote. */
  readonly exact?: string | undefined;
  /** The whole-document mode's parent title. */
  readonly parentTitle?: string | undefined;
  /** The first turn's body, for the standalone mode. */
  readonly body: string;
}

export function deriveThreadTitle(input: TitleInput): string {
  const explicit = input.title?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;

  if (input.exact !== undefined) {
    return `Re: "${input.exact.slice(0, ANCHOR_TITLE_QUOTE_LENGTH)}"`;
  }

  const parentTitle = input.parentTitle?.trim();
  if (parentTitle !== undefined && parentTitle !== "") return `Re: ${parentTitle}`;

  const line = firstProseLine(input.body);
  if (line === null) return UNTITLED_THREAD;
  return line.slice(0, STANDALONE_TITLE_LENGTH);
}
