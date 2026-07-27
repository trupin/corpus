import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { CaptureRequestSchema, CaptureResultSchema } from "../schemas/capture.js";
import {
  jsonContent,
  PAYLOAD_TOO_LARGE_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

export const capture = createRoute({
  method: "post",
  path: "/api/capture",
  tags: ["capture"],
  summary: "Capture text (and attachments) as an inbox document",
  description:
    "The composer's Capture action (SPEC.md §11): creates the document in `data/docs/inbox/` **plus** " +
    "its whole-document filing thread asking the agent to retitle, move, expand and tag it, in one " +
    "call. `multipart/form-data`, so a screenshot plus one line is a first-class capture; build the " +
    "body with `uploadCapture` from `@corpus/contract/client`. The returned `eventId` lets the board " +
    "show the pending-agent indicator immediately and the console link the job back to the capture. " +
    "An upload past the workspace's size caps is a `413`.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The captured `text`, plus any `files` parts. `text` is mandatory, so the body is.",
      content: { "multipart/form-data": { schema: CaptureRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(
      CaptureResultSchema,
      "The created document, its filing thread, and the event.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    413: PAYLOAD_TOO_LARGE_RESPONSE,
  },
});
