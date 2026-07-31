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
  readLegacyItems,
  removeItemFromBody,
  TodoItemError,
  updateItemInBody,
  type TodoItem,
} from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";
import { answering, translateThrown } from "./errors.js";

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
  // The plugin's own read key, broadcast only after the write succeeded.
  // `["docs"]` is deliberately absent — the core write path above already
  // broadcast it, and naming it here is refused. One key and not two: the
  // plugin publishes exactly one read (the aggregate, `ui/queries.ts`), so a
  // `["lists", docId]` key would name a query nothing has ever registered and
  // invalidate nothing at all (CLEAN 43).
  context.broadcastInvalidate([["lists"]]);
  return next;
}

/** The contract's page bound; these walks must see every list, not one page. */
const PAGE = 200;

/** One todo document, as far as either walk below needs it. */
interface TodoRow {
  readonly id: string;
  readonly title: string;
}

/**
 * Every todo document a query selects, paged through to the end.
 *
 * Both callers need *every* row, and both used to inherit the contract's
 * default `limit` in one place or another: a workspace's fifty-first todo
 * document is invisible to a walk that asks once (FIX 2). `total` bounds the
 * walk as well as the short-page check, so no answer from the context — however
 * odd — can spin this loop (CLEAN 45).
 */
function everyTodoDoc(context: PluginServerContext, includeArchived: boolean): readonly TodoRow[] {
  const found: TodoRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const result = context.listDocs(
      DocsQuerySchema.parse({
        type: TODO_DOC_TYPE,
        ...(includeArchived ? { includeArchived: "true" } : {}),
        limit: String(PAGE),
        offset: String(offset),
      }),
    );
    found.push(...result.items.map((row) => ({ id: row.id, title: row.title })));
    if (result.items.length < PAGE || found.length >= result.page.total) return found;
  }
}

/**
 * `POST /migrate`'s per-document work, and the two states it can end in.
 *
 * A conflict is anything that stopped *this* document — a legacy key that no
 * longer parses, items in both places, an edit lock, a document deleted between
 * the listing and the write, a git failure. All of them are recorded against
 * the document they belong to and the run continues (FIX 3): a migration that
 * aborts on the first locked document names nothing it converted, leaves the
 * successes unbroadcast, and gives the user no way to tell how far it got.
 */
function reasonOf(error: unknown, docId: string): string {
  // The same translation the route would have answered with, so a locked
  // document reads "doc_x is locked by user" here and not "[object Object]".
  const translated = translateThrown(error);
  if (translated !== null) return translated.body.message;
  if (error instanceof Error && error.message !== "") return error.message;
  return `${docId} could not be migrated`;
}

/** How many items a not-yet-migrated document is about to move into its body. */
function legacyItemCount(doc: Doc): number {
  const legacy = readLegacyItems(doc.frontmatter.extra);
  return legacy !== null && legacy.ok ? legacy.items.length : 0;
}

/**
 * What a migration *would* do to this document: the item count, or the throw
 * that a real run would refuse it with. No write, no lane, no lock taken.
 */
function plannedCount(doc: Doc, docId: string): number {
  planWrite(docSource(doc), docId);
  return legacyItemCount(doc);
}

/** Folds one document's legacy key into its body, and answers what moved. */
async function migrateOne(
  context: PluginServerContext,
  actor: Actor,
  docId: string,
): Promise<number> {
  let moved = 0;
  await context.mutateDoc(actor, docId, (doc) => {
    // Re-read inside the lane: the document may have been written — or migrated
    // outright by a concurrent verb — since the listing that named it.
    const plan = planWrite(docSource(doc), docId);
    moved = legacyItemCount(doc);
    return { body: plan.body, extra: { [LEGACY_ITEMS_KEY]: null } };
  });
  return moved;
}

export default function routes(context: PluginServerContext): Hono {
  const app = new Hono();

  /**
   * `POST /migrate` — converge every pre-PLUGINS-005 document onto body storage.
   * `?dryRun=true` reports exactly the same answer and writes nothing.
   *
   * Idempotent by construction: a document with no `extra.items` key is
   * untouched and counted as `unchanged`, so a second run reports nothing to do.
   * A document nothing can migrate safely — a malformed key, items in both
   * places, a document someone else is holding — is reported as a conflict with
   * its reason and left exactly as it was, and the run carries on to the next
   * one. The dry run is honest because it asks the same question through the
   * same function: `planWrite` is what refuses a real write, and a prediction
   * that consulted anything else would be a second implementation to disagree
   * with (CLEAN 47).
   */
  app.post("/migrate", (c) =>
    answering(async () => {
      const actor = actorOf(c.req.header(ACTOR_HEADER));
      const dryRun = c.req.query("dryRun") === "true";
      const migrated: { docId: string; title: string; items: number }[] = [];
      const conflicts: { docId: string; title: string; reason: string }[] = [];
      let unchanged = 0;

      try {
        for (const row of everyTodoDoc(context, true)) {
          try {
            const doc = context.getDoc(row.id);
            if (!hasLegacyItems(doc.frontmatter.extra)) {
              unchanged += 1;
              continue;
            }
            const items = dryRun
              ? plannedCount(doc, row.id)
              : await migrateOne(context, actor, row.id);
            // What "migrated" counts is what *moved* — the legacy key's items.
            // The resulting body also holds anything that was already there,
            // which a run that clears an empty key never moved (FIX 4).
            migrated.push({ docId: row.id, title: row.title, items });
          } catch (error) {
            conflicts.push({ docId: row.id, title: row.title, reason: reasonOf(error, row.id) });
          }
        }
      } finally {
        // Whatever stopped the walk itself, the documents already converted are
        // converted: a board left showing their pre-migration state would be
        // wrong about data on disk.
        if (migrated.length > 0 && !dryRun) context.broadcastInvalidate([["lists"]]);
      }
      return c.json({ dryRun, migrated, conflicts, unchanged });
    }),
  );

  /**
   * Every todo list with its items — one read for the CLI's `list` verb and for
   * the board's aggregate column. Paged, because a workspace with more todo
   * documents than one page holds is a workspace whose column, rows and
   * `corpus todos list` would otherwise all stop at the same arbitrary row
   * (FIX 2). Archived documents are excluded, inheriting core's default result
   * set (SPEC.md §11) rather than inventing a second answer — unlike migration,
   * which deliberately includes them: a document left unmigrated because it
   * happened to be archived is a document that breaks the day it is unarchived.
   */
  const everyList = (c: Context): Promise<Response> =>
    answering(() =>
      Promise.resolve(
        c.json({
          lists: everyTodoDoc(context, false).map((row) => listView(context.getDoc(row.id))),
        }),
      ),
    );

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
