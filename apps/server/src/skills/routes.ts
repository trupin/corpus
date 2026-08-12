// The skill surface (SPEC.md §7). One verb: creation.
//
// `corpus skill archive|list|show` deliberately do not exist — archiving a skill
// is already `corpus doc archive` (§7 makes skills documents), and listing them
// is `GET /api/docs?type=skill`. Creation is the one thing a skill needs and a
// document does not: a skill is created in a root `POST /api/docs` cannot reach.
//
// **There is no rollback verb, and that is a decision rather than a gap**
// (SHARED-042, §7's loop-safety rider signed 2026-08-12). Putting a badly edited
// skill back is a write whose content came from history: the agent reads the
// history and writes the content it wants back through `PUT /api/docs/{id}`,
// presenting the key of the version it read. That path reconciles anchors (§6),
// validates (§14), commits under the acting party (§4) and is protected by §7's
// key. The verb that used to live here reimplemented none of those and replaced
// a whole file rather than reverting a path, which is how it destroyed
// uncommitted edits unrecoverably (PR #43's review).

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import {
  actorOf,
  reportWarnings,
  serializeWarnings,
  type DocsWorkspace,
  type DocumentMutex,
} from "../docs/index.js";
import { createSkill } from "./create.js";

export function mountSkillRoutes(
  app: OpenAPIHono,
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
): void {
  app.openapi(contractRoutes.createSkill, async (c) => {
    const actor = actorOf(c.req.valid("header"));
    const { doc, result } = await createSkill(workspace, mutex, actor, c.req.valid("json"));
    reportWarnings(workspace, doc.frontmatter.id, result);
    // §14's mutation envelope, identical to `POST /api/docs`'s — what was
    // created is the same kind of thing, so it is reported the same way.
    return c.json({ doc, warnings: serializeWarnings(result) }, 201);
  });
}
