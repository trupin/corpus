// Reading the §10 view keys and the open extra-frontmatter object out of a
// frontmatter mapping (SPEC.md §5, §10, §12; CONTRACT-011).
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

import { RESERVED_FRONTMATTER_KEYS, ViewQuerySchema, type ViewQuery } from "@corpus/contract";

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

/** `pinned` is a two-state key: the file says `true` or it does not (SPEC.md §10). */
export const readPinned = (data: Readonly<Record<string, unknown>>): boolean =>
  data["pinned"] === true;

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
 * A view's `column` reference (§9's `column_ref`), or `null`. Read verbatim and
 * never pattern-checked here: the format earns its `400` at the write boundary,
 * and a view whose `column` names something this build does not recognise must
 * keep its board position rather than silently become a plain list.
 */
export function readColumn(data: Readonly<Record<string, unknown>>): string | null {
  const value = data["column"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The five wire fields CONTRACT-011 added, read off one frontmatter mapping. */
export type ViewFrontmatter = {
  readonly pinned: boolean;
  readonly order: number | null;
  readonly query: ViewQuery | null;
  readonly column: string | null;
  readonly extra: Record<string, unknown>;
};

export const readViewFrontmatter = (data: Readonly<Record<string, unknown>>): ViewFrontmatter => ({
  pinned: readPinned(data),
  order: readOrder(data),
  query: readViewQuery(data),
  column: readColumn(data),
  extra: readExtraFrontmatter(data),
});
