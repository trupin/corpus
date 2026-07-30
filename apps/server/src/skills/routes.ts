// The skill surface (SPEC.md §7). One verb today: the rollback.
//
// `corpus skill archive|list|show` deliberately do not exist — archiving a skill
// is already `corpus doc archive` (§7 makes skills documents), and listing them
// is `GET /api/docs?type=skill`. Rollback is the one thing a skill needs that a
// document does not.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { actorOf, type DocumentMutex } from "../docs/index.js";
import { rollbackSkill, type SkillsWorkspace } from "./rollback.js";

export function mountSkillRoutes(
  app: OpenAPIHono,
  workspace: SkillsWorkspace,
  mutex: DocumentMutex,
): void {
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
