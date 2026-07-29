import { ACTOR_HEADER, DocsQuerySchema, type Actor } from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import { Hono } from "hono";
import { z } from "zod";
import { FIXTURE_DOC_TYPE } from "../shared.js";

/**
 * The fixture's server half (SPEC.md §10): mounted by discovery at
 * `/api/x/_fixture` — the prefix comes from the directory name, this module
 * never states it. The factory receives the plugin context and builds an
 * ordinary Hono router; every write below goes through the context, which is
 * the core write path (git auto-commit, projection, anchor reconciliation),
 * because a plugin route never touches the filesystem.
 *
 * The context type comes from `@corpus/contract/plugin` (CONTRACT-015) — the
 * types-only subpath a plugin is allowed to import. The server implements the
 * same interface (`apps/server/src/plugins/context.ts`), so this factory's
 * parameter and the object it is handed at mount are checked against one
 * declaration rather than against a hand-maintained local copy.
 */

const CreateNoteSchema = z.object({ title: z.string().min(1) });

/** The §5/§9.2 actor default: an unrecognised or absent header means `user`. */
function actorOf(header: string | undefined): Actor {
  return header?.trim().toLowerCase() === "agent" ? "agent" : "user";
}

export default function routes(context: PluginServerContext): Hono {
  const app = new Hono();

  app.get("/notes", (c) => {
    const list = context.listDocs(DocsQuerySchema.parse({ type: FIXTURE_DOC_TYPE }));
    return c.json({
      notes: list.items.map((row) => ({ id: row.id, title: row.title })),
    });
  });

  app.post("/notes", async (c) => {
    const body = CreateNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ code: "bad_request", message: "a note needs a title", issues: [] }, 400);
    }
    const actor = actorOf(c.req.header(ACTOR_HEADER));
    const doc = await context.createDoc(actor, {
      type: FIXTURE_DOC_TYPE,
      title: body.data.title,
      folder: "inbox",
    });
    // The core write already refreshed the board (`["docs"]` came from the
    // write path itself); this names the plugin's own stale key.
    context.broadcastInvalidate([["notes"]]);
    return c.json({ id: doc.frontmatter.id, title: doc.frontmatter.title }, 201);
  });

  return app;
}
