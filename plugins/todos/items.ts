import { z } from "zod";

/**
 * **The one module that knows what a todo item is.**
 *
 * SPEC.md §12 leaves the item format to the builder ("frontmatter `items` … or
 * markdown checkboxes in the body"). PLUGINS-002 pins it to frontmatter:
 * `items: [{ text, done, ts, due? }]`, carried on the wire inside the
 * document's open `extra` object (`@corpus/contract`'s `ExtraFrontmatter` —
 * the server stores it verbatim and never interprets it).
 *
 * Every other file in this plugin goes through here. The routes mutate items
 * with the functions below; the manifest's `validate` calls {@link readItems};
 * the four React components read items with {@link readItems} too and never
 * write them directly; the CLI verbs never see the format at all, because they
 * are thin clients over the routes. One parser, one serializer, one set of
 * error messages — which is what makes the format decision enforceable rather
 * than aspirational.
 *
 * The issue's Technical Design named this module `server/items.ts`. It sits at
 * the plugin root instead because the **UI must read the same shape**: a
 * `server/` module imported by four React components reads as a layering
 * mistake, and a second reader written for the UI is exactly the drift the
 * single-owner rule exists to prevent. Nothing in here touches the filesystem,
 * the network or React — it is data, in and out.
 *
 * **Absent `items` is an empty list** (sprint-014 Adjudication 17). Template
 * pre-fill is body-only (SPEC.md §11), so no seed can supply `items: []`; a
 * hand-written todo document, or one whose key was deleted, is the same state.
 * Treating absence as empty everywhere is strictly more robust than seeding,
 * and it is why no scoped-template-key mechanism is needed here.
 */

/** The frontmatter key this plugin owns, named once. */
export const ITEMS_KEY = "items";

/** An ISO calendar date, `YYYY-MM-DD` — the only shape `due` may take. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const IsoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO-8601 instant");

export const TodoItemSchema = z.object({
  text: z.string().min(1, "must be a non-empty string"),
  done: z.boolean(),
  /**
   * **Creation** time, never completion time. A toggle must leave it
   * byte-identical, which is what lets a list keep a stable order across any
   * number of check/uncheck cycles.
   */
  ts: IsoDateTimeSchema,
  /** Optional deadline; the only optional field in v1. */
  due: z.string().regex(ISO_DATE_PATTERN, "must be an ISO calendar date (YYYY-MM-DD)").optional(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoItemsSchema = z.array(TodoItemSchema);

/** What {@link readItems} answers: the items, or why they could not be read. */
export type ItemsRead =
  | { readonly ok: true; readonly items: readonly TodoItem[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** `items[2].done: expected boolean` — a message that names the offending field. */
function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path
    .map((segment) =>
      typeof segment === "number" ? `[${String(segment)}]` : `.${String(segment)}`,
    )
    .join("");
  return `${ITEMS_KEY}${path}: ${issue.message}`;
}

/** The document shape this module needs — a `Doc`'s frontmatter, or a list row's. */
export interface ItemsCarrier {
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Reads `items` off already-parsed extra frontmatter.
 *
 * Absent, `null` and `[]` are the same answer: an empty list. Anything else
 * that is not a well-formed array of items is a *readable* failure, not a
 * throw — the View degrades to a notice plus the raw markdown, and a mutating
 * route refuses to write over a shape it cannot understand.
 */
export function readItems(carrier: ItemsCarrier | undefined): ItemsRead {
  const raw = carrier?.extra?.[ITEMS_KEY];
  if (raw === undefined || raw === null) return { ok: true, items: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      problems: [`${ITEMS_KEY}: must be a list of items; found ${typeof raw}`],
    };
  }
  const parsed = TodoItemsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map(describeIssue) };
  }
  return { ok: true, items: parsed.data };
}

/**
 * The items, or `[]` for a document whose `items` cannot be read.
 *
 * The list-row surfaces (`ListItem`, the aggregate column) render across many
 * documents at once, where one malformed document must degrade to "no items"
 * rather than to a notice in someone else's row. The `View` and `DocPanel`,
 * which are *about* one document, use {@link readItems} and surface the
 * problems.
 */
export function itemsOrEmpty(carrier: ItemsCarrier | undefined): readonly TodoItem[] {
  const read = readItems(carrier);
  return read.ok ? read.items : [];
}

/**
 * The manifest's `validate` answer: what is wrong with this document's items,
 * empty when nothing is (SPEC.md §10 — a plugin validates its own `extra`).
 */
export function itemProblems(carrier: ItemsCarrier | undefined): readonly string[] {
  const read = readItems(carrier);
  return read.ok ? [] : read.problems;
}

/** Serializes items back into an `extra` patch value — `due` omitted when absent. */
export function serializeItems(items: readonly TodoItem[]): readonly Record<string, unknown>[] {
  return items.map((item) => ({
    text: item.text,
    done: item.done,
    ts: item.ts,
    ...(item.due === undefined ? {} : { due: item.due }),
  }));
}

/**
 * A refusal to mutate, carrying the status a route should answer with.
 *
 * `409` is reserved for the one case that is not the caller's fault: the item
 * at that index is no longer the one the caller was looking at.
 */
export class TodoItemError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TodoItemError";
  }
}

