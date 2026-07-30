import { z } from "@hono/zod-openapi";
import type { ValidationError, ValidationIssue } from "./error.js";
import { EventIdSchema, ThreadIdSchema } from "./id.js";
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
 * - **The fields.** `prompt` (required, non-empty) and `options` (required, at
 *   least one, each non-empty, all distinct). Nothing else is pinned —
 *   required/optional markers, field types, validation rules and multi-select are
 *   all absent from §6, and every one of them is a rendering decision that
 *   belongs to the UI issue that needs it, not to this schema.
 * - **Cardinality.** Single-select: an answer names exactly one option, verbatim.
 *   Options must be distinct precisely because the answer names one by its text.
 * - **The note.** A free-text note is separate from, and optional beside, the
 *   chosen option — §6's "chosen option + optional note".
 * - **Identity.** A form is identified by the timestamp of the turn carrying it,
 *   which is already that turn's identity (SPEC.md §6). A turn therefore carries
 *   **at most one form**, and the answer route addresses the form through its
 *   turn's path rather than through an id invented for it: no second identifier
 *   exists to drift from the first.
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
 * It lives in the contract for the same reason the rest of the grammar does:
 * two sides depend on it and neither may import the other. The server's form
 * route composes the body with it; the UI matches turn bodies against it to know
 * whether the form above is already answered — and `apps/ui` cannot import
 * `apps/server`. One spelling, in the module that owns the grammar (CONTRACT-013).
 *
 * **A deliberate gap, kept (CONTRACT-014).** The answer names its option but not
 * the form it answers, so a thread read back off disk pairs answers to forms by
 * an order rule (earliest still-open form offering that option — the UI's
 * `mapFormAnswers`), and a multi-form thread can in principle mis-attribute one.
 * Closing it needs the form's identity (its turn's `ts`) written *into* the
 * answer turn — and the turn format has nowhere to put it except the prose,
 * which §6 keeps deliberately plain ("no form id") and this module's own
 * rationale keeps machine-markup-free. The failure it buys is narrow (two forms
 * open at once, sharing an option string, answered across a reload), visible,
 * and self-limiting — answering again is legal and re-pairs it — so the wire
 * stays as it is. Revisit via a SPEC.md §6 revision, not a silent format change,
 * if multi-form threads become a real pattern.
 */
export const FORM_ANSWER_LABEL = "**Answered:**";

/**
 * The parsed contents of a form fence. Deliberately **not** a registered OpenAPI
 * component: no route returns a form — turn bodies travel as markdown — and a
 * component with no producer would be contract surface nobody can reach. The
 * grammar it defines is published in the answer route's description instead.
 */
export const FormSchema = z
  .object({
    prompt: z.string().min(1).describe("The question put to the user."),
    options: z
      .array(z.string().min(1))
      .min(1)
      .refine((options) => new Set(options).size === options.length, {
        message: "Form options must be distinct: an answer names an option by its text.",
      })
      .describe("The offered answers. Single-select: an answer names exactly one, verbatim."),
  })
  .describe("A form fence's YAML: a prompt and its options (SPEC.md §6).");

export const FormAnswerRequestSchema = z
  .strictObject({
    option: z
      .string()
      .min(1)
      .describe(
        "The chosen option, matched verbatim against the answered form's `options`. An option the " +
          "form does not offer is a `400` naming `body.option` — validating the answer against the " +
          "fence it answers is the point of the route.",
      ),
    note: z
      .string()
      .min(1)
      .optional()
      .describe("Free-text note recorded beside the chosen option (SPEC.md §6). Optional."),
  })
  .openapi("FormAnswerRequest");

/**
 * The answer's own mutation response. Same three parts every turn append reports
 * — the appended turn, the thread it changed and the event it enqueued — plus
 * §14's warnings, because appending a turn writes a workspace file and a rejected
 * auto-commit has to surface here exactly as it does on every other mutation.
 */
export const FormAnswerResponseSchema = z
  .object({
    thread: ThreadSummarySchema,
    turn: TurnSchema.describe("The appended answer turn: the chosen option and any note."),
    eventId: EventIdSchema.nullable().describe(
      "The enqueued `form.respond` event, which re-triggers the agent like any engaged-thread " +
        "reply (SPEC.md §6). Null when the answer does not re-trigger it — a resolved thread stops " +
        "re-triggering the agent even while it is engaged (SPEC.md §8).",
    ),
    warnings: warningsField,
  })
  .openapi("FormAnswerResponse");

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
 */
export const FormRespondPayloadSchema = z.object({
  threadId: ThreadIdSchema,
  formTs: IsoDateTimeSchema.describe("Timestamp of the agent turn whose form was answered."),
  option: z.string().min(1).describe("The chosen option, verbatim from the form."),
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

/** Where an offending answer field is reported, in the dotted form §2.3 uses. */
const OPTION_PATH = "body.option";

/**
 * Validates an answer against the form it answers — the half of the forms
 * surface no static schema can express, since the legal values are whatever the
 * agent wrote into the fence. Returns the `400` body to send, or `undefined` when
 * the answer is good.
 *
 * It lives in the contract rather than in the server so that the wire's own
 * definition of a valid answer has one implementation: the server rejects with
 * it, and a client can pre-check with it before spending a round trip.
 */
export function validateFormAnswer(
  form: Form,
  answer: FormAnswerRequest,
): ValidationError | undefined {
  // Verbatim membership, deliberately: a near miss is a rejection. Trimming or
  // case-folding here would accept an option the form does not offer, and the
  // answer turn would then record a choice nobody was given.
  if (form.options.includes(answer.option)) return undefined;

  const offered = form.options.map((option) => `\`${option}\``).join(", ");
  const issues: ValidationIssue[] = [
    {
      path: OPTION_PATH,
      message: `\`${answer.option}\` is not one of this form's options: ${offered}.`,
    },
  ];
  return { code: "bad_request", message: "request failed validation", issues };
}

export type Form = z.infer<typeof FormSchema>;
export type FormAnswerRequest = z.infer<typeof FormAnswerRequestSchema>;
export type FormAnswerResponse = z.infer<typeof FormAnswerResponseSchema>;
export type FormRespondPayload = z.infer<typeof FormRespondPayloadSchema>;
