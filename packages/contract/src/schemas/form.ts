import { z } from "@hono/zod-openapi";
import type { ValidationError, ValidationIssue } from "./error.js";
import { EventIdSchema, ThreadIdSchema } from "./id.js";
import { recipientField } from "./lane.js";
import { jobField } from "./provenance.js";
import { ThreadSummarySchema, TurnSchema } from "./thread.js";
import { IsoDateTimeSchema } from "./time.js";
import { warningsField } from "./warning.js";

/**
 * Forms in turns (SPEC.md §6). An agent turn may carry a fenced ```` ```form ````
 * block whose YAML is a prompt plus options; the UI renders it as live controls,
 * and submitting appends a structured answer turn and enqueues a `form.respond`
 * event.
 *
 * **The grammar, pinned here because §6 gives three words of it.** Three
 * consumers depend on the answer — the projection's `needs=form` detector, the
 * server's write path and the UI's controls — so the shape is written down once,
 * in the contract, rather than guessed three times:
 *
 * - **The fence** — settled by CONTRACT-014. A form fence is what CommonMark
 *   would render as a fenced code block whose info string is `form`, subject to
 *   three deliberate restrictions. Each restriction only ever *declines* a block
 *   CommonMark would accept — never the reverse — so a declined block degrades
 *   to an ordinary code block in every consumer at once, while nothing is ever
 *   claimed as a form that a CommonMark renderer would not draw as a
 *   `form`-labelled code block:
 *
 *   1. Fences are recognised at **column 0** only: no 1–3-space indent, no
 *      container blocks — a fence inside a blockquote or list item is an
 *      ordinary code block. Turn bodies are written flush left; modelling
 *      containers would mean shipping a markdown parser for input the server
 *      never writes.
 *   2. Only **backtick** fences open a form. A tilde fence (`~~~form`) opens an
 *      ordinary code block, never a form — SPEC.md §6 spells the fence with
 *      backticks.
 *   3. The **closing fence is required**. CommonMark closes an unterminated
 *      fence at end of input; here an unterminated `form` fence is not a form —
 *      the server always closes the fences it writes, so an unterminated one is
 *      a mangled file to surface (as a visibly broken code block), not a
 *      question to answer. The same posture `readForm` takes on unparseable
 *      YAML, on the server side.
 *
 *   Within those bounds CommonMark's rules hold exactly: the opening fence is
 *   three or more backticks whose info string (trimmed, and containing no
 *   backtick) is exactly `form` — `` ```formula `` and `` ```form-builder ``
 *   open ordinary code blocks, so a detector built on {@link findFormFence}
 *   cannot be fooled by a prefix; the closing fence is a line of at least as
 *   many backticks as the opener with nothing but trailing whitespace — a
 *   mid-line `` ``` `` never closes a form; and fences do not nest, so a
 *   `` ```form `` line inside any open fenced block — an outer
 *   ```` ````markdown ```` example block quoting one, say — is content, not a
 *   form. The first form fence in the body wins.
 * - **The fields (CONTRACT-038).** A form is a list of `fields`, each carrying
 *   its own non-empty `question`, **distinct within the form** — an answer names
 *   a field by its question, which is the same rule `options` already follows one
 *   level down, for the same reason. A field is one of exactly **three kinds**
 *   ({@link FORM_FIELD_KINDS}) and there are no others: `choose one` and
 *   `choose any` carry `options` (at least one, each non-empty, all distinct),
 *   `write` carries none. A field is **required unless** it carries
 *   `optional: true`.
 * - **A form must stay answerable (PR #28 finding 1).** A question and an option are
 *   each a **single line**, and no option may be spelled like one of the answer
 *   prose's delimiters ({@link nonBlankLine}, {@link collidingOption}). Neither
 *   is a style rule: the answer turn is the durable record of what was answered
 *   and is read back a line at a time, so a form breaking either could be
 *   accepted, answered, written — and then never read, leaving the thread in
 *   Attention with no answer able to clear it. The rule lives in the grammar
 *   rather than at the answer route precisely so that such a form is *inert*
 *   wherever it appears rather than answerable-looking, whichever door its bytes
 *   came through.
 * - **The short spelling stays.** A top-level `prompt` plus `options` — the only
 *   grammar §6 had before the 2026-08-05 rider — **is** a form with one required
 *   choose-one field, and {@link FormSchema} normalises it into the field list at
 *   the parse boundary. Exactly one shape exists downstream, so no consumer ever
 *   asks "is this an old form?", and nothing already committed to disk is
 *   rewritten or stops parsing.
 * - **Cardinality is the field's, not the form's.** `choose one` takes exactly
 *   one option, verbatim; `choose any` takes none, one or several, each verbatim;
 *   `write` takes free text. Options must be distinct precisely because an answer
 *   names one by its text.
 * - **The note.** A free-text note sits beside the answer *as a whole*, not
 *   inside any field — §6's "one optional free-text note about the ask as a
 *   whole". It is deliberately not re-modelled as an optional `write` field: it
 *   means something different, and collapsing the two would change the meaning of
 *   every answer already recorded.
 * - **Identity.** A form is identified by the timestamp of the turn carrying it,
 *   which is already that turn's identity (SPEC.md §6). A turn therefore carries
 *   **at most one form** — several questions are several *fields of one form* —
 *   and the answer route addresses the form through its turn's path rather than
 *   through an id invented for it: no second identifier exists to drift from the
 *   first. **Fields have no ids either**, for the same reason and at the same
 *   cost: a long question travels in the form, in the answer request and in the
 *   event payload, and that repetition is the point — it is what lets the answer
 *   turn read on its own (§6) and what pairs an answer with its form by content
 *   rather than by order.
 * - **Answered once, as a whole.** There is no partial save and no per-field
 *   submit: a form is unanswered until it is submitted, and submitting records
 *   every field's answer in one act. Answering an already-answered form is a
 *   `409` on the answer route — changing your mind is an ordinary reply, not a
 *   second answer to the same question (§6, §10).
 * - **A form that cannot be read is never half-read.** Unparseable YAML, a
 *   fourth kind however spelled, an unknown key, a `write` field carrying
 *   `options`: all of them fail {@link FormSchema} whole, and a reader that
 *   cannot parse a fence renders it as the visibly broken code block it is,
 *   never as a subset of working controls (§6, §10). The two postures are not
 *   alternatives but a pair, and the second is doing real work rather than
 *   standing by: the write-time refusal covers the **agent's** turn append,
 *   which is where §6 says forms are asked, and covers nothing else — not a
 *   thread's first turn (`POST /api/threads`), not another actor's turn, not a
 *   hand-edited file, not an older server. So the rendering rule is what a
 *   consumer meeting an unreadable fence actually relies on, and the grammar is
 *   written to make that safe: a fence that does not parse is a form to nobody,
 *   in every consumer at once. Every object in this grammar is therefore strict: a misspelled key
 *   fails loudly at the boundary instead of silently meaning something else —
 *   `optionnal: true` must not quietly leave a field required.
 *
 * The grammar is a line scanner rather than a regex because two of its rules —
 * outer fences shadow inner ones, and a closer must be a whole line — are about
 * *lines in sequence*, which is exactly what one regex over the body cannot
 * see: the pre-CONTRACT-014 regex matched a fence quoted inside an outer
 * example block, and accepted a mid-line closer.
 */

