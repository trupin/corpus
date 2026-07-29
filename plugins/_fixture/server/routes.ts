import {
  ACTOR_HEADER,
  DocsQuerySchema,
  type Actor,
  type CreateDocRequest,
  type Doc,
  type DocList,
  type DocsQuery,
  type QueryKeySegment,
  type UpdateDocRequest,
} from "@corpus/contract";
import { Hono } from "hono";
import { z } from "zod";
import { FIXTURE_DOC_TYPE } from "../shared.js";

/**
 * The fixture's server half (SPEC.md §10): mounted by discovery at
 * `/api/x/_fixture` — the prefix comes from the directory name, this module
 * never states it. The factory receives the server's plugin context and
 * builds an ordinary Hono router; every write below goes through the context,
 * which is the core write path (git auto-commit, projection, anchor
 * reconciliation), because a plugin route never touches the filesystem.
 *
 * The context is typed *structurally*: a plugin may import only
 * `@corpus/kit` and `@corpus/contract`, and the server's own
 * `PluginServerContext` type lives in neither. Every member below is a
 * contract type, so the shape stays checkable end to end; whether the context
 * type should graduate into `@corpus/contract` is an open PLUGINS design
 * question filed with PLUGINS-001.
 */
export interface FixtureServerContext {
  readonly plugin: string;
  listDocs(query: DocsQuery): DocList;
  getDoc(id: string): Doc;
  createDoc(actor: Actor, input: CreateDocRequest): Promise<Doc>;
  updateDoc(actor: Actor, id: string, patch: UpdateDocRequest): Promise<Doc>;
  broadcastInvalidate(keys: readonly (readonly QueryKeySegment[])[]): void;
}

const CreateNoteSchema = z.object({ title: z.string().min(1) });

/** The §5/§9.2 actor default: an unrecognised or absent header means `user`. */
function actorOf(header: string | undefined): Actor {
  return header?.trim().toLowerCase() === "agent" ? "agent" : "user";
}

export default function routes(context: FixtureServerContext): Hono {
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
