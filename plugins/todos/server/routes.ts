import { ACTOR_HEADER, DocsQuerySchema, type Actor, type Doc } from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  appendItemToBody,
  docSource,
  hasLegacyItems,
  itemsOrEmpty,
  LEGACY_ITEMS_KEY,
  openItems,
  parseBodyItems,
  planWrite,
  removeItemFromBody,
  TodoItemError,
  updateItemInBody,
  type TodoItem,
} from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";
import { answering } from "./errors.js";

/**
 * The todos plugin's server half (SPEC.md §10, §12), mounted by discovery at
 * `/api/x/todos` — the prefix comes from the directory name and this module
 * never states it.
 *
 * **Every write goes through the context, which is the core write path**
 * (validate → write atomically → git auto-commit → re-project → broadcast), so
 * Architecture Decision 2 holds here by construction: nothing in this directory
 * opens a file, a database or a git repository — a route has no way to. The
 * context is also what makes
 * the board refresh free — the core write path broadcasts `["docs"]` itself,
 * which is why the plugin broadcasts only its **own** `x/todos/…` keys below
 * and would be refused if it named a core root.
 *
 * The item format lives in exactly one place (`../items.ts`); these handlers
 * read, apply a pure mutation, and write the result back as a **body** patch —
 * read and write together, inside the document's write lane, because every
 * patch here rewrites the document's body (see {@link mutateItems}).
 *
 * Since PLUGINS-005 items are task-list lines in the body (SPEC.md §12), so
 * these routes are no longer the only way an item can change: the core editor
 * writes the same lines through `PUT /api/docs/{id}`. That is the point — these
 * routes are the **CLI and agent** item-level write path and the format owner
 * behind it, not a private store.
 */

const AppendBodySchema = z.object({
  text: z.string().min(1),
  due: z.string().optional(),
});

const UpdateBodySchema = z.object({
  done: z.boolean().optional(),
  text: z.string().min(1).optional(),
  due: z.string().nullable().optional(),
  /** The label the caller believes is at this index; a mismatch answers 409. */
  expectedText: z.string().optional(),
});

const DeleteBodySchema = z.object({ expectedText: z.string().optional() });

/** The §5/§9.2 actor default: an unrecognised or absent header means `user`. */
function actorOf(header: string | undefined): Actor {
  return header?.trim().toLowerCase() === "agent" ? "agent" : "user";
}

/** A body that is absent, empty or unparseable is `{}` — every field is optional. */
async function jsonBody(request: Request): Promise<unknown> {
  return await request.json().catch(() => ({}));
}

function parseIndex(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new TodoItemError(400, `item index “${raw}” is not a number`);
  }
  return Number.parseInt(raw, 10);
}

/** One todo document as this plugin reports it — items included, always an array. */
function listView(doc: Doc): Record<string, unknown> {
  const items = itemsOrEmpty(docSource(doc));
  return {
    docId: doc.frontmatter.id,
    title: doc.frontmatter.title,
    path: doc.path,
    status: doc.frontmatter.status,
    open: openItems(items).length,
    done: items.length - openItems(items).length,
    items,
  };
}

/**
 * Reads the document, refuses anything that is not a readable todo list, and
 * writes the mutation's result back through the core write path — **all of it
 * inside the document's write lane**, via `mutateDoc`.
 *
 * The lane is the whole point (PR #11 review, finding 2). Every patch here
 * rewrites the whole body, so a read taken outside the lane is a lost update
 * waiting to happen: two toggles dispatched inside the first write's git-commit
 * window both read the pre-change body, both pass their per-item `expectedText`
 * guard — the guard compares the item at the index, which neither of them moved
 * — and the second silently reverts the first after it already answered `200`.
 * Browser-vs-browser and agent-CLI-vs-browser reach the same interleaving.
 * `getDoc` then `updateDoc` cannot fix that from out here; only reading where
 * the write happens can.
 *
 * `apply` therefore runs inside the callback, which the seam requires to be a
 * pure recompute: it may be reached and still write nothing (a lock refusal is
 * part of the write, after the callback), and it must not touch the context.
 *
 * It is also where a not-yet-migrated document converges: `planWrite` folds any
 * surviving `extra.items` into the body first, and the same patch clears the
 * key — one commit, never a document with its items in two places.
 */
