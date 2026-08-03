/**
 * Where the caret sits in a query string, as a pure function of `(text, caret)`
 * — the same contract the `@` / `/` / `[[` triggers keep (kit's `triggers.ts`),
 * for the same reason: detection is testable without a DOM, and the input and
 * its menu never have to agree about anything but this shape.
 *
 * The grammar it walks is the query string's, not prose:
 *
 *     type=note,view&status=open
 *     ╰──╯ ╰──╯╰──╯ ╰────╯╰──╯
 *    field  value value field value
 *
 * `&` starts a new field, `=` ends one, `,` starts the next value of a
 * multi-valued field. Everything else is part of the token being typed. There
 * is no sigil to wait for: in a query string *every* position is either a field
 * name or a value, so the menu can be useful from the first keystroke.
 */

export type QueryTriggerKind = "field" | "value";

export interface QueryTrigger {
  readonly kind: QueryTriggerKind;
  /** The field whose value is being typed; `""` for a field trigger. */
  readonly field: string;
  /** Offset of the first character the completion replaces. */
  readonly start: number;
  /** Offset of the last, i.e. the caret. */
  readonly end: number;
  /** What has been typed into the token so far, trimmed. */
  readonly query: string;
}

/** Offset just past the `&` that opens the caret's field, or 0. */
function segmentStart(text: string, caret: number): number {
  return text.lastIndexOf("&", caret - 1) + 1;
}

/**
 * The token under the caret.
 *
 * Leading whitespace is excluded from `start` so a completion replaces the word
 * and not the space in front of it — ` type` completes to ` type=`, keeping
 * whatever spacing the person was using.
 */
function token(text: string, from: number, caret: number): { start: number; query: string } {
  const raw = text.slice(from, caret);
  const lead = raw.length - raw.trimStart().length;
  return { start: from + lead, query: raw.trim() };
}

export function detectQueryTrigger(text: string, caret: number): QueryTrigger | null {
  if (caret < 0 || caret > text.length) return null;
  const from = segmentStart(text, caret);
  const segment = text.slice(from, caret);
  const equals = segment.indexOf("=");

  if (equals === -1) {
    const { start, query } = token(text, from, caret);
    return { kind: "field", field: "", start, end: caret, query };
  }

  const field = segment.slice(0, equals).trim();
  // A multi-valued field restarts its token at each comma; a single-valued one
  // has no commas to find, so the same rule serves both.
  const after = segment.slice(equals + 1);
  const from2 = from + equals + 1 + after.lastIndexOf(",") + 1;
  const { start, query } = token(text, from2, caret);
  return { kind: "value", field, start, end: caret, query };
}

export interface QueryCompletion {
  readonly text: string;
  readonly caret: number;
}

/**
 * Replaces the token under the caret with a chosen completion.
 *
 * A field completion carries its `=` along, because the only thing that can
 * follow a field name is one — making the user type it would be a keystroke the
 * menu already knows about. A value completion inserts the bare value: what
 * follows it is `&`, `,` or nothing, and guessing which would be wrong two
 * times out of three.
 */
export function applyQueryCompletion(
  text: string,
  trigger: QueryTrigger,
  value: string,
): QueryCompletion {
  const inserted = trigger.kind === "field" ? `${value}=` : value;
  return {
    text: `${text.slice(0, trigger.start)}${inserted}${text.slice(trigger.end)}`,
    caret: trigger.start + inserted.length,
  };
}