/** The fence info string, matched whole after trimming. */
export const FORM_FENCE_INFO_STRING = "form";

/** The first form fence of a turn body: where it sits, and the YAML it carries. */
export interface FormFenceMatch {
  /** Offset of the opening fence line's first character. */
  readonly start: number;
  /** Offset just past the closing fence line, its trailing newline excluded. */
  readonly end: number;
  /** The YAML between the fences, line terminators normalised to `\n`. */
  readonly source: string;
}

/** A column-0 fence line: three or more of one fence char, then a possible info string. */
const FENCE_LINE = /^(`{3,}|~{3,})(.*)$/;

interface FenceLine {
  readonly char: "`" | "~";
  readonly length: number;
  readonly info: string;
}

function readFenceLine(line: string): FenceLine | undefined {
  const marker = FENCE_LINE.exec(line)?.[1];
  if (marker === undefined) return undefined;
  const char = marker.startsWith("`") ? "`" : "~";
  const info = line.slice(marker.length).trim();
  // CommonMark: a backtick fence's info string may not contain a backtick
  // (ambiguous with an inline code span). Such a line opens nothing.
  if (char === "`" && info.includes("`")) return undefined;
  return { char, length: marker.length, info };
}

/** A closing fence: the opener's char, at least its length, and no info string. */
function closesFence(line: string, open: FenceLine): boolean {
  const fence = readFenceLine(line);
  return (
    fence !== undefined &&
    fence.char === open.char &&
    fence.length >= open.length &&
    fence.info === ""
  );
}

/**
 * The first form fence in a turn body, or `undefined` when it carries none —
 * the one implementation of the fence grammar documented above. The offsets let
 * a renderer split the body around the fence; {@link extractFormSource} and
 * {@link containsFormFence} are the narrower questions asked of the same scan.
 */
export function findFormFence(body: string): FormFenceMatch | undefined {
  let open: (FenceLine & { readonly start: number; readonly content: string[] }) | null = null;
  let offset = 0;

  // Visits every line start; `<=` so a final line without a trailing newline is
  // still read, and a trailing "\n" yields one empty last line, which neither
  // opens nor closes anything.
  while (offset <= body.length) {
    const nextBreak = body.indexOf("\n", offset);
    const lineEnd = nextBreak === -1 ? body.length : nextBreak;
    const raw = body.slice(offset, lineEnd);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (open === null) {
      const fence = readFenceLine(line);
      // Any fence opens a block — restriction 2 decides what can be a *form*,
      // not what shadows one: a ~~~ or ```js block hides fences it quotes.
      if (fence !== undefined) open = { ...fence, start: offset, content: [] };
    } else if (closesFence(line, open)) {
      if (open.char === "`" && open.info === FORM_FENCE_INFO_STRING) {
        return { start: open.start, end: lineEnd, source: open.content.join("\n") };
      }
      open = null;
    } else {
      open.content.push(line);
    }

    if (nextBreak === -1) break;
    offset = nextBreak + 1;
  }

  // Restriction 3: an unterminated fence — form or not — matches nothing.
  return undefined;
}

