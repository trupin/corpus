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
  /**
   * Offset just past the last character it replaces — the end of the **token**,
   * which is the caret only when the caret sits at the end of one.
   */
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

/**
 * Where the token under the caret ends.
 *
 * **The caret is not the end of it**, and assuming so is what made mid-token
 * completion duplicate the tail: with the caret two characters into `tye=note`,
 * accepting `type` wrote `type=e=note`, which `parseQueryString` reads as a
 * *known* field — so the unknown-field notice never fired and the column
 * silently rendered empty (PR #19 review). The `@`/`/`/`[[` triggers can look
 * only leftwards because their sigil bounds them; a query string has none, so
 * every caret position is inside a token and the whole token is what a
 * completion replaces.
 *
 * Trailing whitespace stays out, the way {@link token} keeps leading whitespace
 * out: what a person spaced is theirs, and a completion replaces the word.
 */
function tokenEnd(text: string, caret: number, stops: string): number {
  let at = caret;
  while (at < text.length && !stops.includes(text[at] ?? "")) at += 1;
  return caret + text.slice(caret, at).trimEnd().length;
}

/** What closes a field name: its own `=`, or the next field. */
const FIELD_STOPS = "=&";

/** What closes a value: the next value, or the next field. `q=a=b` is one value. */
const VALUE_STOPS = ",&";

export function detectQueryTrigger(text: string, caret: number): QueryTrigger | null {
  if (caret < 0 || caret > text.length) return null;
  const from = segmentStart(text, caret);
  const segment = text.slice(from, caret);
  const equals = segment.indexOf("=");

  if (equals === -1) {
    const { start, query } = token(text, from, caret);
    return { kind: "field", field: "", start, end: tokenEnd(text, caret, FIELD_STOPS), query };
  }

  const field = segment.slice(0, equals).trim();
  // A multi-valued field restarts its token at each comma; a single-valued one
  // has no commas to find, so the same rule serves both.
  const after = segment.slice(equals + 1);
  const from2 = from + equals + 1 + after.lastIndexOf(",") + 1;
  const { start, query } = token(text, from2, caret);
  return { kind: "value", field, start, end: tokenEnd(text, caret, VALUE_STOPS), query };
}

export interface QueryCompletion {
  readonly text: string;
  readonly caret: number;
}

/**
 * Replaces the whole token under the caret with a chosen completion — not just
 * the part in front of it, which would leave the tail behind as a duplicate.
 *
 * A field completion carries its `=` along, because the only thing that can
 * follow a field name is one — making the user type it would be a keystroke the
 * menu already knows about. A value completion inserts the bare value: what
 * follows it is `&`, `,` or nothing, and guessing which would be wrong two
 * times out of three.
 *
 * **A field name ending in `.` is a prefix, not a name** (SPEC.md §5's
 * **Structured fields**). `extra.` opens a namespace whose tail the workspace
 * chose, so what has to follow it is the key and not the operator. Appending
 * `=` there would complete to `extra=`, which is a filter the server does not
 * honour — the menu would be handing the person a broken query. The rule is
 * spelled on the **shape of the name** rather than on the name itself, so this
 * module keeps knowing nothing about which fields exist.
 */
export function applyQueryCompletion(
  text: string,
  trigger: QueryTrigger,
  value: string,
): QueryCompletion {
  // …unless the field already has its `=`, which is the mid-token case: the
  // caret is being used to repair a name that is already followed by a value,
  // and a second operator would break the very query it is fixing.
  const operator = trigger.kind === "field" ? equalsAfter(text, trigger.end) : -1;
  const equipped = operator !== -1;
  const namespace = value.endsWith(".");
  const inserted = trigger.kind === "field" && !equipped && !namespace ? `${value}=` : value;
  // The replacement swallows the gap between the name and its operator, so a
  // repair does not leave the space that hid the operator in the first place.
  const tail = equipped ? operator : trigger.end;
  return {
    text: `${text.slice(0, trigger.start)}${inserted}${text.slice(tail)}`,
    // Past the `=` either way, so typing continues in the value.
    caret: trigger.start + inserted.length + (equipped ? 1 : 0),
  };
}

/**
 * Where this field's own `=` sits after the token, or `-1` when it has none.
 *
 * **It skips the whitespace {@link tokenEnd} deliberately leaves outside the
 * token** (UI-048 item 4). `ty =note` is a name, a space and a value; asking
 * `text[trigger.end] === "="` of it found the space, concluded the field was
 * unequipped, and wrote `type= =note` — a string with two operators, which
 * `parseQueryString` reads as the field `type` holding the value ` =note`. The
 * space is what a person typed and the `=` is still theirs, so the completion
 * repairs across it rather than around it.
 */
function equalsAfter(text: string, from: number): number {
  let at = from;
  while (at < text.length && (text[at] === " " || text[at] === "\t")) at += 1;
  return text[at] === "=" ? at : -1;
}
