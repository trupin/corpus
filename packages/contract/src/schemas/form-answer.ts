// The answer turn's prose, and its reader — **a pair, deliberately, and in the
// contract** (orchestrator decision 2026-08-07).
//
// The `form.respond` payload lives in `.corpus/`: runtime state, reaped with its
// event. But §11 requires an answered form to render "each question beside what
// was given for it" after a reload, and after a reload the *only* durable record
// of what was answered is the answer turn's markdown. **So the prose is the
// data**, and a format written on one side and re-read loosely on the other is a
// guaranteed drift — `apps/server` and `apps/ui` cannot import each other, so a
// second spelling of the reader is a second definition of what was answered.
// The server writes with {@link formatFormAnswerBody}; the UI reads with
// {@link parseFormAnswerBody}; neither owns the format. This is the reasoning
// that already put {@link FORM_ANSWER_LABEL} in the contract; the pair extends
// it rather than departing from it.
//
// **It is still prose, not a wire format.** No fence, no ids, no key/value
// markup — a heading per question and what was given under it, which is how a
// person would write the same thing down, and which reads in `git log` and in a
// plain-text reader exactly as §6 requires:
//
// ```markdown
// **Answered:**
//
// **Which quote should I file?**
//
// Lemonade — $1,840/yr
//
// **Which riders do you want?**
//
// - Water backup
// - Extended replacement
//
// **Anything I should know?**
//
// _(left blank)_
//
// **Note:**
//
// matches the quote we discussed
// ```
//
// **The reader takes the form.** Not to be lenient — to be *unambiguous*: an
// option may contain ` — `, a written answer may contain a line starting with
// `- `, and a question is the only string that can introduce a block. Reading
// with the fence in hand is what makes "which question is this?" a lookup
// instead of a guess, and it is the same posture {@link validateFormAnswer}
// already takes — the legal questions and values are whatever the agent wrote
// into the fence, so no static grammar can check them alone. It is also what
// pairs an answer with its form by **content**: a body that parses against a
// form is an answer to a form asking exactly those questions.
//
// **The short spelling is read too.** `**Answered:** Yes`, the whole format
// before this pair existed, is still on disk in every workspace answered before
// it. Against a one-field `choose one` form **that offers that option** it reads
// as that field's answer, with anything after it as the note — so nothing
// already committed stops rendering as the record it is. The membership test is
// load-bearing rather than decorative: it is the whole of the pairing for a
// short answer, and without it a repeated answer would retire a *different*
// open form that nobody answered (`docs/query.test.ts`, `th_repeat`).
//
// **Round-trip preconditions**, documented rather than enforced, because both
// come from the fence and neither is worth rejecting a form over: a question and
// an option are single-line and carry no surrounding whitespace, and a written
// answer carries none either (every writer of one trims it). Interior blank
// lines in a written answer survive intact.
//
// **What this module does not do, on purpose: it does not make the prose safe to
// append.** A written answer is arbitrary text landing in a *thread body*, where
// `## <author> · <ts>` is a turn delimiter and an unterminated fence masks every
// heading after it — so text that would fabricate a turn or swallow the next one
// has to be refused at the write path, which is the server's job and not the
// format's (`apps/server/src/threads/forms.ts`).

import {
  FORM_ANSWER_LABEL,
  type Form,
  type FormAnswerRequest,
  type FormField,
  type FormFieldRecord,
} from "./form.js";

/** How a field with nothing given is spelled — §6's "says explicitly when… left blank". */
export const FORM_ANSWER_BLANK = "_(left blank)_";

/**
 * The heading of the note block, spelled like the label it echoes.
 *
 * Nothing stops a form from asking a question spelled exactly this way, so the
 * reader resolves the collision rather than pretending it cannot happen: the
 * **field** claims the first such heading and the note claims the second, which
 * is the order the writer emits them in.
 */
export const FORM_ANSWER_NOTE_HEADING = "Note:";

/**
 * What the answer turn's prose says, as a value — the pair's shared shape.
 *
 * `answers` is the payload's shape ({@link FormFieldRecordSchema}) rather than
 * the request's: one entry per field **of the form**, in the form's order, a
 * blank one marked. That is what the prose has to say (§6 — "it names, for every
 * field the form asked, the question and what was given for it… and says
 * explicitly when an optional field was left blank"), so it is what the pair
 * carries both ways.
 */
export interface FormAnswerRecord {
  readonly answers: readonly FormFieldRecord[];
  readonly note: string | null;
}

/**
 * Every field of `form`, in the form's order, with what `answer` gave for it —
 * the request's "entry per field answered" turned into the payload's "entry per
 * field", which is the one place the two shapes meet.
 *
 * Call it on an answer {@link validateFormAnswer} has already passed: it does
 * not re-check membership, and a field with no entry becomes a blank record
 * whether or not the field was optional.
 */
export function formAnswerRecords(
  form: Form,
  answer: FormAnswerRequest,
): readonly FormFieldRecord[] {
  const entries = new Map(answer.answers.map((entry) => [entry.question, entry]));
  return form.fields.map((field) => {
    const entry = entries.get(field.question);
    return {
      question: field.question,
      kind: field.kind,
      option: field.kind === "choose one" ? (entry?.option ?? null) : null,
      options: field.kind === "choose any" ? (entry?.options ?? null) : null,
      text: field.kind === "write" ? (entry?.text ?? null) : null,
    };
  });
}

