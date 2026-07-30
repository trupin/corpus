import { ACTOR_HEADER } from "@corpus/contract";
import type { PluginCommandContext } from "@corpus/contract/plugin";
import { z } from "zod";
import { TodoItemSchema, type TodoItem } from "../items.js";
import { TODOS_PLUGIN } from "../shared.js";

/**
 * The one HTTP helper the three `corpus todos` verbs share.
 *
 * Plugin verbs are **thin clients** (SPEC.md §10, §2.3, sprint-013
 * Adjudication 16): `PluginCommandClient` publishes the server's origin and
 * nothing else — `@corpus/contract/client` is lint-forbidden to plugins,
 * because a verb that builds its own typed transport bypasses the boundary the
 * kit and the CLI both stand on. So a verb does its own `fetch` against
 * `context.workspace.baseUrl`, with the bearer token and the `ACTOR_HEADER`
 * carrying the actor the CLI already resolved from `--from` / `CORPUS_FROM`.
 *
 * There is no filesystem access here and no frontmatter parsing: the item
 * format lives on the server side of these routes, in `../items.ts`, and the
 * CLI never learns it. That is what keeps `corpus todos` honest about
 * Architecture Decision 2 — the server is the sole writer.
 */

export const TodoListSchema = z.object({
  docId: z.string(),
  title: z.string(),
  path: z.string(),
  status: z.string(),
  open: z.number(),
  done: z.number(),
  items: z.array(TodoItemSchema),
});

export type TodoList = z.infer<typeof TodoListSchema>;

const ListsSchema = z.object({ lists: z.array(TodoListSchema) });

const MutationSchema = z.object({
  docId: z.string(),
  index: z.number(),
  item: TodoItemSchema.optional(),
  removed: TodoItemSchema.optional(),
});

/** The contract's `ApiError` body, as far as a verb needs to render it. */
const ApiErrorSchema = z.looseObject({ code: z.string(), message: z.string() });

/** A refusal from the plugin's own routes, rendered as the CLI renders any error. */
export class TodosRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TodosRequestError";
  }
}

