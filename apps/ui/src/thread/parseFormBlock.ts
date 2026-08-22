import {
  FORM_ANSWER_LABEL,
  describeFormFailure,
  findFormFence,
  FormSchema,
  isFormAnswerBody,
  parseFormAnswerBody,
  type Form,
  type FormAnswerRecord,
  type FormFieldRecord,
} from "@corpus/contract";
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

export type ReadForm =
  | { readonly status: "ok"; readonly form: Form }
  | { readonly status: "invalid"; readonly source: string; readonly reason: string };

export type ParsedForm = { readonly status: "none" } | ReadForm;

/**
 * A body's form, in one pass: the fence scan, then the YAML.
 *
 * A caller that has already split the fence out — because it renders what
 * surrounds the form as well as the form — must call {@link parseFormSource}
 * with the source it holds instead. `Turn` did neither: it split the fence and
 * then handed the **whole body** back to this function, which scanned for the
 * fence a second time and re-parsed the YAML, on every render of every agent
 * turn carrying a form (PR #28 re-review, MINOR).
 */
export function parseFormBlock(body: string): ParsedForm {
  const { source } = splitFormFence(body);
  if (source === undefined) return { status: "none" };
  return parseFormSource(source);
}

/** The fence's YAML, read as a form — {@link parseFormBlock} without the scan. */
export function parseFormSource(source: string): ReadForm {
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
      /*
       * The contract's own explanation of its own union, never
       * `issues[0].message` (PR #28 finding 6). `FormSchema` is a union, so that
       * message is *always* the union's own "Invalid input" — a fence declaring
       * a fourth field kind rendered as "This form could not be read — Invalid
       * input", which tells the reader nothing they did not already know.
       * `describeFormFailure` narrows to the branch that came closest and names
       * the place, so the same bytes read here as `fields.0.kind: Invalid
       * discriminator value. Expected 'choose one' | 'choose any' | 'write'` —
       * and as the *same* sentence the answer route's `404` carries, because
       * both sides ask the contract rather than each keeping a reader.
       */
      reason: describeFormFailure(parsed.error) ?? "the block is not a valid form",
    };
  }
  return { status: "ok", form: parsed.data };
}

/** The shape {@link mapFormAnswers} reads; `ThreadTurn` and `Turn` both satisfy it. */
export interface AnswerableTurn {
  readonly author: string;
  readonly ts: string;
  readonly body: string;
}

/**
 * What an answered form shows: every field the form asked with what was given
 * for it, plus the note about the ask as a whole (SPEC.md §10 — "each question
 * beside what was given for it").
 *
 * `answers` is the contract's `FormFieldRecord`, which is also the shape the
 * `form.respond` payload carries: a blank field is present with every value key
 * null, so "they declined" and "it was never asked" never look the same here
 * either.
 */
export type AnsweredForm = FormAnswerRecord;

/**
 * An answer this session actually submitted: the form's `ts` as
 * `POST …/turns/{ts}/form` addressed it, and the record that was sent.
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
  readonly answer: AnsweredForm;
}

/** Same questions, same values — the comparison the known pairing needs. */
function sameAnswers(left: readonly FormFieldRecord[], right: readonly FormFieldRecord[]): boolean {
  return (
    left.length === right.length &&
    left.every((record, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.question === record.question &&
        other.option === record.option &&
        other.text === record.text &&
        (other.options ?? []).join("\u0000") === (record.options ?? []).join("\u0000")
      );
    })
  );
}