const heading = (text: string): string => `**${text}**`;

/** A `choose any` selection, one option per line, as an ordinary markdown list. */
const CHOSEN_OPTION_PREFIX = "- ";

/** The value of one field's block, or `undefined` for a blank one. */
function recordValue(record: FormFieldRecord): string | undefined {
  if (record.option !== null) return record.option;
  if (record.options !== null) {
    return record.options.map((option) => `${CHOSEN_OPTION_PREFIX}${option}`).join("\n");
  }
  return record.text ?? undefined;
}

/**
 * The answer turn's body: the label, then every field the form asked with what
 * was given for it, then the note. The server's write path is its only caller;
 * {@link parseFormAnswerBody} is its inverse.
 */
export function formatFormAnswerBody(answer: FormAnswerRecord): string {
  const blocks = answer.answers.map(
    (record) => `${heading(record.question)}\n\n${recordValue(record) ?? FORM_ANSWER_BLANK}`,
  );
  if (answer.note !== null && answer.note.trim() !== "") {
    blocks.push(`${heading(FORM_ANSWER_NOTE_HEADING)}\n\n${answer.note.trim()}`);
  }
  return [FORM_ANSWER_LABEL, ...blocks].join("\n\n");
}

/** Whether a turn body is an answer at all — the label, and nothing more. */
export function isFormAnswerBody(body: string): boolean {
  return (body.split("\n", 1)[0] ?? "").trim().startsWith(FORM_ANSWER_LABEL);
}

/** A heading line's text, or `undefined` when the line is ordinary content. */
function headingText(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("**") || !trimmed.endsWith("**") || trimmed.length <= 4) return undefined;
  return trimmed.slice(2, -2);
}

/** Drops blank lines from both ends, keeping the interior exactly as written. */
function trimBlankLines(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start += 1;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** One field's record from its block, or `undefined` when the block does not fit its kind. */
function readBlock(field: FormField, lines: readonly string[]): FormFieldRecord | undefined {
  const body = trimBlankLines(lines);
  const blank = {
    question: field.question,
    kind: field.kind,
    option: null,
    options: null,
    text: null,
  };
  if (body.length === 0) return undefined;
  if (body.length === 1 && body[0]?.trim() === FORM_ANSWER_BLANK) return blank;

  if (field.kind === "choose one") {
    const option = body.join("\n");
    return body.length === 1 && option.trim() !== "" ? { ...blank, option } : undefined;
  }
  if (field.kind === "choose any") {
    const options: string[] = [];
    for (const line of body) {
      if (!line.startsWith(CHOSEN_OPTION_PREFIX)) return undefined;
      const option = line.slice(CHOSEN_OPTION_PREFIX.length);
      if (option.trim() === "") return undefined;
      options.push(option);
    }
    return { ...blank, options };
  }
  const text = body.join("\n");
  return text.trim() === "" ? undefined : { ...blank, text };
}

/** The short spelling read against the only form shape it was ever written for. */
function readShortAnswer(
  option: string,
  rest: readonly string[],
  form: Form,
): FormAnswerRecord | undefined {
  const only = form.fields[0];
  if (form.fields.length !== 1 || only?.kind !== "choose one") return undefined;
  if (!only.options.includes(option)) return undefined;
  const note = trimBlankLines(rest).join("\n").trim();
  return {
    answers: [{ question: only.question, kind: "choose one", option, options: null, text: null }],
    note: note === "" ? null : note,
  };
}

/**
 * The record an answer turn's body holds, read against the form it answers, or
 * `undefined` when the body is not an answer to **this** form.
 *
 * `undefined` is the pairing answer as much as the failure one: a thread read
 * off disk asks every open form in turn whether an answer belongs to it, and a
 * body that does not name exactly this form's questions does not.
 */
export function parseFormAnswerBody(body: string, form: Form): FormAnswerRecord | undefined {
  if (!isFormAnswerBody(body)) return undefined;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const first = lines[0] ?? "";
  const inline = first.slice(first.indexOf(FORM_ANSWER_LABEL) + FORM_ANSWER_LABEL.length).trim();
  if (inline !== "") return readShortAnswer(inline, lines.slice(1), form);

  const questions = new Set(form.fields.map((field) => field.question));
  const blocks = new Map<string, string[]>();
  let note: string[] | undefined;
  let current: string[] | undefined;
  for (const line of lines.slice(1)) {
    const text = headingText(line);
    if (text !== undefined && questions.has(text) && !blocks.has(text)) {
      current = [];
      blocks.set(text, current);
    } else if (text === FORM_ANSWER_NOTE_HEADING && note === undefined) {
      note = [];
      current = note;
    } else {
      current?.push(line);
    }
  }

  const answers: FormFieldRecord[] = [];
  for (const field of form.fields) {
    const block = blocks.get(field.question);
    if (block === undefined) return undefined;
    const record = readBlock(field, block);
    if (record === undefined) return undefined;
    answers.push(record);
  }
  const text = note === undefined ? "" : trimBlankLines(note).join("\n").trim();
  return { answers, note: text === "" ? null : text };
}
