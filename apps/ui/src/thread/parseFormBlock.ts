import { FORM_ANSWER_LABEL, findFormFence, FormSchema, type Form } from "@corpus/contract";
import * as YAML from "yaml";

/**
 * The ```` ```form ```` fence in a turn body (SPEC.md §6), split out so the
 * controls can be rendered in its place.
 *
 * **The grammar is the contract's, matched whole.** `findFormFence` is imported
 * rather than approximated: ```` ```formula ```` and ```` ```form-builder ````
 * open ordinary code blocks — as do a tilde fence, an unterminated fence, and a
 * form quoted inside an outer example block (the CONTRACT-014 settlement, whose
 * edges live in the contract's docblock) — and a looser match here would make
 * the UI offer controls on a turn the *server* would refuse to accept an answer
 * for (`POST …/form` 404s on a turn that carries no form). The YAML is parsed
 * by the `yaml` library — SPEC.md §5 says never hand-roll one — and validated
 * with the contract's own `FormSchema`, so "what is a form" has one definition
 * across the server, the projection and this menu.
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
  const match = findFormFence(body);
  if (match === undefined) return { before: body, after: "", source: undefined };
  return {
    before: body.slice(0, match.start).trimEnd(),
    after: body.slice(match.end).trimStart(),
    source: match.source,
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
 * An answer this session actually submitted: the form's `ts` as
 * `POST …/turns/{ts}/form` addressed it, and the option that was sent.
 *
 * The route knows exactly which form is being answered; the turn the server
 * writes back does not carry that — the answer travels as prose so it reads as
 * prose in `git log` (`FORM_ANSWER_LABEL`). Keeping the pairing the client
 * already had is what stops the replay below from having to guess about the
 * one answer it does not have to guess about (PR #10 finding 12).
 */
export interface SubmittedAnswer {
  /** The `ts` of the turn carrying the form — the form's identity (SPEC.md §6). */
  readonly formTs: string;
  readonly option: string;
}

/**
 * Which forms have already been answered, keyed by the timestamp of the turn
 * carrying the form — which is the form's identity (SPEC.md §6).
 *
 * A form is answered by a later turn that records one of *its* options. The
 * answer turn is prose with no back-reference to the form it answers, so a
 * thread read off disk can only be attributed by **order**. Two rules, and the
 * first is what PR #10's finding 12 is about:
 *
 * - **A known pairing wins.** `submitted` carries the `formTs` this session
 *   sent an answer to, so the form the user actually clicked is the form that
 *   goes inert — even when a second, still-open form offers the same option
 *   string. Nothing is re-derived from the prose for that answer.
 * - **Otherwise, earliest open form first.** Every unanswered form stays open:
 *   tracking a single "current" form let a second form silently evict the
 *   first, so the earlier one could never be marked answered at all. Forms are
 *   asked and answered in order, so an unattributed answer goes to the earliest
 *   still-open form that offers it, preferring one this session has *not*
 *   already paired. That is a rule, not knowledge — after a reload the prose is
 *   all there is — but it is the ordering the conversation itself implies.
 *
 * An answer no open form offers belongs to none of them and is left alone: it
 * is an ordinary turn that happens to start with the label.
 */
export function mapFormAnswers(
  turns: readonly AnswerableTurn[],
  submitted: readonly SubmittedAnswer[] = [],
): ReadonlyMap<string, string> {
  const answers = new Map<string, string>();
  const known = new Map(submitted.map((entry) => [entry.formTs, entry.option]));
  const open: { readonly ts: string; readonly options: readonly string[] }[] = [];

  for (const turn of turns) {
    const answered = answeredOption(turn.body);
    if (answered !== undefined) {
      const target =
        open.find((form) => known.get(form.ts) === answered) ??
        open.find((form) => !known.has(form.ts) && form.options.includes(answered)) ??
        open.find((form) => form.options.includes(answered));
      if (target !== undefined) {
        answers.set(target.ts, answered);
        open.splice(open.indexOf(target), 1);
        continue;
      }
    }
    if (turn.author !== "agent") continue;
    const parsed = parseFormBlock(turn.body);
    if (parsed.status === "ok") open.push({ ts: turn.ts, options: parsed.form.options });
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
