import type { Range } from "./types.js";

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** True when `offset` falls between the two halves of a surrogate pair. */
export function splitsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  return isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset));
}

/**
 * Snap a range outward to code-point boundaries: a start splitting a pair
 * moves down one unit, an end splitting a pair moves up one — the full
 * character is included rather than truncated to a lone surrogate.
 */
export function snapRange(text: string, range: Range): Range {
  let { start, end } = range;
  if (splitsSurrogatePair(text, start)) start -= 1;
  if (splitsSurrogatePair(text, end)) end += 1;
  return { start, end };
}

/** True when `text` contains no lone surrogate (is a well-formed UTF-16 string). */
export function isWellFormedText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code)) {
      if (i + 1 >= text.length || !isLowSurrogate(text.charCodeAt(i + 1))) return false;
      i++;
    } else if (isLowSurrogate(code)) {
      return false;
    }
  }
  return true;
}