/**
 * The YAML source of the first form fence in a turn body, or `undefined` when it
 * carries none. The contract does not parse YAML — it has no YAML dependency and
 * no business owning one — so this hands the caller the block to parse and
 * {@link FormSchema} to validate the result against.
 */
export function extractFormSource(body: string): string | undefined {
  return findFormFence(body)?.source;
}

/** Whether a turn body carries a form (SPEC.md §6's `needs=form` condition). */
export function containsFormFence(body: string): boolean {
  return findFormFence(body) !== undefined;
}

/**
 * The lead-in of an answer turn's body: the marker the server writes when a form
 * is answered, and the marker a reader uses to tell an answered form from an
 * open one.
 *
 * An answer is written as a sentence rather than as a second machine-readable
 * fence — a thread is markdown a person owns, not a serialization format, and
 * the answer has to read as prose in `git log` and in a plain-text reader. The
 * *structure* travels in the `form.respond` event payload
 * ({@link FormRespondPayloadSchema}), which is what the agent consumes.
 *
 * **What follows the label is now every question.** §6 requires the answer turn
 * to name, for **every** field the form asked, the question and what was given
 * for it — the chosen option, the chosen options, or the text written — and to
 * say explicitly when an optional field was left blank, so a reader months later
 * reconstructs the exchange from the answer turn alone, with the fence out of
 * view. The label stays exactly as it was, so every `**Answered:** …` turn
 * already committed still reads as an answer; what changed is the body beneath
 * it. **The exact line format is the server's** (SERVER-068), not this module's:
 * the contract owns the marker both sides match on and the structure the agent
 * consumes, and deliberately does not turn the prose into a wire format.
 *
 * It lives in the contract for the same reason the rest of the grammar does:
 * two sides depend on it and neither may import the other. The server's form
 * route composes the body with it; the UI matches turn bodies against it to know
 * whether the form above is already answered — and `apps/ui` cannot import
 * `apps/server`. One spelling, in the module that owns the grammar (CONTRACT-013).
 *
 * **The pairing gap, mostly closed (CONTRACT-014, narrowed by CONTRACT-038).**
 * The answer still does not name the *form* it answers — §6 keeps the prose
 * plain and gives a form no id to put there — so a thread read back off disk
 * pairs answers to forms by matching what the answer names against the open
 * forms above it. That used to be an order rule over a single option string;
 * now the answer names **its questions**, so the pairing is by content and the
 * residual failure narrows to two open forms in one thread asking a *literally
 * identical* question. Multi-field forms also make multiple open forms rarer,
 * since the reason to open a second one — a second question — is now a field.
 * The remainder is narrow, visible and self-limiting, and §6 accepts it
 * (SHARED-021 Q7). Revisit via a SPEC.md §6 revision, not a silent format
 * change, if multi-form threads become a real pattern.
 */
export const FORM_ANSWER_LABEL = "**Answered:**";

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
 * A bold-heading line's text, or `undefined` when the line is ordinary content —
 * the answer prose's one block delimiter, read.
 *
 * It lives here rather than in `./form-answer.ts` (which owns the prose) because
 * the **grammar** has to ask the same question the reader asks: an option the
 * answer would write on a line of its own must not read back as a heading, or
 * the form it belongs to could be accepted and then never answerable. One
 * spelling of "is this line a delimiter?", used by the writer's inverse and by
 * the schema that must keep it applicable.
 */
export function answerHeadingText(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("**") || !trimmed.endsWith("**") || trimmed.length <= 4) return undefined;
  return trimmed.slice(2, -2);
}

/**
 * The three field kinds, and there are no others (SPEC.md §6). Spelled exactly
 * as §6 spells them, deliberately: the agent writes this YAML by hand, in a
 * turn, with no schema in front of it and §6 as its only reference, so the
 * spelling that is hardest to get subtly wrong is the one it can copy from the
 * text it is already reading. A snake_case or hyphenated variant would be a
 * second name for §6's words and a translation step to get wrong; the space is
 * a plain YAML scalar and needs no quoting.
 *
 * A fourth kind, however spelled, fails to parse — and a form that fails to
 * parse renders raw rather than partially (§10).
 */
export const FORM_FIELD_KINDS = ["choose one", "choose any", "write"] as const;

export const FormFieldKindSchema = z.enum(FORM_FIELD_KINDS);

