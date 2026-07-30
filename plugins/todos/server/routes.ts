import { ACTOR_HEADER, DocsQuerySchema, type Actor, type Doc } from "@corpus/contract";
import type { PluginServerContext } from "@corpus/contract/plugin";
import { Hono } from "hono";
import { z } from "zod";
import {
  appendItem,
  itemsOrEmpty,
  openItems,
  readItems,
  removeItem,
  serializeItems,
  TodoItemError,
  updateItem,
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
 * read, apply a pure mutation, and write the result back as an `extra` patch —
 * read and write together, inside the document's write lane, because every
 * patch here carries the whole recomputed list (see {@link mutateItems}).
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
  const items = itemsOrEmpty(doc.frontmatter);
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
 * carries the entire recomputed `items` array, so a read taken outside the lane
 * is a lost update waiting to happen: two toggles dispatched inside the first
 * write's git-commit window both read the pre-change list, both pass their
 * per-item `expectedText` guard — the guard compares the item at the index,
 * which neither of them moved — and the second silently reverts the first after
 * it already answered `200`. Browser-vs-browser and agent-CLI-vs-browser reach
 * the same interleaving. `getDoc` then `updateDoc` cannot fix that from out
 * here; only reading where the write happens can.
 *
 * `apply` therefore runs inside the callback, which the seam requires to be a
 * pure recompute: it may be reached and still write nothing (a lock refusal is
 * part of the write, after the callback), and it must not touch the context.
 */
async function mutateItems(
  context: PluginServerContext,
  actor: Actor,
  docId: string,
  apply: (items: readonly TodoItem[]) => readonly TodoItem[],
): Promise<readonly TodoItem[]> {
  let next: readonly TodoItem[] | undefined;
  await context.mutateDoc(actor, docId, (doc) => {
    if (doc.frontmatter.type !== TODO_DOC_TYPE) {
      throw new TodoItemError(
        400,
        `${docId} is a ${doc.frontmatter.type} document, not a ${TODO_DOC_TYPE} list`,
      );
    }
    const read = readItems(doc.frontmatter);
    if (!read.ok) {
      // Refusing here is the point: writing a well-formed array over frontmatter
      // we could not parse would silently discard whatever the user hand-edited.
      throw new TodoItemError(
        400,
        `${docId} has malformed items and was not written — ${read.problems.join("; ")}`,
      );
    }
    // Every throw above aborts the mutation unwrapped, so a `TodoItemError` —
    // including the one `apply` raises for an out-of-range index or a failed
    // `expectedText` guard — still reaches this plugin's own status mapping.
    next = apply(read.items);
    return { extra: { items: serializeItems(next) } };
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

export default function routes(context: PluginServerContext): Hono {
  const app = new Hono();

  /** Every todo list with its items — one read for the CLI's `list` verb. */
  app.get("/lists", (c) =>
    answering(() => {
      const list = context.listDocs(DocsQuerySchema.parse({ type: TODO_DOC_TYPE }));
      return Promise.resolve(
        c.json({ lists: list.items.map((row) => listView(context.getDoc(row.id))) }),
      );
    }),
  );

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
      const items = await mutateItems(
        context,
        actorOf(c.req.header(ACTOR_HEADER)),
        docId,
        (current) =>
          appendItem(current, {
            text: parsed.data.text,
            ts: new Date(context.now()).toISOString(),
            due: parsed.data.due,
          }),
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
      const items = await mutateItems(
        context,
        actorOf(c.req.header(ACTOR_HEADER)),
        docId,
        (current) => updateItem(current, index, parsed.data),
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
      await mutateItems(context, actorOf(c.req.header(ACTOR_HEADER)), docId, (current) => {
        removed = current[index];
        return removeItem(current, index, parsed.data.expectedText);
      });
      return c.json({ docId, index, removed });
    }),
  );

  return app;
}
