// Reading the §10 view keys and the open extra-frontmatter object out of a
// frontmatter mapping (SPEC.md §5, §10; CONTRACT-011).
//
// One module, because two very different consumers must answer identically
// about the same file: the projection (`documents` rows, and therefore
// `GET /api/docs`) and the single-document read (`GET /api/docs/{id}` and every
// mutation response). CONTRACT-005's nullable-timestamp bug was exactly that
// disagreement — one file read two ways through two routes — and the contract
// now shares the field definitions between the list row and the single read for
// the same reason. Sharing the *reader* is the server-side half of that.
//
// Nothing here interprets an extra key. The contract's promise is absolute:
// "the server stores and returns these keys and never interprets them". This
// module only decides what is *representable* on the wire.

import { z } from "@hono/zod-openapi";
import {
  DocumentIdSchema,
  KanbanSchema,
  RESERVED_FRONTMATTER_KEYS,
  ViewQuerySchema,
  type Kanban,
  type ViewQuery,
} from "@corpus/contract";

/**
 * A board's `columns` as the contract declares it — the list of view ids, in
 * order. Built here rather than exported by the contract because the contract
 * spells it inline on three request/response shapes and the *reader* needs the
 * bare array schema; the element type is the contract's own, which is the part
 * that must not drift.
 */
const ColumnsSchema = z.array(DocumentIdSchema);

/**
 * Core frontmatter keys, as the contract enumerates them. Imported rather than
 * restated: a key added to one list and not the other would silently start
 * leaking a core field into `extra`, which is precisely what
 * `RESERVED_FRONTMATTER_KEYS` exists to make impossible.
 */
const RESERVED: ReadonlySet<string> = new Set<string>(RESERVED_FRONTMATTER_KEYS);

/**
 * How deep a value may nest before this reader gives up on it. The contract's
 * own bound (`EXTRA_MAX_DEPTH`) is enforced at the *write* boundary; the cap
 * here is a **safety** cap on the read path, and it is not optional: YAML
 * anchors can build a value that refers to its own ancestor, and a cyclic value
 * would otherwise recurse — or serialize — forever on a request thread.
 *
 * It is deliberately the same number, so a value this reader drops is exactly a
 * value no create or update could ever have written.
 */
export const MAX_EXTRA_READ_DEPTH = 8;

/**
 * A converted value, or the fact that there is none. A sentinel *value* would
 * be indistinguishable from a legitimate one at the type level (extra
 * frontmatter is all `unknown`), so the answer is carried in the shape.
 */
type Converted = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/** A value with no faithful JSON form; its key is dropped rather than lied about. */
const UNREPRESENTABLE: Converted = { ok: false };

const kept = (value: unknown): Converted => ({ ok: true, value });

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * One frontmatter value as plain JSON, or {@link UNREPRESENTABLE}.
 *
 * Dropping beats coercing. `NaN` is not `null`, a `Map` from a YAML complex key
 * is not an object, and a value 40 containers deep is not a truncated one — and
 * because the wire says "a hand-edited `key: null` on disk is returned as
 * `null` and is therefore removed if echoed back through an update", inventing
 * a `null` here would invite a client to delete a key it never saw.
 */
function toJsonValue(value: unknown, depth: number): Converted {
  if (value === null || typeof value === "string" || typeof value === "boolean") return kept(value);
  if (typeof value === "number") return Number.isFinite(value) ? kept(value) : UNREPRESENTABLE;
  // YAML 1.2's core schema keeps timestamps as strings, but an explicit
  // `!!timestamp` tag still yields a `Date`. Its ISO form is what the file
  // means and what every other date on the wire looks like.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? UNREPRESENTABLE : kept(value.toISOString());
  }
  if (typeof value !== "object") return UNREPRESENTABLE;
  if (depth >= MAX_EXTRA_READ_DEPTH) return UNREPRESENTABLE;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const converted = toJsonValue(item, depth + 1);
      if (!converted.ok) return UNREPRESENTABLE;
      items.push(converted.value);
    }
    return kept(items);
  }
  if (!isPlainObject(value)) return UNREPRESENTABLE;
  const object: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const converted = toJsonValue(item, depth + 1);
    if (!converted.ok) return UNREPRESENTABLE;
    object[key] = converted.value;
  }
  return kept(object);
}

/**
 * Every frontmatter key that is not a core key, flat and verbatim — the wire's
 * `extra` object (CONTRACT-011), mirroring the file, which carries extra keys
 * beside the core ones with no sub-namespacing of its own (SPEC.md §9's opaque
 * passthrough: the server never interprets what is in here).
 *
 * `{}` when the file has nothing but core keys; the object is always present on
 * a response, never optional.
 */
export function readExtraFrontmatter(
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (RESERVED.has(key)) continue;
    const converted = toJsonValue(value, 0);
    if (!converted.ok) continue;
    extra[key] = converted.value;
  }
  return extra;
}