/**
 * Non-empty **after trimming**. `"   "` is blank, and blank is not a question,
 * an option or an answer: without this, `""` and `"  "` would be two distinct
 * questions, which is exactly the ambiguity distinctness exists to prevent.
 *
 * The value is kept **as written** rather than trimmed, because the answer names
 * a question (and an option) verbatim: normalising here would create a second
 * spelling — the stored one — for the string the YAML shows.
 */
const nonBlank = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "must not be blank" });

/**
 * Non-blank **and single-line** — what a question and an option must be
 * (PR #28 finding 1).
 *
 * Not a style rule: the answer turn's prose writes a question as a heading line
 * and a chosen option as a line of its own, and reads both back a line at a
 * time (`./form-answer.ts`). A newline in either makes the answer unreadable
 * *after* it has been written — the turn is on disk, `parseFormAnswerBody`
 * cannot pair it with its form, so the form counts as unanswered forever, no
 * second answer can clear it (§10 requires every attention reason to have an
 * action that clears it), and the only recovery is hand-editing the file.
 *
 * Enforcing it **here**, in the grammar, rather than at the answer route, is
 * what makes the failure inert instead of silent: a form carrying a newline in
 * a question or an option does not parse, so it is refused at write time on the
 * agent's turn append, and a copy that arrived some other way (a hand-edited
 * file, an older server) is not a form to any consumer — it renders as the
 * visibly broken code block §10 asks for, and never advertises an answer nobody
 * can give. Refusing at answer time instead would have accepted the form and
 * then had nothing to offer the person holding it.
 */
const nonBlankLine = nonBlank.refine((value) => !/[\r\n]/.test(value), {
  message: "must be a single line: the answer turn writes it on one line and reads it back",
});

/**
 * Distinctness is compared on the string **as written** — no case folding, no
 * Unicode normalisation. Two questions differing only by normalisation form are
 * two questions here, because an answer matches verbatim: folding them together
 * would accept an answer naming a string the form does not contain, and would
 * make the payload's `question` differ from the fence's.
 */
const areDistinct = (values: readonly string[]) => new Set(values).size === values.length;

/** A choose-one or choose-any field's offered answers. */
const OfferedOptionsSchema = z
  .array(nonBlankLine)
  .min(1)
  .refine(areDistinct, {
    message: "Form options must be distinct: an answer names an option by its text.",
  })
  .describe("The offered answers, each non-empty and all distinct.");

/**
 * `optional` defaults to **false**: a field is required unless it is explicitly
 * marked optional (§6). The default is applied on parse rather than left
 * implicit so exactly one shape reaches consumers — `optional` is a boolean on
 * every field, never `undefined` — which is what `./index.ts`'s
 * "optional-in, defaulted-out" rule reserves `.default()` for. This is a
 * parse-side schema (a fence's YAML), never a request body.
 */
const optionalField = z
  .boolean()
  .default(false)
  .describe("True when the person may leave this field blank. Absent means required.");

const questionField = nonBlankLine.describe(
  "The question, which is also the field's identity: distinct within the form, single-line, and " +
    "named verbatim by the answer and by the event payload. Fields have no ids (SPEC.md §6).",
);

const ChooseOneFieldSchema = z.strictObject({
  question: questionField,
  kind: z.literal("choose one"),
  options: OfferedOptionsSchema,
  optional: optionalField,
});

const ChooseAnyFieldSchema = z.strictObject({
  question: questionField,
  kind: z.literal("choose any"),
  options: OfferedOptionsSchema,
  optional: optionalField,
});

const WriteFieldSchema = z.strictObject({
  question: questionField,
  kind: z.literal("write"),
  optional: optionalField,
});

/**
 * One field. A discriminated union on `kind` rather than one object with
 * conditionally-present keys, so the two malformed shapes the rider names are
 * structural rejections instead of lenient coercions: a `write` field carrying
 * `options` fails (the strict object has no such key), and a `choose one`
 * carrying none fails (the key is required).
 */
const FormFieldSchema = z.discriminatedUnion("kind", [
  ChooseOneFieldSchema,
  ChooseAnyFieldSchema,
  WriteFieldSchema,
]);

/** The canonical form: the long spelling, which is the only shape downstream. */
const FieldsFormSchema = z.strictObject({
  fields: z
    .array(FormFieldSchema)
    .min(1)
    .refine((fields) => areDistinct(fields.map((field) => field.question)), {
      message: "Form questions must be distinct: an answer names a field by its question.",
    })
    .describe("The questions, in the order they are asked."),
});

export type FormField = z.infer<typeof FormFieldSchema>;
export type Form = z.infer<typeof FieldsFormSchema>;

/**
 * The short spelling, §6's "single-question form stays spelled the short way".
 *
 * It **normalises into the field list here**, at the parse boundary, rather than
 * surviving as a union member: a union that reached `Form` would put "is this an
 * old form?" into the server, the UI and every test, where collapsing it puts
 * that question in one place. Which is also what makes "a bare `prompt` plus
 * `options` is a form with one required choose-one field" testable as a
 * *behaviour* rather than as a tolerated input — the two spellings parse to
 * values that are `toEqual` each other.
 */
