// The answer turn's prose, and its reader — **a pair, deliberately, and in the
// contract** (orchestrator decision 2026-08-07).
//
// The `form.respond` payload lives in `.corpus/`: runtime state, reaped with its
// event. But §10 requires an answered form to render "each question beside what
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
// **The round trip is enforced, not assumed** (PR #28 finding 1).
// It used to be a documented precondition — "a question and an option are
// single-line" — that nothing checked, and a violation was *silent*: the form
// posted, the answer posted, and only the read-back failed, leaving the thread
// in Attention with no action that could ever clear it. Documenting an
// unenforced precondition is defensible only where its violation is visible, so
// each half now has an owner:
//
//   - **The form's half** is `./form.ts`'s grammar. A question and an option are
//     single-line, and no option may spell one of the delimiters below. Both are
//     checked by `FormSchema`, so a form that would be unanswerable does not
//     parse — and an unparseable form is inert everywhere at once (§10 renders
//     it as the broken block it is), rather than being an answerable-looking
//     question with no answer.
//   - **The person's half** is {@link unreadableAnswer}, which the write path
//     calls before it writes: a written answer or a note is arbitrary text, and
//     no grammar can stop it containing a line that reads as a delimiter, so the
//     round trip is *performed* on the exact bytes about to be written and the
//     answer is refused when it does not come back whole.
//
// Between them the invariant is total: **an accepted form is always answerable,
// and an accepted answer always reads back as itself.** Surrounding whitespace
// on a written answer and on a note is normalised (trimmed) rather than
// refused — it changes nothing a person meant — while interior blank lines
// survive intact.
//
// **What this module does not do, on purpose: it does not make the prose safe to
// append.** A written answer is arbitrary text landing in a *thread body*, where
// `## <author> · <ts>` is a turn delimiter and an unterminated fence masks every
// heading after it — so text that would fabricate a turn or swallow the next one
// has to be refused at the write path, which is the server's job and not the
// format's (`apps/server/src/threads/forms.ts`, `assertAppendableAnswer`, which
// is also where {@link unreadableAnswer} is asked).

import {
  answerHeadingText,
  FORM_ANSWER_BLANK,
  FORM_ANSWER_LABEL,
  FORM_ANSWER_NOTE_HEADING,
  type Form,
  type FormAnswerRequest,
  type FormField,
  type FormFieldRecord,
} from "./form.js";

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
 *
 * **A written answer is trimmed.** The prose is the durable record and it reads
 * a block back with its blank edge lines dropped, so text that arrived with
 * them would come back a different string than the payload says was given. One
 * of the two had to move, and trimming the value costs nothing a person meant
 * by a leading newline in a textarea — whereas refusing it would be a `400` for
 * whitespace. Interior blank lines are untouched.
 */
export function formAnswerRecords(
  form: Form,
  answer: FormAnswerRequest,
): readonly FormFieldRecord[] {
  const entries = new Map(answer.answers.map((entry) => [entry.question, entry]));
  return form.fields.map((field) => {
    const entry = entries.get(field.question);
    const text = field.kind === "write" ? entry?.text : undefined;
    return {
      question: field.question,
      kind: field.kind,
      option: field.kind === "choose one" ? (entry?.option ?? null) : null,
      options: field.kind === "choose any" ? (entry?.options ?? null) : null,
      text: text === undefined ? null : text.trim(),
    };
  });
}

/**
 * A request turned into the record both the prose and the event carry — the one
 * place the request's shape becomes the answer's.
 *
 * The server builds the turn body and the `form.respond` payload from the same
 * call, so the two cannot disagree about what was given, down to the note's
 * whitespace: the prose writes the note trimmed, so the record holds it trimmed.
 */
