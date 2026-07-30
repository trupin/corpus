import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { FormAnswerRequestSchema, FormAnswerResponseSchema } from "../schemas/form.js";
import { ThreadIdSchema } from "../schemas/id.js";
import { IsoDateTimeSchema } from "../schemas/time.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * The form-answer surface (SPEC.md §6). The form is addressed through the turn
 * that carries it — a turn holds at most one form and a turn's timestamp is
 * already its identity — so the answer needs no identifier of its own and the
 * request body carries nothing but the answer.
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
    "structured answer turn carrying the chosen option and any note, and enqueues a `form.respond` " +
    "event that re-triggers the agent like any engaged-thread reply (SPEC.md §6). The thread then " +
    "leaves `needs=form`.\n\n" +
    "**The fence grammar**, which this route validates the answer against — settled by " +
    "CONTRACT-014 as a CommonMark subset: an opening backtick fence at column 0 whose info string " +
    "is exactly `form` (so ```` ```formula ```` is not one, a tilde fence is not one, and a fence " +
    "quoted inside an outer fenced block is not one), then YAML with `prompt` (non-empty) and " +
    "`options` (at least one, each non-empty, all distinct), then a required closing fence — a " +
    "whole line of at least as many backticks; an unterminated fence is not a form. Selection is " +
    "single: the answer names exactly one option, verbatim. A `note` is free text and always " +
    "optional. Nothing else is part of the grammar — no form id, no per-option types, no required " +
    "markers, no multi-select.\n\n" +
    "`400` when `option` is not one of the offered options, naming `body.option` in `issues`; " +
    "`404` when the thread has no such turn, or that turn carries no form.",
  request: {
    params: FormParamsSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The answer. `option` is mandatory — an answer that chooses nothing is not an answer — so " +
        "the body is too.",
      content: { "application/json": { schema: FormAnswerRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(
      FormAnswerResponseSchema,
      "The appended answer turn, the updated thread summary, and the enqueued event.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
