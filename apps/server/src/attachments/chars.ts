// Control-character predicates, shared by the two places attachments have to
// reject them: the filename sanitizer and the serving path's segment and header
// validation.
//
// Written as code-point tests rather than as a regular expression on purpose. A
// character class spanning U+0000–U+001F is what `no-control-regex` exists to
// flag — the rule is right that a literal control byte in a pattern is usually a
// typo — and "is this code point a control character" is a question a predicate
// answers more legibly than an escape sequence does.

/** C0 controls (including NUL), DEL, and the C1 range. */
export function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (isControlCode(character.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

/** Drops control characters entirely — they are noise, never content. */
export function stripControlCharacters(value: string): string {
  if (!hasControlCharacter(value)) return value;
  return [...value].filter((character) => !isControlCode(character.codePointAt(0) ?? 0)).join("");
}

/** Replaces every character outside printable ASCII, for a header's ASCII fallback. */
export function toPrintableAscii(value: string, replacement: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0x7e ? character : replacement;
    })
    .join("");
}