const ShorthandFormSchema = z
  .strictObject({
    prompt: nonBlankLine.describe("The question put to the user, on one line."),
    options: OfferedOptionsSchema,
  })
  .transform((shorthand): Form => ({
    fields: [
      {
        question: shorthand.prompt,
        kind: "choose one",
        options: shorthand.options,
        optional: false,
      },
    ],
  }));

/**
 * An option the answer turn could not write down and read back, with the reason,
 * or `undefined` when every option of every field survives the round trip
 * (PR #28 finding 1).
 *
 * A chosen `choose one` option is written on a line of its own, so it is the one
 * value in a form that has to share a line-space with the prose's two delimiters
 * — a bold heading naming one of *this form's* questions or the note, and the
 * blank marker. An option that imitates either is read back as a delimiter or as
 * "left blank" rather than as itself, which would leave the form accepted and
 * that answer unreadable: exactly the stuck state {@link nonBlankLine} exists to
 * prevent, so it is refused in the same place and for the same reason.
 *
 * The test is deliberately **narrow**. `**Yes**` is a perfectly good option — a
 * bold line only delimits when its text names a question of this form or the
 * note heading — so an agent is refused only where the collision is real. A
 * `choose any` option rides a `- ` prefix and can never be mistaken for either,
 * but the rule is stated over all options anyway: an option's spelling should
 * not depend on which kind of field happens to hold it, and the person reading
 * the form cannot tell.
 */
function collidingOption(
  form: Form,
): { readonly option: string; readonly with: string } | undefined {
  const questions = new Set(form.fields.map((field) => field.question));
  for (const field of form.fields) {
    if (field.kind === "write") continue;
    for (const option of field.options) {
      const heading = answerHeadingText(option);
      if (heading !== undefined && questions.has(heading)) {
        return { option, with: `the answer's heading for \`${heading}\`` };
      }
      if (heading === FORM_ANSWER_NOTE_HEADING) {
        return { option, with: "the answer's note heading" };
      }
      if (option.trim() === FORM_ANSWER_BLANK) {
        return { option, with: "the marker for a field left blank" };
      }
    }
  }
  return undefined;
}

/**
 * The parsed contents of a form fence. Deliberately **not** a registered OpenAPI
 * component: no route returns a form — turn bodies travel as markdown — and a
 * component with no producer would be contract surface nobody can reach. The
 * grammar it defines is published in the answer route's description instead.
 *
 * Both spellings parse; both yield {@link Form}. The last check runs on the
 * union rather than inside either branch, so the short spelling is held to the
 * same rule as the long one by construction rather than by a second copy of it.
 */
export const FormSchema = z
  .union([FieldsFormSchema, ShorthandFormSchema])
  .superRefine((form, ctx) => {
    const collision = collidingOption(form);
    if (collision === undefined) return;
    ctx.addIssue({
      code: "custom",
      path: ["fields"],
      message:
        `\`${collision.option}\` cannot be an option: the answer turn writes a chosen option on a ` +
        `line of its own, where that spelling reads as ${collision.with} instead. Reword it.`,
    });
  })
  .describe("A form fence's YAML: the questions the agent is asking (SPEC.md §6).");

/**
 * As much of Zod's issue tree as {@link describeFormFailure} reads.
 *
 * Structural rather than Zod's own `$ZodIssue`, so the one exported signature
 * that mentions it does not drag Zod's internal namespace into the contract's
 * public types — and so a Zod upgrade that renames an internal type is not a
 * breaking change for both consumers at once.
 */
export interface FormIssue {
  readonly code: string;
  /** Absolute from the parsed value's root, at **every** depth of the tree. */
  readonly path?: readonly PropertyKey[];
  readonly message: string;
  /** An `invalid_union`'s issues, one list per branch; absent on other codes. */
  readonly errors?: readonly (readonly FormIssue[])[];
}

/** What `FormSchema.safeParse` hands back on failure, as much of it as is read. */
export interface FormParseError {
  readonly issues: readonly FormIssue[];
}

/**
 * The issue that actually says something.
 *
 * A union's failure is a wrapper carrying one list of failures per branch, and
 * the branch with the **fewest** complaints is the spelling its author came
 * closest to writing — a `fields:` form with one bad `kind` complains once
 * against the long spelling and about everything against the short one. Paths
 * are absolute at every depth, so the deepest issue's path is the whole
 * location and the wrappers' are prefixes of it; printing more than one would
 * repeat it.
 */
function narrowIssue(issue: FormIssue): FormIssue {
  const branches = issue.code === "invalid_union" ? (issue.errors ?? []) : [];
  const closest = branches
    .filter((branch) => branch.length > 0)
    .reduce<readonly FormIssue[] | undefined>(
      (best, branch) => (best === undefined || branch.length < best.length ? branch : best),
      undefined,
    );
  const chosen = closest?.[0];
  return chosen === undefined ? issue : narrowIssue(chosen);
}

