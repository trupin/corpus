import { FORM_ANSWER_LABEL, FORM_FENCE_PATTERN, FormSchema, type Form } from "@corpus/contract";
import * as YAML from "yaml";

/**
 * The ```` ```form ```` fence in a turn body (SPEC.md §6), split out so the
 * controls can be rendered in its place.
 *
 * **The grammar is the contract's, matched whole.** `FORM_FENCE_PATTERN` is
 * imported rather than approximated: ```` ```formula ```` and
 * ```` ```form-builder ```` open ordinary code blocks, and a looser match here
 * would make the UI offer controls on a turn the *server* would refuse to accept
 * an answer for (`POST …/form` 404s on a turn that carries no form). The YAML is
 * parsed by the `yaml` library — SPEC.md §5 says never hand-roll one — and
 * validated with the contract's own `FormSchema`, so "what is a form" has one
 * definition across the server, the projection and this menu.
 *
 * A malformed fence is not an error state: the bytes came off a file a person or
 * an agent wrote. It degrades to a code block plus a small warning, exactly as
 * the server degrades it to a `404` rather than a `500`.
 */

/**
 * The lead-in of the answer turn the server writes, re-exported from the
 * contract (CONTRACT-013) rather than restated.
 *
 * It is not a wire field — the answer travels as prose, so it reads as prose in
 * `git log` — but it *is* a shape both sides have to agree on: this module reads
 * it to decide whether a form has already been answered, and a local copy that
 * drifted would offer a live submit on an answered form.
 */
export { FORM_ANSWER_LABEL };

export interface FormFenceSplit {
  /** Markdown before the fence. */
  readonly before: string;
  /** Markdown after the fence. */
  readonly after: string;
  /** The fence's YAML source, or `undefined` when the body carries no form. */
  readonly source: string | undefined;
}

export function splitFormFence(body: string): FormFenceSplit {
  const match = FORM_FENCE_PATTERN.exec(body);
  if (match === null) return { before: body, after: "", source: undefined };
  return {
    before: body.slice(0, match.index).trimEnd(),
    after: body.slice(match.index + match[0].length).trimStart(),
    source: match[1] ?? "",
  };
}

export type ParsedForm =
  | { readonly status: "none" }
  | { readonly status: "ok"; readonly form: Form }
  | { readonly status: "invalid"; readonly source: string; readonly reason: string };

export function parseFormBlock(body: string): ParsedForm {
  const { source } = splitFormFence(body);
  if (source === undefined) return { status: "none" };

  let value: unknown;
  try {
    value = YAML.parse(source) ?? undefined;
  } catch (error) {
    return {
      status: "invalid",
      source,
      reason: error instanceof Error ? error.message : "the YAML could not be parsed",
    };
  }

  const parsed = FormSchema.safeParse(value);
  if (!parsed.success) {
    return {
      status: "invalid",
      source,
      reason: parsed.error.issues[0]?.message ?? "the block is not a valid form",
    };
  }
  return { status: "ok", form: parsed.data };
}

/**
 * The option an answer turn recorded, or `undefined` when the turn is not an
 * answer. The note follows on its own paragraph and is not needed to decide
 * inertness.
 */
export function answeredOption(body: string): string | undefined {
  const first = body.split("\n", 1)[0]?.trim() ?? "";
  if (!first.startsWith(FORM_ANSWER_LABEL)) return undefined;
  const option = first.slice(FORM_ANSWER_LABEL.length).trim();
  return option === "" ? undefined : option;
}

/** The shape {@link mapFormAnswers} reads; `ThreadTurn` and `Turn` both satisfy it. */
export interface AnswerableTurn {
  readonly author: string;
  readonly ts: string;
  readonly body: string;
}

/**
 * Which forms have already been answered, keyed by the timestamp of the turn
 * carrying the form.
 *
 * A form is answered by the first later turn that records one of *its* options —
 * §6 makes an answer a turn like any other, so there is no back-reference to
 * follow, only order. Walking the conversation once is what keeps two forms in
 * one thread from stealing each other's answer: a form stops being the open one
 * the moment it is answered, and a second form opens after it.
 */
export function mapFormAnswers(turns: readonly AnswerableTurn[]): ReadonlyMap<string, string> {
  const answers = new Map<string, string>();
  let open: { readonly ts: string; readonly options: readonly string[] } | null = null;

  for (const turn of turns) {
    const answered = answeredOption(turn.body);
    if (answered !== undefined && open !== null && open.options.includes(answered)) {
      answers.set(open.ts, answered);
      open = null;
      continue;
    }
    if (turn.author !== "agent") continue;
    const parsed = parseFormBlock(turn.body);
    if (parsed.status === "ok") open = { ts: turn.ts, options: parsed.form.options };
  }

  return answers;
}

/**
 * A right-aligned detail, the prototype's `.price`: `Lemonade — $1,840/yr`
 * splits at the last ` — ` so an option reads as label plus figure. Options
 * without one render as a single label, and the **whole verbatim string** is
 * still what an answer submits — §6 says an answer names an option verbatim, so
 * this is presentation and nothing else.
 */
export interface OptionParts {
  readonly label: string;
  readonly detail: string | null;
}

const DETAIL_SEPARATOR = " — ";

export function optionParts(option: string): OptionParts {
  const at = option.lastIndexOf(DETAIL_SEPARATOR);
  if (at === -1) return { label: option, detail: null };
  return {
    label: option.slice(0, at),
    detail: option.slice(at + DETAIL_SEPARATOR.length),
  };
}
