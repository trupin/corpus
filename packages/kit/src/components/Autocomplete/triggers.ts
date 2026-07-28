/**
 * The `@` / `/` / `[[` trigger grammar of SPEC.md §11's "smart input everywhere".
 *
 * **One implementation, three callers** — the thread composer, the document
 * editor's `[[` menu and the global composer. Detection is a pure function of
 * `(text, caret)` so a `contenteditable` and an `<input>` can share it without
 * either one owning a DOM contract.
 *
 * **The boundary rule is the server's, character for character.** `mentions.ts`
 * refuses a sigil preceded by `[A-Za-z0-9_/@.-]` so that `me@agent.example` is
 * an address, `path/comment/x` is a path and `a@agentb` is a word. This module
 * uses the same set, because a menu that opened where the server will not parse
 * a mention would teach the wrong grammar — the UI never resolves routing (§8),
 * but it must not offer a completion the server would ignore.
 *
 * The one place the two deliberately differ is the backslash escape: `\@agent`
 * opens no menu here, while the server still parses it. The menu is an input
 * affordance and suppressing it is how a person types a literal sigil without
 * fighting a popup; the *text* they end up with is untouched, so nothing about
 * what the server sees changes.
 */

export const TRIGGER_KINDS = ["mention", "skill", "ref"] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface TriggerMatch {
  readonly kind: TriggerKind;
  /** Index of the first trigger character (`@`, `/`, or the first `[` of `[[`). */
  readonly start: number;
  /** The caret; the query is `text.slice(start + sigilLength, end)`. */
  readonly end: number;
  /** What has been typed after the trigger, possibly empty. */
  readonly query: string;
}

/** The character class the server refuses to see before a sigil (`mentions.ts`). */
const NON_BOUNDARY = /[A-Za-z0-9_/@.-]/;

/** The token charset after `@` or `/`, also the server's. */
const TOKEN_CHARS = /^[A-Za-z0-9_-]*$/;

/** A `[[` query may hold spaces — titles do — but never a bracket or a newline. */
const REF_QUERY = /^[^[\]\n]*$/;

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function boundaryOk(text: string, index: number): boolean {
  if (index === 0) return true;
  const before = text[index - 1] ?? "";
  return !NON_BOUNDARY.test(before);
}

function sigilMatch(text: string, caret: number, sigil: "@" | "/"): TriggerMatch | null {
  const start = text.lastIndexOf(sigil, caret - 1);
  if (start === -1) return null;
  const query = text.slice(start + 1, caret);
  if (!TOKEN_CHARS.test(query)) return null;
  if (isEscaped(text, start) || !boundaryOk(text, start)) return null;
  return { kind: sigil === "@" ? "mention" : "skill", start, end: caret, query };
}

function refMatch(text: string, caret: number): TriggerMatch | null {
  const start = text.lastIndexOf("[[", caret - 1);
  if (start === -1 || start + 2 > caret) return null;
  const query = text.slice(start + 2, caret);
  if (!REF_QUERY.test(query)) return null;
  if (isEscaped(text, start)) return null;
  return { kind: "ref", start, end: caret, query };
}

/**
 * The open trigger at `caret`, or `null`.
 *
 * When more than one could match, the one that starts *closest to the caret*
 * wins: `[[a/b` is a ref query containing a slash, not a skill invocation
 * inside a ref.
 */
export function detectTrigger(text: string, caret: number): TriggerMatch | null {
  const candidates = [
    refMatch(text, caret),
    sigilMatch(text, caret, "@"),
    sigilMatch(text, caret, "/"),
  ]
    .filter((match): match is TriggerMatch => match !== null)
    .sort((a, b) => b.start - a.start);
  return candidates[0] ?? null;
}

/** The literal text a chosen completion inserts, per trigger kind. */
export function completionText(kind: TriggerKind, token: string): string {
  if (kind === "ref") return `[[${token}]]`;
  return `${kind === "mention" ? "@" : "/"}${token}`;
}

export interface CompletionResult {
  readonly text: string;
  readonly caret: number;
}

/**
 * Replaces the trigger run with the completion, followed by one space so the
 * next word does not glue onto it — and so the trigger cannot immediately
 * re-open on the text it just produced. Completing mid-sentence, where a space
 * already follows, adds none: two spaces would be a change to prose the person
 * did not ask for.
 */
export function applyCompletion(
  text: string,
  match: TriggerMatch,
  token: string,
): CompletionResult {
  const followsSpace = /^\s/.test(text.slice(match.end));
  const inserted = `${completionText(match.kind, token)}${followsSpace ? "" : " "}`;
  const next = `${text.slice(0, match.start)}${inserted}${text.slice(match.end)}`;
  return { text: next, caret: match.start + inserted.length };
}