/**
 * Why a value failed {@link FormSchema}, as one sentence naming **what** is
 * wrong and **where**.
 *
 * `FormSchema` is a union of the long and the short spelling, so Zod reports
 * essentially every malformed form as an `invalid_union` whose own message is
 * the useless `"Invalid input"`; the sentence worth showing is one level in.
 * Narrowing to the closest branch is what turns `"Invalid input"` into
 * `fields.0.kind: Invalid discriminator value. Expected 'choose one' | 'choose
 * any' | 'write'`, which is the difference between an agent that can fix its
 * fence and one that retries the same bytes.
 *
 * **It lives here, beside the union it explains, because both readers of that
 * union need it and neither can import the other.** `apps/server`'s `readForm`
 * reports it as the answer route's `404` detail and the write path's `400`;
 * `apps/ui`'s `parseFormBlock` renders it beneath the raw block, so a person
 * looking at a broken form in the board can tell what is wrong with it without
 * opening the file. Those two are supposed to say the same thing about the same
 * bytes, and a second spelling of the explanation is a second thing to keep true
 * (PR #28 finding 6).
 *
 * `null` only for an error carrying no issues at all — which `safeParse` does
 * not produce. Callers state their own fallback rather than inheriting a
 * sentence invented here, because the two surfaces word it differently.
 */
export function describeFormFailure(error: FormParseError): string | null {
  const first = error.issues[0];
  if (first === undefined) return null;
  const deepest = narrowIssue(first);
  const where = (deepest.path ?? []).map(String).join(".");
  return where === "" ? deepest.message : `${where}: ${deepest.message}`;
}

/** The three keys an answer entry may carry, one per field kind. */
const ANSWER_VALUE_KEYS = ["option", "options", "text"] as const;

type AnswerValueKey = (typeof ANSWER_VALUE_KEYS)[number];

/** Which key carries the answer to a field of each kind. */
const ANSWER_VALUE_KEY_BY_KIND: Readonly<Record<FormFieldKind, AnswerValueKey>> = {
  "choose one": "option",
  "choose any": "options",
  write: "text",
};

/**
 * What was given for one field.
 *
 * **A field with nothing given has no entry.** Absence is the one spelling of
 * "nothing was given" — there is no empty-selection entry and no blank text
 * entry — so `answers` is a list of answers rather than a list of fields, and
 * whether an omission is legal is a question about the *form* (is the field
 * optional?), answered by {@link validateFormAnswer} with the fence in hand.
 * The corresponding entry in the event payload is the mirror image: there, every
 * field is present and a blank one is marked ({@link FormFieldRecordSchema}).
 */
export const FormFieldAnswerSchema = z
  .strictObject({
    question: nonBlank.describe(
      "The field's question, verbatim from the form. A question the form does not ask is a `400`.",
    ),
    option: nonBlank
      .optional()
      .describe("`choose one`: the chosen option, verbatim from that field's `options`."),
    options: z
      .array(nonBlank)
      .min(1)
      .optional()
      .describe(
        "`choose any`: the chosen options, each verbatim from that field's `options` and each " +
          "named at most once. Selecting nothing is spelled by omitting the entry, not by an " +
          "empty list.",
      ),
    text: nonBlank.optional().describe("`write`: the text written."),
  })
  .refine((entry) => ANSWER_VALUE_KEYS.filter((key) => entry[key] !== undefined).length === 1, {
    message:
      "An answer entry carries exactly one of `option` (choose one), `options` (choose any) or " +
      "`text` (write); a field left blank is omitted from `answers` entirely.",
  })
  .openapi("FormFieldAnswer");

/**
 * The answer submitted for a form: one entry per field the person answered,
 * plus the optional note about the ask as a whole.
 *
 * `answers` is required but may be **empty** — a form whose fields are all
 * optional is still unanswered until it is submitted, so an empty submit is a
 * legal answer and has to be expressible. Making the key itself optional would
 * give "I answered nothing" two spellings.
 */
export const FormAnswerRequestSchema = z
  .strictObject({
    job: jobField,
    recipient: recipientField,
    answers: z
      .array(FormFieldAnswerSchema)
      .describe(
        "One entry per field answered, in any order — entries are matched to fields by question, " +
          "not by position. A field left blank has no entry, which is a `400` unless that field is " +
          "optional. Submitting is all-or-nothing: there is no partial save and no per-field " +
          "submit (SPEC.md §6).",
      ),
    note: nonBlank
      .optional()
      .describe(
        "Free-text note about the ask as a whole, recorded beside the answers (SPEC.md §6). " +
          "Optional, and never a field's answer.",
      ),
  })
  .openapi("FormAnswerRequest");

/**
 * The answer's own mutation response. Same three parts every turn append reports
 * — the appended turn, the thread it changed and the event it enqueued — plus
 * §11's warnings, because appending a turn writes a workspace file and a rejected
 * auto-commit has to surface here exactly as it does on every other mutation.
 */
