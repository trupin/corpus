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

async function request(
  context: PluginCommandContext,
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<unknown> {
  const response = await fetch(`${context.workspace.baseUrl}/api/x/${TODOS_PLUGIN}/${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${context.workspace.token}`,
      [ACTOR_HEADER]: context.actor,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    throw new TodosRequestError(
      response.status,
      parsed.success
        ? parsed.data.message
        : `${init.method} /api/x/${TODOS_PLUGIN}/${path} failed (HTTP ${String(response.status)})`,
    );
  }
  return payload;
}

/** Every todo list in the workspace, items included — one request. */
export async function fetchLists(context: PluginCommandContext): Promise<readonly TodoList[]> {
  return ListsSchema.parse(await request(context, "lists")).lists;
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
  const parsed = MutationSchema.parse(
    await request(context, `${docId}/items`, {
      method: "POST",
      body: { text, ...(due === undefined ? {} : { due }) },
    }),
  );
  return { docId: parsed.docId, index: parsed.index, item: parsed.item };
}

/** `PUT /api/x/todos/<docId>/items/<index>` — set `done` on one item. */
export async function setDone(
  context: PluginCommandContext,
  docId: string,
  index: number,
  done: boolean,
  expectedText: string,
): Promise<ItemMutation> {
  const parsed = MutationSchema.parse(
    await request(context, `${docId}/items/${String(index)}`, {
      method: "PUT",
      body: { done, expectedText },
    }),
  );
  return { docId: parsed.docId, index: parsed.index, item: parsed.item };
}
