import type { Form, FormAnswerRequest, FormField, FormFieldAnswer } from "@corpus/contract";

/**
 * What has been filled into a form's controls, and what that adds up to
 * (SPEC.md §6, §11).
 *
 * Pure, and separate from `FormBlock` on purpose: the required gate, the named
 * missing question and — most of all — **the rule that a blank field sends no
 * entry** are behaviour, not rendering, and behaviour that a component test can
 * only reach through clicks is behaviour nobody tests all the branches of.
 *
 * **One draft shape for all three kinds**, rather than a union that every
 * setter would have to narrow. A field only ever reads the slot its kind names,
 * so the other two are inert: switching kinds is impossible (the fence decides
 * it), and the cost of the two unused slots is three characters of state
 * against a `useState` updater that would otherwise have to re-derive the kind
 * on every keystroke.
 */

export interface FieldDraft {
  /** `choose one` — the option picked, or null. */
  readonly option: string | null;
  /** `choose any` — the options ticked, in the form's own order. */
  readonly options: readonly string[];
  /** `write` — what was typed, **untrimmed**; blankness is decided below. */
  readonly text: string;
}

export type FormDraft = ReadonlyMap<string, FieldDraft>;

const EMPTY_FIELD: FieldDraft = { option: null, options: [], text: "" };

/** A form's controls before anything is filled in. */
export function emptyDraft(form: Form): FormDraft {
  return new Map(form.fields.map((field) => [field.question, EMPTY_FIELD]));
}

/** One field's slot, defaulted so a caller never branches on a missing key. */
export function fieldDraft(draft: FormDraft, question: string): FieldDraft {
  return draft.get(question) ?? EMPTY_FIELD;
}

/** The draft with one field replaced — the only way `FormBlock` mutates it. */
export function withField(draft: FormDraft, question: string, next: FieldDraft): FormDraft {
  const updated = new Map(draft);
  updated.set(question, next);
  return updated;
}

/**
 * `choose any` is a toggle, and the selection is kept in the **form's** order
 * rather than in click order: the answer is a set, and a record whose options
 * read in a different order than the question offered them invites the reader to
 * think the order meant something.
 */
export function toggleOption(
  field: FormField,
  current: readonly string[],
  option: string,
): readonly string[] {
  const offered = field.kind === "write" ? [] : field.options;
  const next = new Set(current);
  if (next.has(option)) next.delete(option);
  else next.add(option);
  return offered.filter((candidate) => next.has(candidate));
}

/**
 * The entry this field contributes, or `undefined` when nothing was given.
 *
 * **Absence is the single spelling of blank** (CONTRACT-038): no empty string,
 * no empty option list. The two would be a second way to say "nothing", and the
 * server reads them as values — an empty `text` fails `nonBlank` and an empty
 * `options` fails `min(1)`, so a UI that sent them would turn "I left it blank"
 * into a `400` on a field that was optional all along.
 */
export function fieldAnswer(field: FormField, draft: FieldDraft): FormFieldAnswer | undefined {
  if (field.kind === "choose one") {
    return draft.option === null ? undefined : { question: field.question, option: draft.option };
  }
  if (field.kind === "choose any") {
    return draft.options.length === 0
      ? undefined
      : { question: field.question, options: [...draft.options] };
  }
  const text = draft.text.trim();
  return text === "" ? undefined : { question: field.question, text };
}

/** True when this field has nothing in it — the answered/blank question, once. */
export function isBlank(field: FormField, draft: FieldDraft): boolean {
  return fieldAnswer(field, draft) === undefined;
}

/**
 * The required fields still empty, in the form's order — what §11 means by "the
 * form says which question is still missing rather than letting the attempt fail
 * silently". Empty means submit is available, which is exactly the gate.
 */
export function missingRequired(form: Form, draft: FormDraft): readonly FormField[] {
  return form.fields.filter(
    (field) => !field.optional && isBlank(field, fieldDraft(draft, field.question)),
  );
}

/**
 * The whole form's answer: one entry per field **answered**, plus the note.
 *
 * `answers` may come out empty — a form of only optional fields, submitted
 * blank, is a real answer (§6: "a form is unanswered until it is submitted"),
 * and the empty array is how that is said.
 */
export function draftRequest(form: Form, draft: FormDraft, note: string): FormAnswerRequest {
  const answers = form.fields.flatMap((field) => {
    const entry = fieldAnswer(field, fieldDraft(draft, field.question));
    return entry === undefined ? [] : [entry];
  });
  const trimmed = note.trim();
  return { answers, ...(trimmed === "" ? {} : { note: trimmed }) };
}