export const FormAnswerResponseSchema = z
  .object({
    thread: ThreadSummarySchema,
    turn: TurnSchema.describe(
      "The appended answer turn: prose naming every field the form asked and what was given for " +
        "it, blanks included and marked as blank (SPEC.md §6), plus any note.",
    ),
    eventId: EventIdSchema.nullable().describe(
      "The enqueued `form.respond` event, which re-triggers the agent like any engaged-thread " +
        "reply (SPEC.md §6). Null when the answer does not re-trigger it — which, since only the " +
        "person answers a form, is exactly the thread the agent is not engaged in. A **resolved** " +
        "thread does not stay silent: a person's answer reopens it and then re-triggers on §8's " +
        "ordinary terms (SHARED-019 Amendment 1, corrected by SERVER-062).",
    ),
    warnings: warningsField,
  })
  .openapi("FormAnswerResponse");

/**
 * What was recorded for one field, in the `form.respond` payload.
 *
 * **This is not the request entry, and merging the two would lose the
 * distinction §7 exists to make.** A request may legitimately omit an optional
 * field; the payload may not. Here every field of the form is present, in the
 * form's order, and a field left blank is present with all three value keys
 * null — so "they declined" and "it was never asked" are never the same bytes,
 * and the agent never has to guess whether a question went unanswered or
 * unasked. `kind` travels with it so the entry reads on its own: it is what
 * tells a reader whether `options: null` means "chose none of several" or
 * "wrote nothing".
 *
 * The two keys that do not belong to the field's kind are always null, which is
 * checked rather than assumed — the payload is the agent's record, and a record
 * that could say two things at once would be worse than none.
 */
export const FormFieldRecordSchema = z
  .object({
    question: nonBlank.describe("The field's question, verbatim from the form."),
    kind: FormFieldKindSchema.describe("Which of §6's three kinds the field is."),
    option: nonBlank.nullable().describe("`choose one`: the chosen option, or null when blank."),
    options: z
      .array(nonBlank)
      .min(1)
      .nullable()
      .describe("`choose any`: the chosen options, or null when nothing was chosen."),
    text: nonBlank.nullable().describe("`write`: the text written, or null when blank."),
  })
  .refine(
    (record) =>
      ANSWER_VALUE_KEYS.every(
        (key) => key === ANSWER_VALUE_KEY_BY_KIND[record.kind] || record[key] === null,
      ),
    {
      message: "A field's record carries a value only under the key its `kind` names.",
    },
  );

/**
 * The payload of a `form.respond` queue event.
 *
 * **Why this is a schema beside `QueueEventSchema` rather than a member of a
 * discriminated union on it.** SPEC.md §7 keeps the event `type` an open string
 * because plugins define their own event types and own their own payload shapes;
 * turning `payload` into a union keyed on `type` would close that set at the
 * three core types and make every plugin event unrepresentable on the wire. The
 * core payload is therefore *declared and parseable* without the envelope
 * becoming exhaustive: a consumer that handles `form.respond` narrows with
 * {@link parseFormRespondPayload}, and one that does not is unaffected.
 *
 * It names the thread and the answered form unambiguously: `formTs` is the
 * timestamp of the turn carrying the form, which is that turn's identity.
 *
 * **The payload widened with CONTRACT-038 and nothing had to be migrated.**
 * Queue events are runtime state under `.corpus/`, not corpus content, so an
 * event written by an older server is skipped by `parseFormRespondPayload`
 * rather than read — which is exactly what makes widening this cheap where
 * widening the *turn format* would not have been.
 */
export const FormRespondPayloadSchema = z.object({
  threadId: ThreadIdSchema,
  formTs: IsoDateTimeSchema.describe("Timestamp of the agent turn whose form was answered."),
  answers: z
    .array(FormFieldRecordSchema)
    .min(1)
    .describe(
      "One entry per field **of the answered form**, in the form's order — not per field answered. " +
        "A form has at least one field, so this is never empty (SPEC.md §7).",
    ),
  note: z.string().nullable().describe("The free-text note, or null when none was given."),
});

/**
 * The event type whose payload {@link FormRespondPayloadSchema} describes. A
 * member of `CORE_QUEUE_EVENT_TYPES`, spelled here so this module does not depend
 * on the queue module it is documented beside.
 */
export const FORM_RESPOND_EVENT_TYPE = "form.respond";

/**
 * Narrows a queue event to a form answer, or returns `undefined` when it is
 * neither — a different type, or a `form.respond` whose payload does not match.
 * A malformed payload is not an exception here: events come off disk and a
 * consumer that has to survive one written by an older server should skip it, not
 * crash.
 */
export function parseFormRespondPayload(event: {
  readonly type: string;
  readonly payload: unknown;
}): FormRespondPayload | undefined {
  if (event.type !== FORM_RESPOND_EVENT_TYPE) return undefined;
  const parsed = FormRespondPayloadSchema.safeParse(event.payload);
  return parsed.success ? parsed.data : undefined;
}

/** Where the answers live in the request, in the dotted form §2.3 uses. */
const ANSWERS_PATH = "body.answers";

