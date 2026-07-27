// `POST /api/capture`, bound to the contract's route definition (SPEC.md §11).

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { actorOf, reportWarnings, type DocumentMutex } from "../docs/index.js";
import type { ThreadsWorkspace } from "../threads/index.js";
import { captureDocument } from "./capture.js";

export function mountCaptureRoutes(
  app: OpenAPIHono,
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
): void {
  app.openapi(contractRoutes.capture, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { result, mutation } = await captureDocument(
      workspace,
      mutex,
      actor,
      c.req.valid("form"),
    );
    reportWarnings(workspace, result.docId, mutation);
    return c.json(result, 201);
  });
}
