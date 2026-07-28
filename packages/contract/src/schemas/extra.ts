import { z } from "@hono/zod-openapi";

/**
 * The **open extra-frontmatter surface** (CONTRACT-011, adjudicated 2026-07-27).
 *
 * SPEC.md §5 promises that "plugins may add fields under their own keys" and
 * §12's reference plugin cashes that promise (`todo` documents carry
 * `items: [{ text, done, ts }]`). This module is that promise reaching the
 * wire: one object, `extra`, carried on every document row, on the single
 * document read, and on create/update requests, holding **every frontmatter
 * key that is not a core key** — flat, exactly as the keys sit in the file.
 * The object itself is the namespace; there is no per-plugin sub-nesting,
 * because the file has none: on disk a plugin key is simply a YAML key beside
 * the core ones, and the wire mirrors the file (the file is the source of
 * truth, and this surface must round-trip it).
 *
 * The server **stores and returns these keys and never interprets them**.
 * Meaning belongs to whoever owns the key — a plugin's own schema (the
 * `validate` extension point, SPEC.md §10), never this contract. That is the
 * whole design: a new plugin doc type is *zero* contract changes.
 *
 * Core keys, by contrast, stay closed and validated where they always were.
 * §11's view keys (`pinned`, `order`, `query`, `column`) are deliberately
 * **not** in here — they graduated to first-class core fields (see `doc.ts`),
 * because two of them are server semantics (`pinned` is a filter, `order` is a
 * sort, and a key the server filters and sorts on is by definition not opaque)
 * and because keeping them out preserves this object's one absolute rule:
 * nothing in it ever means anything to the server.
 */

/**
 * The closed set of core frontmatter keys (SPEC.md §5 base fields, §6 thread
 * fields, §11 view fields). A key in `extra` naming one of these is rejected
 * with `400`, on requests and by construction on responses — so a core field
 * can never be shadowed, duplicated, or smuggled past its own validation.
 *
 * The match is exact and case-sensitive, because YAML keys are: `Title` is a
 * genuinely different key on disk and therefore a legal extra key. `extra`
 * itself is deliberately absent — it is a wire envelope, not a disk key, so a
 * file's literal `extra:` key simply rides inside it (`extra: { extra: … }`)
 * and collides with nothing.
 *
 * `extra.test.ts` pins this list against the actual doc and thread schemas, so
 * a core key added elsewhere without a matching entry here fails a test.
 */
export const RESERVED_FRONTMATTER_KEYS = [
  // SPEC.md §5 — every document
  "id",
  "type",
  "title",
  "created",
  "updated",
  "tags",
  "status",
  "anchors",
  "due",
  "reviewed",
  "evergreen",
  // SPEC.md §6 — thread documents
  "parent",
  "anchor",
  "agent",
  // SPEC.md §11 — view documents (first-class core keys, see doc.ts)
  "pinned",
  "order",
  "query",
  "column",
] as const;

const RESERVED_KEY_SET: ReadonlySet<string> = new Set(RESERVED_FRONTMATTER_KEYS);

/**
 * Maximum container nesting of a single extra value, counting the value's own
 * arrays and objects but not the `extra` object itself. `todo.items` — an
 * array of objects of scalars — is depth 2; the bound leaves plugins ample
 * structural headroom while keeping a document's frontmatter a record, not a
 * database.
 */
export const EXTRA_MAX_DEPTH = 8;

/** Maximum JSON-serialized size of a document's whole `extra` object, in UTF-8 bytes. */
export const EXTRA_MAX_BYTES = 64 * 1024;

/**
 * A legal extra value: plain JSON as YAML can carry it — `null`, strings,
 * finite numbers, booleans, arrays, and plain objects, recursively. Not a
 * wire type (the schema types values as `unknown`, since their meaning is the
 * key owner's); exported for consumers that build extra values in TypeScript.
 */
export type ExtraValue =
  null | string | number | boolean | readonly ExtraValue[] | { readonly [key: string]: ExtraValue };