const quoted = (values: readonly string[]) => values.map((value) => `\`${value}\``).join(", ");

/** The keys an entry actually carries, in declaration order. */
const givenKeys = (entry: FormFieldAnswer): readonly AnswerValueKey[] =>
  ANSWER_VALUE_KEYS.filter((key) => entry[key] !== undefined);

/**
 * Validates an answer against the form it answers — the half of the forms
 * surface no static schema can express, since the legal questions and values are
 * whatever the agent wrote into the fence. Returns the `400` body to send, or
 * `undefined` when the answer is good.
 *
 * It lives in the contract rather than in the server so that the wire's own
 * definition of a valid answer has one implementation: the server rejects with
 * it, and a client can pre-check with it before spending a round trip.
 *
 * It reports **every** problem it finds rather than the first: a four-field form
 * answered wrong in two places should not take four round trips to submit.
 * SPEC.md §6 names exactly the rejections it makes, and it makes no others —
 * there is no validation engine here (no formats, no lengths, no regexes):
 *
 * - an option a field does not offer, and an answer to a field the form does not
 *   ask;
 * - a required field with no answer — including a required `choose any` with
 *   nothing selected, which is an omitted entry;
 * - a value given under the wrong key for the field's kind;
 * - the same option named twice in one `choose any`, and the same question
 *   answered twice.
 */
export function validateFormAnswer(
  form: Form,
  answer: FormAnswerRequest,
): ValidationError | undefined {
  const issues: ValidationIssue[] = [];
  const fields = new Map(form.fields.map((field) => [field.question, field]));
  const answered = new Set<string>();
  const asked = () => quoted(form.fields.map((field) => field.question));

  answer.answers.forEach((entry, index) => {
    const at = `${ANSWERS_PATH}[${String(index)}]`;
    const field = fields.get(entry.question);
    if (field === undefined) {
      issues.push({
        path: `${at}.question`,
        message: `This form does not ask \`${entry.question}\`. It asks: ${asked()}.`,
      });
      return;
    }
    if (answered.has(entry.question)) {
      issues.push({
        path: `${at}.question`,
        message: `\`${entry.question}\` is answered more than once; a form is answered once, as a whole.`,
      });
      return;
    }
    answered.add(entry.question);

    const expected = ANSWER_VALUE_KEY_BY_KIND[field.kind];
    const given = givenKeys(entry);
    // The schema's refine already guarantees exactly one; a caller that built
    // the object without parsing it gets the same message rather than a crash.
    if (given.length !== 1) {
      issues.push({
        path: at,
        message:
          `\`${field.question}\` is a \`${field.kind}\` field: give its answer under ` +
          `\`${expected}\` and nothing else.`,
      });
      return;
    }
    if (given[0] !== expected) {
      issues.push({
        path: `${at}.${String(given[0])}`,
        message: `\`${field.question}\` is a \`${field.kind}\` field: its answer belongs under \`${expected}\`.`,
      });
      return;
    }

    // Verbatim membership, deliberately: a near miss is a rejection. Trimming or
    // case-folding here would accept an option the form does not offer, and the
    // answer turn would then record a choice nobody was given.
    if (field.kind === "choose one" && entry.option !== undefined) {
      if (!field.options.includes(entry.option)) {
        issues.push({
          path: `${at}.option`,
          message: `\`${entry.option}\` is not one of this field's options: ${quoted(field.options)}.`,
        });
      }
    }

    if (field.kind === "choose any" && entry.options !== undefined) {
      const chosen = entry.options;
      chosen.forEach((option, chosenIndex) => {
        if (!field.options.includes(option)) {
          issues.push({
            path: `${at}.options[${String(chosenIndex)}]`,
            message: `\`${option}\` is not one of this field's options: ${quoted(field.options)}.`,
          });
        }
      });
      if (!areDistinct(chosen)) {
        issues.push({
          path: `${at}.options`,
          message: `\`${field.question}\` names the same option more than once; each choice is named at most once.`,
        });
      }
    }
  });

  // Required-and-missing is a statement about the form, so it is reported
  // against `answers` as a whole: there is no entry to point at.
  for (const field of form.fields) {
    if (field.optional || answered.has(field.question)) continue;
    issues.push({
      path: ANSWERS_PATH,
      message:
        `\`${field.question}\` is required and has no answer` +
        (field.kind === "choose any"
          ? "; a required `choose any` needs at least one option."
          : "."),
    });
  }

  if (issues.length === 0) return undefined;
  return { code: "bad_request", message: "request failed validation", issues };
}

export type FormFieldKind = z.infer<typeof FormFieldKindSchema>;
export type FormFieldAnswer = z.infer<typeof FormFieldAnswerSchema>;
export type FormAnswerRequest = z.infer<typeof FormAnswerRequestSchema>;
export type FormAnswerResponse = z.infer<typeof FormAnswerResponseSchema>;
export type FormFieldRecord = z.infer<typeof FormFieldRecordSchema>;
export type FormRespondPayload = z.infer<typeof FormRespondPayloadSchema>;