/** A parsed JSON body, or the fact that there was not one. */
type Payload = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/** An empty body is `null`, not a failure — a `204` has nothing to say. */
function readJson(text: string): Payload {
  if (text === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * One request to the plugin's own routes, decoded into the shape the verb
 * expects — or refused with a sentence a person can act on.
 *
 * The decode belongs **here** rather than at each call site because there are
 * three ways an answer can be unusable and only one of them used to produce a
 * readable error: a refusal carrying the contract's `ApiError`, a 2xx whose body
 * is not JSON at all (a proxy's HTML error page, a truncated response), and a
 * 2xx whose JSON is not what this route promises. The last two used to surface
 * as a raw `ZodError` — a wall of `invalid_type` paths printed at an agent that
 * just wanted its todo list (CLEAN 46).
 */
async function request<T>(
  context: PluginCommandContext,
  path: string,
  schema: z.ZodType<T>,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const route = `${init.method} /api/x/${TODOS_PLUGIN}/${path}`;
  const response = await fetch(`${context.workspace.baseUrl}/api/x/${TODOS_PLUGIN}/${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${context.workspace.token}`,
      [ACTOR_HEADER]: context.actor,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const payload = readJson(await response.text());

  if (!response.ok) {
    const parsed = payload.ok ? ApiErrorSchema.safeParse(payload.value) : null;
    throw new TodosRequestError(
      response.status,
      parsed?.success === true
        ? parsed.data.message
        : `${route} failed (HTTP ${String(response.status)})`,
    );
  }
  if (!payload.ok) {
    throw new TodosRequestError(
      response.status,
      `${route} answered HTTP ${String(response.status)} with a body that is not JSON — ` +
        "the server this workspace points at may not be a Corpus server",
    );
  }
  const decoded = schema.safeParse(payload.value);
  if (!decoded.success) {
    throw new TodosRequestError(
      response.status,
      `${route} answered a shape this verb does not understand — the todos plugin on the server ` +
        "is a different version than this CLI",
    );
  }
  return decoded.data;
}

/** Every todo list in the workspace, items included — one request. */
export async function fetchLists(context: PluginCommandContext): Promise<readonly TodoList[]> {
  return (await request(context, "lists", ListsSchema)).lists;
}

/**
 * Resolves what the user typed to one todo document.
 *
 * Accepts a document id, an exact title (case-insensitively), or an
 * unambiguous title fragment — so the agent can say "the shopping list" rather
 * than an id, which is the whole reason these verbs take a name at all.
 * Ambiguity is refused with the candidates named; guessing is how the wrong
 * list gets written to.
 */
export function resolveList(lists: readonly TodoList[], selector: string): TodoList {
  const needle = selector.trim().toLowerCase();
  const byId = lists.find((list) => list.docId === selector.trim());
  if (byId !== undefined) return byId;

  const exact = lists.filter((list) => list.title.toLowerCase() === needle);
  if (exact.length === 1) return exact[0] as TodoList;
  if (exact.length > 1) throw ambiguous(selector, exact);

  const partial = lists.filter((list) => list.title.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0] as TodoList;
  if (partial.length > 1) throw ambiguous(selector, partial);

  throw new TodosRequestError(
    404,
    `no todo list matches “${selector}” — ${
      lists.length === 0
        ? "this workspace has none yet"
        : `try one of: ${lists.map((list) => list.title).join(", ")}`
    }`,
  );
}

function ambiguous(selector: string, candidates: readonly TodoList[]): TodosRequestError {
  return new TodosRequestError(
    400,
    `“${selector}” matches ${String(candidates.length)} lists (${candidates
      .map((list) => `${list.title} [${list.docId}]`)
      .join(", ")}) — name one exactly, or pass its id`,
  );
}

export interface ItemMutation {
  readonly docId: string;
  readonly index: number;
  readonly item: TodoItem | undefined;
}

/** `POST /api/x/todos/<docId>/items` — append one item. */
export async function addItem(
  context: PluginCommandContext,
  docId: string,
  text: string,
  due: string | undefined,
): Promise<ItemMutation> {
  const parsed = await request(context, `${docId}/items`, MutationSchema, {
    method: "POST",
    body: { text, ...(due === undefined ? {} : { due }) },
  });
  return { docId: parsed.docId, index: parsed.index, item: parsed.item };
}

export const MigrationSchema = z.object({
  /** Echoed by the route, so the JSON says for itself whether anything moved. */
  dryRun: z.boolean(),
  migrated: z.array(z.object({ docId: z.string(), title: z.string(), items: z.number() })),
  conflicts: z.array(z.object({ docId: z.string(), title: z.string(), reason: z.string() })),
  unchanged: z.number(),
});

export type Migration = z.infer<typeof MigrationSchema>;

/**
 * `POST /api/x/todos/migrate` — move pre-PLUGINS-005 lists into their bodies,
 * or, with `dryRun`, report exactly what a real run would do and write nothing.
 */
export async function migrateLists(
  context: PluginCommandContext,
  dryRun: boolean,
): Promise<Migration> {
  return await request(context, `migrate${dryRun ? "?dryRun=true" : ""}`, MigrationSchema, {
    method: "POST",
  });
}

/** `PUT /api/x/todos/<docId>/items/<index>` — set `done` on one item. */
export async function setDone(
  context: PluginCommandContext,
  docId: string,
  index: number,
  done: boolean,
  expectedText: string,
): Promise<ItemMutation> {
  const parsed = await request(context, `${docId}/items/${String(index)}`, MutationSchema, {
    method: "PUT",
    body: { done, expectedText },
  });
  return { docId: parsed.docId, index: parsed.index, item: parsed.item };
}