function requireIndex(items: readonly TodoItem[], index: number): TodoItem {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new TodoItemError(
      400,
      `item index ${String(index)} is out of range — this list has ${String(items.length)} item${
        items.length === 1 ? "" : "s"
      }`,
    );
  }
  // Bounds are checked immediately above, so the element is present.
  return items[index] as TodoItem;
}

/**
 * The optimistic-concurrency guard. Index addressing is cheap and stable for
 * the life of a render, but a concurrent `check` or `delete` shifts it — so
 * every write may carry the text it believes is at that index, and a mismatch
 * is refused rather than applied to whatever moved into place.
 */
function requireMatch(item: TodoItem, index: number, expectedText: string | undefined): void {
  if (expectedText === undefined || expectedText === item.text) return;
  throw new TodoItemError(
    409,
    `item ${String(index)} is now “${item.text}”, not “${expectedText}” — it changed under you; ` +
      "nothing was written",
  );
}

export interface AppendInput {
  readonly text: string;
  /** Creation instant, supplied by the caller's clock — never read from here. */
  readonly ts: string;
  readonly due?: string | undefined;
}

/** Appends one item. New items are always open; `ts` is their creation time. */
export function appendItem(items: readonly TodoItem[], input: AppendInput): readonly TodoItem[] {
  const parsed = TodoItemSchema.safeParse({
    text: input.text,
    done: false,
    ts: input.ts,
    ...(input.due === undefined ? {} : { due: input.due }),
  });
  if (!parsed.success) {
    throw new TodoItemError(400, parsed.error.issues.map(describeIssue).join("; "));
  }
  return [...items, parsed.data];
}

export interface UpdateInput {
  /** Absent leaves `done` alone; present sets it. */
  readonly done?: boolean | undefined;
  /** Absent leaves the label alone; present renames the item. */
  readonly text?: string | undefined;
  /** `null` clears the deadline; a date sets it; absent leaves it alone. */
  readonly due?: string | null | undefined;
  /** The text the caller believes is at `index`; a mismatch is a 409. */
  readonly expectedText?: string | undefined;
}

/**
 * Updates one item in place. `ts` is copied through untouched — a toggle is not
 * a creation, and the ordering a list has depends on that staying true.
 */
export function updateItem(
  items: readonly TodoItem[],
  index: number,
  input: UpdateInput,
): readonly TodoItem[] {
  const current = requireIndex(items, index);
  requireMatch(current, index, input.expectedText);

  const dueAfter = input.due === undefined ? current.due : (input.due ?? undefined);
  const parsed = TodoItemSchema.safeParse({
    text: input.text ?? current.text,
    done: input.done ?? current.done,
    ts: current.ts,
    ...(dueAfter === undefined ? {} : { due: dueAfter }),
  });
  if (!parsed.success) {
    throw new TodoItemError(400, parsed.error.issues.map(describeIssue).join("; "));
  }
  return items.map((item, at) => (at === index ? parsed.data : item));
}

/** Removes exactly one item; every other item survives byte-for-byte. */
export function removeItem(
  items: readonly TodoItem[],
  index: number,
  expectedText?: string,
): readonly TodoItem[] {
  const current = requireIndex(items, index);
  requireMatch(current, index, expectedText);
  return items.filter((_item, at) => at !== index);
}

/**
 * Resolves an index-or-text selector against a list — what `corpus todos check`
 * accepts so the agent can say "the passport one" instead of counting rows.
 *
 * A numeric selector is **1-based** at the CLI boundary (the same numbering
 * `corpus todos list` prints) and returns a 0-based index. Text matching is
 * case-insensitive and exact; ambiguity is refused with the candidates named,
 * because guessing which duplicate the user meant is how the wrong thing gets
 * checked off.
 */
export function resolveSelector(items: readonly TodoItem[], selector: string): number {
  const trimmed = selector.trim();
  if (/^\d+$/.test(trimmed)) {
    const oneBased = Number.parseInt(trimmed, 10);
    if (oneBased < 1 || oneBased > items.length) {
      throw new TodoItemError(
        400,
        `no item ${trimmed} — this list has ${String(items.length)} item${
          items.length === 1 ? "" : "s"
        }`,
      );
    }
    return oneBased - 1;
  }

  const needle = trimmed.toLowerCase();
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.text.toLowerCase() === needle);
  if (matches.length === 1) return matches[0]?.index ?? 0;
  if (matches.length === 0) {
    throw new TodoItemError(400, `no item matches “${trimmed}”`);
  }
  throw new TodoItemError(
    400,
    `“${trimmed}” matches ${String(matches.length)} items (${matches
      .map(({ index }) => String(index + 1))
      .join(", ")}) — pass the number instead`,
  );
}

/** Items still to do. The aggregate column and the panel are built on this. */
export function openItems(items: readonly TodoItem[]): readonly TodoItem[] {
  return items.filter((item) => !item.done);
}

/** How many open items carry a deadline — the design's `2 due` row badge. */
export function dueCount(items: readonly TodoItem[]): number {
  return openItems(items).filter((item) => item.due !== undefined).length;
}

/** An open item whose deadline has passed — the design's overdue treatment. */
export function isOverdue(item: TodoItem, today: Date): boolean {
  if (item.done || item.due === undefined) return false;
  return item.due < today.toISOString().slice(0, 10);
}
