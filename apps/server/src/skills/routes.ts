// The skill surface (SPEC.md §7). Two verbs: creation and the rollback.
//
// `corpus skill archive|list|show` deliberately do not exist — archiving a skill
// is already `corpus doc archive` (§7 makes skills documents), and listing them
// is `GET /api/docs?type=skill`. Creation and rollback are the two things a
// skill needs and a document does not: one because a skill is created in a root
// `POST /api/docs` cannot reach, the other because a skill can break the loop
// that would otherwise repair it.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { actorOf, reportWarnings, serializeWarnings, type DocumentMutex } from "../docs/index.js";
import { createSkill } from "./create.js";
import { rollbackSkill, type SkillsWorkspace } from "./rollback.js";

export function mountSkillRoutes(
  app: OpenAPIHono,
  workspace: SkillsWorkspace,
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

  app.openapi(contractRoutes.rollbackSkill, async (c) => {
    const { name } = c.req.valid("param");
    const actor = actorOf(c.req.valid("header"));
    // The body is optional in full — a bare `POST` restores the last-known-good
    // version — and `null` says the same thing explicitly, so a client holding a
    // nullable ref never has to strip the key before sending.
    const { to } = c.req.valid("json") ?? {};
    return c.json(await rollbackSkill(workspace, mutex, actor, name, to ?? null), 200);
  });
}