/**
 * Which forms have already been answered, keyed by the timestamp of the turn
 * carrying the form — which is the form's identity (SPEC.md §6) — and carrying
 * the record of what was given, which is what §10's answered form renders.
 *
 * **The prose is the data, and the contract owns both ends of it** (orchestrator
 * decision 2026-08-07). The `form.respond` payload is reaped with its event, so
 * after a reload the answer turn's markdown is the only durable record of what
 * was answered — which is why nothing here reads that markdown by hand. The
 * server writes it with `formatFormAnswerBody`; this reads it with the same module's
 * `parseFormAnswerBody`, asked with the **form in
 * hand** — "is this body an answer to *this* form?". That is what turns the old
 * order rule over a single option string into pairing by content, and it is why
 * the label-slicing reader that used to live here is gone rather than extended:
 * `apps/ui` cannot import `apps/server`, so a second spelling of this reader is
 * a second definition of what was answered.
 *
 * Three rules, and the first is what PR #10's finding 12 is about:
 *
 * - **A known pairing wins.** `submitted` carries the `formTs` this session
 *   sent an answer to, so the form the user actually clicked is the form that
 *   goes inert — even when a second, still-open form asks literally the same
 *   questions. Nothing is re-derived from the prose for that answer.
 * - **Otherwise, earliest open form first.** Every unanswered form stays open:
 *   tracking a single "current" form let a second form silently evict the
 *   first, so the earlier one could never be marked answered at all. Forms are
 *   asked and answered in order, so an unattributed answer goes to the earliest
 *   still-open form it answers, preferring one this session has *not* already
 *   paired. That is a rule, not knowledge — after a reload the prose is all
 *   there is — but it is the ordering the conversation itself implies, and the
 *   ambiguity it has to resolve has narrowed to two open forms asking
 *   **literally identical questions** (CONTRACT-038's note on the pairing gap).
 * - **A turn that both answers a form and carries one counts as both** (UI-021,
 *   converging on the server's wave-3 audit FIX 10). It closes the earliest open
 *   form its body answers and *then* registers its own — never answering
 *   itself, because the lookup above runs before the registration below. Only a
 *   hand-edited file produces such a turn (the answer route writes the label and
 *   the record, nothing else), but `POST …/turns/{ts}/form` accepts an answer for
 *   its form all the same, so a renderer that returned early left a live,
 *   answerable form that no later answer could ever clear. §10's reasons must
 *   have an action that clears them (SERVER-022 finding 3).
 *
 * An answer no open form claims belongs to none of them and is left alone: it is
 * an ordinary turn that happens to start with the label.
 *
 * **A form this session answered is answered, turn or no turn.** `onAnswered`
 * fires only on a `201`, so the server has already written the answer turn and
 * enqueued the event — the only thing outstanding is this client's refetch.
 * Waiting for that turn to come back before the controls stop being a question
 * would leave a live submit on an already-answered form for as long as the round
 * trip takes, and §6 answers that submit with a `409`. So "there is no way to
 * submit a second answer" is structural rather than a race the user can win.
 */
export function mapFormAnswers(
  turns: readonly AnswerableTurn[],
  submitted: readonly SubmittedAnswer[] = [],
): ReadonlyMap<string, AnsweredForm> {
  const answers = new Map<string, AnsweredForm>();
  const known = new Map(submitted.map((entry) => [entry.formTs, entry.answer]));
  const open: { readonly ts: string; readonly form: Form }[] = [];

  for (const turn of turns) {
    if (isFormAnswerBody(turn.body)) {
      const matched = open.flatMap((entry) => {
        const record = parseFormAnswerBody(turn.body, entry.form);
        return record === undefined ? [] : [{ entry, record }];
      });
      const target =
        matched.find((candidate) => {
          const paired = known.get(candidate.entry.ts);
          return paired !== undefined && sameAnswers(paired.answers, candidate.record.answers);
        }) ??
        matched.find((candidate) => !known.has(candidate.entry.ts)) ??
        matched[0];
      if (target !== undefined) {
        answers.set(target.entry.ts, target.record);
        open.splice(open.indexOf(target.entry), 1);
      }
    }
    if (turn.author !== "agent") continue;
    const parsed = parseFormBlock(turn.body);
    if (parsed.status === "ok") open.push({ ts: turn.ts, form: parsed.form });
  }

  // The answer this session sent, for a form whose answer turn has not come back
  // yet. Scoped to forms this thread actually carries, so a stale pairing from
  // another thread invents nothing.
  for (const entry of submitted) {
    if (answers.has(entry.formTs)) continue;
    const still = open.find((form) => form.ts === entry.formTs);
    if (still !== undefined) answers.set(entry.formTs, entry.answer);
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