async function mutateItems(
  context: PluginServerContext,
  actor: Actor,
  docId: string,
  apply: (body: string) => string,
): Promise<readonly TodoItem[]> {
  let next: readonly TodoItem[] | undefined;
  await context.mutateDoc(actor, docId, (doc) => {
    if (doc.frontmatter.type !== TODO_DOC_TYPE) {
      throw new TodoItemError(
        400,
        `${docId} is a ${doc.frontmatter.type} document, not a ${TODO_DOC_TYPE} list`,
      );
    }
    // Refuses a legacy key it could not parse rather than writing over it, and
    // refuses a document whose items are in two places rather than picking one.
    const plan = planWrite(docSource(doc), docId);
    // Every throw above aborts the mutation unwrapped, so a `TodoItemError` —
    // including the one `apply` raises for an out-of-range index or a failed
    // `expectedText` guard — still reaches this plugin's own status mapping.
    const body = apply(plan.body);
    next = parseBodyItems(body);
    return { body, ...(plan.clearLegacy ? { extra: { [LEGACY_ITEMS_KEY]: null } } : {}) };
  });
  if (next === undefined) {
    // Unreachable against a context that honours the seam: `mutateDoc` resolves
    // only once the callback has returned a patch. Stated rather than asserted
    // away, so a context that resolved without mutating fails loudly instead of
    // answering 200 with an invented item.
    throw new Error(`mutateDoc resolved without mutating ${docId}`);
  }
  // The plugin's own read keys, broadcast only after the write succeeded.
  // `["docs"]` is deliberately absent — the core write path above already
  // broadcast it, and naming it here is refused.
  context.broadcastInvalidate([["lists"], ["lists", docId]]);
  return next;
}

/** The contract's page bound; migration must see every list, not the first page. */
const PAGE = 200;

/**
 * Every todo document in the workspace, archived ones included, paged through.
 *
 * `GET /lists` deliberately inherits core's default result set (SPEC.md §11 —
 * archived documents are excluded); migration deliberately does not. A document
 * left unmigrated because it happened to be archived is a document that breaks
 * the day someone unarchives it.
 */
function everyTodoDoc(context: PluginServerContext): readonly { id: string; title: string }[] {
  const found: { id: string; title: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = context.listDocs(
      DocsQuerySchema.parse({
        type: TODO_DOC_TYPE,
        includeArchived: "true",
        limit: String(PAGE),
        offset: String(offset),
      }),
    );
    found.push(...page.items.map((row) => ({ id: row.id, title: row.title })));
    // A short page is the last page — asked rather than inferred from `total`,
    // which counts rows this query may not have been given.
    if (page.items.length < PAGE) return found;
  }
}