export function formAnswerRecord(form: Form, answer: FormAnswerRequest): FormAnswerRecord {
  const note = answer.note?.trim();
  return {
    answers: formAnswerRecords(form, answer),
    note: note === undefined || note === "" ? null : note,
  };
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

/**
 * A heading line's text, or `undefined` when the line is ordinary content.
 *
 * The reader's copy of the delimiter is `./form.ts`'s, so the grammar that has
 * to keep options off this line-space and the parser that splits on it can never
 * disagree about what a heading is.
 */
const headingText = answerHeadingText;

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

/** Two records say the same thing. Fixed keys, so a spelled-out comparison is the whole of it. */
function sameRecord(a: FormFieldRecord, b: FormFieldRecord): boolean {
  const sameOptions =
    a.options === null || b.options === null
      ? a.options === b.options
      : a.options.length === b.options.length &&
        a.options.every((option, index) => option === b.options?.[index]);
  return (
    a.question === b.question &&
    a.kind === b.kind &&
    a.option === b.option &&
    a.text === b.text &&
    sameOptions
  );
}

/** The delimiter a line of written text would be mistaken for, in reading order. */
function delimiterIn(value: string, claimable: ReadonlySet<string>): string | undefined {
  for (const line of value.split("\n")) {
    const text = headingText(line);
    if (text === FORM_ANSWER_NOTE_HEADING) return `\`${line.trim()}\`, which introduces the note`;
    if (text !== undefined && claimable.has(text)) {
      return `\`${line.trim()}\`, which introduces this form's answer to \`${text}\``;
    }
  }
  return value.trim() === FORM_ANSWER_BLANK
    ? `\`${FORM_ANSWER_BLANK}\`, which is how a field left blank is written`
    : undefined;
}

/**
 * Why the answer turn this record would write cannot be read back as this record,
 * or `undefined` when it round-trips exactly (PR #28 finding 2).
 *
 * **A person's free text can imitate the prose's delimiters, and no schema can
 * stop it.** A `write` answer containing a line that is exactly `**Note:**`, or
 * exactly the bold heading of a *later* question of this same form, is read as
 * the start of that block: the answer truncates at that line and the rest is
 * swallowed into the wrong one. The parse **succeeds**, so nothing downstream
 * flags it — the bytes on disk are what the person wrote, and every subsequent
 * read of them is wrong, showing them beside a question something they did not
 * write there. §10 promises "each question beside what was given for it".
 *
 * **So the round trip is performed rather than reasoned about.** The check is
 * the format's inverse applied to the format's output: format, parse, compare.
 * That makes it total by construction — it cannot fall behind a change to the
 * prose, and it catches collisions nobody has thought of yet — where a list of
 * banned spellings would have to be kept in step with the writer forever. The
 * message names the offending line when one can be pointed at, because a person
 * being refused needs to know *which* line to rewrite; the fallback sentence is
 * for a mismatch with no single line behind it.
 *
 * **Why refuse rather than escape.** Indenting or quoting the offending line
 * would record an answer the person did not give, which is the same reasoning
 * `assertAppendableAnswer` already applies to a fabricated turn heading. And
 * refusing here is safe in the way refusing a *form* would not be: a person can
 * always reword their own text, so no form becomes unanswerable — the form's
 * half of the invariant is `FormSchema`'s, and it is enforced there.
 */
export function unreadableAnswer(form: Form, answer: FormAnswerRecord): string | undefined {
  const readBack = parseFormAnswerBody(formatFormAnswerBody(answer), form);
  if (
    readBack !== undefined &&
    readBack.note === answer.note &&
    readBack.answers.length === answer.answers.length &&
    readBack.answers.every((record, index) => {
      const given = answer.answers[index];
      return given !== undefined && sameRecord(record, given);
    })
  ) {
    return undefined;
  }

  // Reading order: a question's block can only be hijacked by a heading naming a
  // question the reader has not claimed yet, which is the ones after it.
  const later = new Set(answer.answers.map((record) => record.question));
  for (const record of answer.answers) {
    later.delete(record.question);
    const delimiter = record.text === null ? undefined : delimiterIn(record.text, later);
    if (delimiter !== undefined) {
      return (
        `the answer to \`${record.question}\` contains the line ${delimiter} — the answer turn ` +
        "would split there and read back as something other than what was given; rewrite that line"
      );
    }
  }
  return (
    "this answer cannot be read back from the turn it would write; rewrite it so that no line of " +
    "it stands alone as one of this form's questions in bold, as `**Note:**`, or as " +
    `\`${FORM_ANSWER_BLANK}\``
  );
}