/**
 * **The frontmatter key is `default-open`; `defaultOpen` is its wire spelling**
 * (CONTRACT-074). A two-state key: the file says `true` or it does not, so
 * absent and `false` are one state and nothing has to tell them apart.
 *
 * The wire spelling is *reserved* beside the file one (`extra.ts`) but is never
 * read here: a document whose YAML says `defaultOpen: true` carries a key the
 * core does not define under a name it refuses to route into `extra`, which is
 * exactly the "you spelled it the wire way" state, and reading it would make the
 * two spellings interchangeable on disk.
 */
export const readDefaultOpen = (data: Readonly<Record<string, unknown>>): boolean =>
  data["default-open"] === true;

/**
 * `stage` as a string, or `null` when the file carries no usable one (SPEC.md
 * §5).
 *
 * **A comma is not refused here.** The write boundary refuses one
 * (`StageValueSchema`, and `docs/create.ts` / `docs/update.ts` name the filter in
 * the message), because a stage carrying the `stage=` separator could never be
 * filtered for. A *read* reports what the file holds: a hand-edited stage with a
 * comma in it is a document a person must be able to see and repair, and hiding
 * it would leave them editing a value no reader ever showed them.
 */
export function readStage(data: Readonly<Record<string, unknown>>): string | null {
  const value = data["stage"];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A board's `columns` — the ids of the `type: view` documents it renders, in
 * display order (SPEC.md §10, rider 2) — or `null` when the file carries no
 * usable list.
 *
 * Parsed with the contract's own id schema for the reason {@link readViewQuery}
 * documents: a hand-edited `columns: [1, 2]` reads as "no columns" rather than
 * as a value the response schema cannot describe. An entry that is not a
 * document id makes the **whole** key unusable rather than being dropped
 * quietly — a board silently missing one column is a board a person cannot tell
 * from a board that never had it.
 */
export function readColumns(data: Readonly<Record<string, unknown>>): string[] | null {
  const value = data["columns"];
  if (value === undefined || value === null) return null;
  const parsed = ColumnsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * A board's `kanban` block (SPEC.md §10, rider 6), or `null` when the file
 * carries no well-formed one.
 *
 * The contract's own strict schema decides, so the block a reader is shown is
 * the block the write boundary would have accepted — and a hand-edited graph
 * naming a stage the board does not declare reads as "no kanban" rather than as
 * a board whose columns cannot be drawn. That tolerance is the read path's, not
 * the write path's: `POST /api/docs` and `PUT /api/docs/{id}` refuse the same
 * bytes with a `400` naming the field.
 */
export function readKanban(data: Readonly<Record<string, unknown>>): Kanban | null {
  const value = data["kanban"];
  if (value === undefined || value === null) return null;
  const parsed = KanbanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * `order` as a number, or `null` when the file carries no usable one. Any finite
 * number is legal so a reorder can write a midpoint between two neighbours
 * instead of renumbering every column.
 */
export function readOrder(data: Readonly<Record<string, unknown>>): number | null {
  const value = data["order"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The stored board query, or `null`. Parsed with the contract's own schema so
 * the shape a client receives is the shape the contract declares — a
 * hand-edited `query: [1, 2]` reads as "no query" rather than as a value the
 * response schema cannot describe. The server still never *interprets* it: the
 * client compiles it into the collection query (CONTRACT-011).
 */
export function readViewQuery(data: Readonly<Record<string, unknown>>): ViewQuery | null {
  const value = data["query"];
  if (value === undefined || value === null) return null;
  const parsed = ViewQuerySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The view and board wire fields, read off one frontmatter mapping — the exact
 * set `viewAndBoardFrontmatterShape` publishes on both the list row and the
 * single read (CONTRACT-011, widened to the board keys by CONTRACT-074).
 *
 * Five, not four: `order` and `query` are a view's or a board's, and `columns`,
 * `kanban` and `defaultOpen` are a board's own. Two keys that used to be here
 * are gone rather than deprecated — `column` named a plugin renderer
 * (SHARED-066) and `pinned` put a view on the board (rider 2, 2026-08-22) — and
 * neither has a reader any more. That absence is what routes an old file's
 * `column:` or `pinned:` into `extra`: the keys are no longer reserved, so
 * {@link readExtraFrontmatter} keeps them verbatim and the server never looks at
 * them again, until `corpus upgrade` names the migration that drops them
 * (SPEC.md §2.4, CLI-061).
 *
 * **`stage` is deliberately not in here.** It is a §5 field carried by every
 * document, not a view or board key, and the contract declares it at the top
 * level of both response shapes — so it is read beside this object rather than
 * inside it ({@link readStage}).
 */
export type BoardFrontmatter = {
  readonly order: number | null;
  readonly query: ViewQuery | null;
  readonly columns: string[] | null;
  readonly kanban: Kanban | null;
  readonly defaultOpen: boolean;
  readonly extra: Record<string, unknown>;
};

export const readBoardFrontmatter = (
  data: Readonly<Record<string, unknown>>,
): BoardFrontmatter => ({
  order: readOrder(data),
  query: readViewQuery(data),
  columns: readColumns(data),
  kanban: readKanban(data),
  defaultOpen: readDefaultOpen(data),
  extra: readExtraFrontmatter(data),
});
