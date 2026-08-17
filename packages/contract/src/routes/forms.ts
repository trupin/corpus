import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { FormAnswerRequestSchema, FormAnswerResponseSchema } from "../schemas/form.js";
import { ThreadIdSchema } from "../schemas/id.js";
import { IsoDateTimeSchema } from "../schemas/time.js";
import {
  CONFLICT_RESPONSE,
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
  UNRESOLVED_REFERENCE_RESPONSE,
} from "./responses.js";

/**
 * The form-answer surface (SPEC.md §6). The form is addressed through the turn
 * that carries it — a turn holds at most one form and a turn's timestamp is
 * already its identity — so the answer needs no identifier of its own and the
 * request body carries nothing but the answer. Fields are addressed the same
 * way, one level down: by their question text, which is a field's whole
 * identity, so nothing inside a form can drift from anything else in it.
 */
const FormParamsSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
  ts: IsoDateTimeSchema.openapi({
    param: { name: "ts", in: "path", required: true },
    description:
      "Timestamp of the agent turn carrying the form, which is that turn's identity and therefore " +
      "the form's (SPEC.md §6). An ISO 8601 instant contains `:`, so clients must URL-encode it — " +
      "`2026-07-19T10%3A05%3A00Z`.",
  }),
});

export const respondToForm = createRoute({
  method: "post",
  path: "/api/threads/{id}/turns/{ts}/form",
  tags: ["threads"],
  summary: "Answer the form in an agent turn",
  description:
    "Submits an answer to the ```` ```form ```` block in the turn at `{ts}`: the server appends a " +
    "structured answer turn naming every field the form asked and what was given for it, and " +
    "enqueues a `form.respond` event that re-triggers the agent like any engaged-thread reply " +
    "(SPEC.md §6). The thread then leaves `needs=form`.\n\n" +
    "**The fence**, settled by CONTRACT-014 as a CommonMark subset: an opening backtick fence at " +
    "column 0 whose info string is exactly `form` (so ```` ```formula ```` is not one, a tilde " +
    "fence is not one, and a fence quoted inside an outer fenced block is not one), then the " +
    "YAML, then a required closing fence — a whole line of at least as many backticks; an " +
    "unterminated fence is not a form. The first form fence in the body wins, and a turn carries " +
    "at most one form.\n\n" +
    "**The grammar** the YAML follows (CONTRACT-038). A form is a list of `fields`, each with its " +
    "own non-empty `question` — the field's whole identity, so questions are **distinct** within " +
    "the form and there are no field ids. A field is one of exactly three `kind`s and there are " +
    "no others: `choose one` and `choose any` carry `options` (at least one, each non-empty, all " +
    "distinct), `write` carries none. A field is **required unless** it carries `optional: true`. " +
    "The short spelling stays: a top-level `prompt` plus `options` **is** a form with one " +
    "required `choose one` field, so every form already written keeps parsing. Nothing else is " +
    "part of the grammar — no form id, no field ids, no defaults, no placeholders, no per-field " +
    "validation rules, no sections, no conditional fields.\n\n" +
    "**Two rules keep the form answerable**, since the answer turn is the durable record of what " +
    "was answered and is read back a line at a time (PR #28 finding 1). A `question` and an option " +
    "are each **a single line**. And no option may be spelled `**Note:**`, `_(left blank)_`, or " +
    "one of this same form's questions wrapped in `**…**`: the answer writes a chosen option on a " +
    "line of its own, where those three read as the note heading, the blank marker, and a " +
    "question heading. A form breaking either rule does not parse at all — so it is a `400` on " +
    "the turn that would write it and, wherever such bytes already exist, a form to nobody: it " +
    "renders as the broken code block it is (§11) rather than advertising a question no answer " +
    "could ever clear.\n\n" +
    "**The answer** carries one entry per field answered, matched to its field by `question` " +
    "rather than by position, with the value under the key the field's kind names: `option` for " +
    "`choose one`, `options` for `choose any`, `text` for `write`. A chosen option is matched " +
    "**verbatim** against that field's `options` — a near miss is a rejection. A field left blank is **omitted " +
    "from `answers`**, which is legal only when that field is optional — so a form whose fields " +
    "are all optional accepts an empty `answers`. Submitting is all-or-nothing: there is no " +
    "partial save and no per-field submit, and a form is unanswered until it is submitted. A " +
    "`note` is free text about the ask as a whole, and always optional.\n\n" +
    '**User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — "only the ' +
    'person answers a form: the agent never answers a form, including its own" (SPEC.md §6). A ' +
    "signal the agent can clear for itself is not a signal, so this is a refusal in the same " +
    "family as user-only deletion, not a silent no-op.\n\n" +
    "`400` when the answer does not fit the form — an option a field does not offer, an answer to " +
    "a field the form does not ask, a required field with no answer, a value under the wrong key " +
    "for the field's kind, or the same option named twice in one `choose any` — naming every " +
    "offending entry under `body.answers` in `issues`. Also `400` when the answer's own text " +
    "would not survive the turn it writes: a `write` answer or a `note` containing a line that " +
    "reads as a turn heading, one leaving a code fence open, or one spelled exactly like this " +
    "form's own `**<question>**` heading, `**Note:**` or `_(left blank)_` — the last of these " +
    "would be recorded under the wrong question while parsing perfectly well, so it is refused " +
    "rather than rewritten (a rewrite would record an answer nobody gave). `404` when the thread has no such turn, or " +
    "that turn carries no form; `409` when that form is **already answered** — a form is answered " +
    "once, and changing your mind is an ordinary reply, not a second answer to the same question " +
    "(SPEC.md §6, §11). The `409` is deliberate: the request is well formed and the state is what " +
    "refuses it, so retrying with a different body will not help.",
  request: {
    params: FormParamsSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The answer. `answers` is mandatory — though it may be empty, for a form whose fields are " +
        "all optional — so the body is too.",
      content: { "application/json": { schema: FormAnswerRequestSchema } },
    },
  },
  responses: {
    422: UNRESOLVED_REFERENCE_RESPONSE,
    201: jsonContent(
      FormAnswerResponseSchema,
      "The appended answer turn, the updated thread summary, and the enqueued event.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});