export default function routes(context: PluginServerContext): Hono {
  const app = new Hono();

  /**
   * `POST /migrate` — converge every pre-PLUGINS-005 document onto body storage.
   *
   * Idempotent by construction: a document with no `extra.items` key is
   * untouched and counted as `unchanged`, so a second run reports nothing to do.
   * A document nothing can migrate safely — a malformed key, or items in both
   * places — is reported as a conflict with its reason and left exactly as it
   * was, because the alternative is guessing which list the user meant.
   */
  app.post("/migrate", (c) =>
    answering(async () => {
      const actor = actorOf(c.req.header(ACTOR_HEADER));
      const migrated: { docId: string; title: string; items: number }[] = [];
      const conflicts: { docId: string; title: string; reason: string }[] = [];
      let unchanged = 0;

      for (const row of everyTodoDoc(context)) {
        if (!hasLegacyItems(context.getDoc(row.id).frontmatter.extra)) {
          unchanged += 1;
          continue;
        }
        let count = 0;
        try {
          await context.mutateDoc(actor, row.id, (doc) => {
            const plan = planWrite(docSource(doc), row.id);
            count = parseBodyItems(plan.body).length;
            return { body: plan.body, extra: { [LEGACY_ITEMS_KEY]: null } };
          });
        } catch (error) {
          if (!(error instanceof TodoItemError)) throw error;
          conflicts.push({ docId: row.id, title: row.title, reason: error.message });
          continue;
        }
        migrated.push({ docId: row.id, title: row.title, items: count });
      }

      if (migrated.length > 0) {
        context.broadcastInvalidate([
          ["lists"],
          ...migrated.map((entry) => ["lists", entry.docId] as const),
        ]);
      }
      return c.json({ migrated, conflicts, unchanged });
    }),
  );

  /** Every todo list with its items — one read for the CLI's `list` verb. */
  const everyList = (c: Context): Promise<Response> =>
    answering(() => {
      const list = context.listDocs(DocsQuerySchema.parse({ type: TODO_DOC_TYPE }));
      return Promise.resolve(
        c.json({ lists: list.items.map((row) => listView(context.getDoc(row.id))) }),
      );
    });

  app.get("/lists", everyList);

  /**
   * The same aggregate, addressed by a **cache generation** the board computes.
   *
   * The segment is deliberately unread. Its whole job is to be *different* when
   * any todo document has been written: the kit derives a query key from this
   * path, so a changed segment is a changed key and therefore a refetch — which
   * is what keeps the column honest after a **core** body edit, the ordinary
   * way to check a box since PLUGINS-006 (core broadcasts `["docs"]` and never
   * `["x","todos",…]`). The key stays prefixed by `["x","todos","lists"]`, so
   * the plugin's own broadcast still invalidates it exactly as it always did.
   * See `ui/queries.ts` for the other half.
   */
  app.get("/lists/at/:fingerprint", everyList);

  /** One todo list, resolved by document id. */
  app.get("/lists/:docId", (c) =>
    answering(() => {
      const doc = context.getDoc(c.req.param("docId"));
      if (doc.frontmatter.type !== TODO_DOC_TYPE) {
        throw new TodoItemError(
          400,
          `${doc.frontmatter.id} is a ${doc.frontmatter.type} document, not a ${TODO_DOC_TYPE} list`,
        );
      }
      return Promise.resolve(c.json(listView(doc)));
    }),
  );

  app.post("/:docId/items", (c) =>
    answering(async () => {
      const parsed = AppendBodySchema.safeParse(await jsonBody(c.req.raw));
      if (!parsed.success) {
        throw new TodoItemError(400, "an item needs a non-empty `text`");
      }
      const docId = c.req.param("docId");
      const items = await mutateItems(context, actorOf(c.req.header(ACTOR_HEADER)), docId, (body) =>
        appendItemToBody(body, { text: parsed.data.text, due: parsed.data.due }),
      );
      const index = items.length - 1;
      return c.json({ docId, index, item: items[index] }, 201);
    }),
  );

  app.put("/:docId/items/:index", (c) =>
    answering(async () => {
      const parsed = UpdateBodySchema.safeParse(await jsonBody(c.req.raw));
      if (!parsed.success) {
        throw new TodoItemError(400, "an item update takes `done`, `text` and/or `due`");
      }
      const docId = c.req.param("docId");
      const index = parseIndex(c.req.param("index"));
      const items = await mutateItems(context, actorOf(c.req.header(ACTOR_HEADER)), docId, (body) =>
        updateItemInBody(body, index, parsed.data),
      );
      return c.json({ docId, index, item: items[index] });
    }),
  );

  app.delete("/:docId/items/:index", (c) =>
    answering(async () => {
      const parsed = DeleteBodySchema.safeParse(await jsonBody(c.req.raw));
      if (!parsed.success) {
        throw new TodoItemError(400, "`expectedText` must be a string when given");
      }
      const docId = c.req.param("docId");
      const index = parseIndex(c.req.param("index"));
      let removed: TodoItem | undefined;
      await mutateItems(context, actorOf(c.req.header(ACTOR_HEADER)), docId, (body) => {
        removed = parseBodyItems(body)[index];
        return removeItemFromBody(body, index, parsed.data.expectedText);
      });
      return c.json({ docId, index, removed });
    }),
  );

  return app;
}