const EXTRA_DESCRIPTION =
  "Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat " +
  "and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` " +
  "document's `items`). The server stores and returns these keys and **never interprets them**; " +
  "meaning belongs to the key's owner (a plugin's own schema), never to this contract. " +
  `Keys must not name a core frontmatter key (${RESERVED_FRONTMATTER_KEYS.join(", ")}) — such a ` +
  "request is rejected with `400`, exact and case-sensitive, so a core field can never be " +
  "shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) " +
  `nested at most ${EXTRA_MAX_DEPTH} containers deep, at most ${EXTRA_MAX_BYTES} UTF-8 bytes ` +
  "serialized per document; the bounds are enforced at the write boundary. **On update the " +
  "object is a shallow merge patch** (RFC 7386, applied at the top level): each named key " +
  "replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte " +
  "— omit the field to leave every extra key alone, and never read-modify-write the whole " +
  "object, which would race concurrent writers of other keys. On create, keys are written into " +
  "the new file's frontmatter and a `null` value is a no-op. **Responses always carry the " +
  "object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned " +
  "as `null` and is therefore removed if echoed back through an update.";

type IssueContext = {
  addIssue: (issue: { code: "custom"; message: string; path?: PropertyKey[] }) => void;
};

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Walks one extra value, reporting everything that is not plain, bounded JSON.
 * Returns false when any issue was raised, so the caller can skip the size
 * check (`JSON.stringify` throws on bigints and silently drops the rest).
 */
const checkValue = (
  value: unknown,
  path: PropertyKey[],
  depth: number,
  ctx: IssueContext,
): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return true;
    ctx.addIssue({ code: "custom", path, message: "Extra values must be finite numbers." });
    return false;
  }
  if (value === undefined) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "`undefined` is not a YAML value; use `null` to remove a key.",
    });
    return false;
  }
  if (Array.isArray(value)) {
    if (depth >= EXTRA_MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `Extra values nest at most ${EXTRA_MAX_DEPTH} containers deep.`,
      });
      return false;
    }
    let ok = true;
    for (const [index, item] of value.entries()) {
      ok = checkValue(item, [...path, index], depth + 1, ctx) && ok;
    }
    return ok;
  }
  if (typeof value === "object" && isPlainObject(value)) {
    if (depth >= EXTRA_MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `Extra values nest at most ${EXTRA_MAX_DEPTH} containers deep.`,
      });
      return false;
    }
    let ok = true;
    for (const [key, item] of Object.entries(value)) {
      ok = checkValue(item, [...path, key], depth + 1, ctx) && ok;
    }
    return ok;
  }
  ctx.addIssue({
    code: "custom",
    path,
    message:
      "Extra values are plain JSON: null, strings, finite numbers, booleans, arrays and plain objects.",
  });
  return false;
};

/**
 * The `extra` object itself. Deliberately **not** a registered OpenAPI
 * component: it is inlined at every use so each carries the full contract in
 * place, and so no derived form can ever rewrite a shared component definition
 * (see the non-nullable-component invariant in `openapi.test.ts`).
 *
 * Values are typed `unknown` on purpose — the contract polices *shape bounds*
 * (plain JSON, depth, size) and *key collisions*, never meaning. A plugin
 * validates its own keys with its own Zod schema (SPEC.md §10 `validate`),
 * which is what keeps a new plugin doc type at zero contract changes.
 */
export const ExtraFrontmatterSchema = z
  .record(z.string().min(1), z.unknown())
  .superRefine((extra, ctx) => {
    let ok = true;
    for (const [key, value] of Object.entries(extra)) {
      if (RESERVED_KEY_SET.has(key)) {
        ok = false;
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `\`${key}\` is a core frontmatter key; core keys cannot be set or shadowed through \`extra\`.`,
        });
        continue;
      }
      ok = checkValue(value, [key], 0, ctx) && ok;
    }
    if (!ok) return;
    const bytes = new TextEncoder().encode(JSON.stringify(extra)).length;
    if (bytes > EXTRA_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `\`extra\` serializes to ${String(bytes)} bytes; the bound is ${String(EXTRA_MAX_BYTES)}.`,
      });
    }
  })
  .openapi({ description: EXTRA_DESCRIPTION });

export type ExtraFrontmatter = z.infer<typeof ExtraFrontmatterSchema>;
