import { COLUMN_REF_PATTERN, RESERVED_FRONTMATTER_KEYS, type ViewQuery } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import { parseTriStateBoolean } from "../../input.js";
import type { ParsedFlags } from "../../parse-args.js";
import type { FlagSpec } from "../../registry/types.js";

/**
 * The frontmatter-writing flags `doc create` and `doc edit` share: one value
 * grammar, one set of flag declarations, one refusal message per reserved key.
 *
 * It lives outside both verbs because both write the same keys and a second
 * grammar is the defect this module exists to prevent — CLI-016 published
 * `--extra`'s five rules in the flag's own description, and CLI-018's view
 * flags (SPEC.md §10) parse numbers and `null` for exactly the same reasons.
 * `edit.ts` re-exports the two functions its own tests drive, so the split is
 * invisible from outside.
 */

/**
 * The `--extra` value grammar (CLI-016, sprint-017 Adjudication 12). Total over
 * scalars: every input maps to exactly one JSON **scalar**, and the rules are
 * published in the flag's own description, which is what `docs/cli.md` carries.
 *
 * 1. `null` deletes the key — the server's `extra` patch is RFC 7386, so `null`
 *    removes rather than stores (`apps/server/src/docs/update.ts`).
 * 2. `true` / `false` are booleans.
 * 3. A **canonical, finite** JSON number literal is a number. Canonical matters:
 *    `007` and `1.` are not JSON numbers, so they stay strings and an identifier
 *    that happens to be digits is not silently arithmetic.
 * 4. A JSON **string literal** is its own contents — the escape hatch that lets
 *    `--extra note='"520"'` store the characters `520`, and the only way to
 *    store the literal text `null`.
 * 5. Everything else is the string exactly as typed, including the empty one.
 *
 * Numbers are rule 3 rather than an opt-in because the one promise this flag
 * exists to keep needs one: the board reads `extra.width` with
 * `typeof raw !== "number"` and falls back to its default for anything else
 * (`apps/ui/src/board/columnWidth.ts`), so `--extra width=520` storing `"520"`
 * would be a passing unit test and a column that never widens. `--order` is the
 * same bet on the same board (CLI-018, sprint-018 Adjudication 11) and reuses
 * this function rather than parsing a number of its own.
 *
 * **Finiteness is the load-bearing half of rule 3** (wave-3 audit, FIX 1).
 * `1e400` is a perfectly canonical JSON number literal whose double is
 * `Infinity`, `JSON.stringify` writes `Infinity` as `null`, and the server's
 * `extra` patch is RFC 7386 — so an overflowing number silently *deleted* the
 * key it was meant to set. Gating on `Number.isFinite` and falling through to
 * rule 5 is the `parse-args.ts` `readNumber` pattern, and it keeps the grammar
 * total in the sense that matters: the value is stored, as the characters that
 * were typed, rather than being turned into a deletion nobody asked for.
 *
 * A finite number too large to survive a `double` — `9007199254740993`, past
 * `Number.MAX_SAFE_INTEGER` — **is** taken as a number and does lose precision
 * on the way (it stores as `9007199254740992`). That is documented rather than
 * refused: it is exactly what every JSON parser in the stack would do to the
 * same literal, so refusing here would make the CLI stricter than the wire it
 * writes to, and the escape hatch for an exact-digits value already exists —
 * quote it (`--extra id='"9007199254740993"'`) and it stays a string.
 *
 * **Objects and arrays are deliberately out of this grammar** (SPEC 38,
 * adjudicated by CLI-018): a `{`-leading value is stored as the string it looks
 * like, and `--extra-json` is the flag that means "parse this as JSON". Two
 * meanings for one syntax would make every plugin key ambiguous; a second flag
 * is unambiguous and costs the caller three characters.
 */
export function parseExtraValue(raw: string): string | number | boolean | null {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (JSON_NUMBER.test(raw)) {
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
    // `1e400` and friends: a canonical literal, an infinite double. Rule 5.
  }
  const quoted = jsonStringLiteral(raw);
  return quoted ?? raw;
}

const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/**
 * Rule 4 on its own, because the query parser needs to ask the question rule 4
 * answers: a quoted value is verbatim, which is how a query value that contains
 * a comma escapes the OR-splitting below.
 */
function jsonStringLiteral(raw: string): string | undefined {
  if (!raw.startsWith('"')) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    // Not a JSON string literal after all — rule 5 takes it verbatim.
    return undefined;
  }
}

/**
 * Core keys that have a flag of their own. The **refusal** list is the
 * contract's `RESERVED_FRONTMATTER_KEYS` and is never hand-copied — this map
 * only makes the message actionable, so a key the contract adds tomorrow is
 * still refused, just with the generic hint.
 *
 * The four §10 view keys earn entries here the moment they earn flags
 * (CLI-018): before that, `--extra pinned=true` was refused with "core keys are
 * not user-writable through `--extra`" and nowhere to go, which is a refusal an
 * agent cannot act on.
 */
const FLAG_FOR_RESERVED_KEY: Readonly<Record<string, string>> = {
  title: "--title",
  status: "--status",
  due: "--due",
  reviewed: "--reviewed",
  evergreen: "--evergreen",
  tags: "--add-tag`/`--remove-tag",
  pinned: "--pinned",
  order: "--order",
  query: "--query",
  column: "--column",
};

const RESERVED_KEYS: ReadonlySet<string> = new Set(RESERVED_FRONTMATTER_KEYS);

/**
 * `--extra` may never name a core field. The contract already refuses one with a
 * `400` (`ExtraFrontmatterSchema`), and that backstop stays exactly where it is:
 * this guard is a **better error message**, not the enforcement. An agent gets
 * one chance to read a failure and act on it, and "use `--title`" is a next step
 * where a round-tripped validation issue is a puzzle.
 */
function assertWritableExtraKey(key: string): void {
  if (!RESERVED_KEYS.has(key)) return;
  const flag = FLAG_FOR_RESERVED_KEY[key];
  throw new UsageError(
    `\`${key}\` is a core frontmatter key, not an \`extra\` key — \`--extra ${key}=…\` is refused.`,
    {
      hint:
        flag === undefined
          ? `Core keys are not user-writable through \`--extra\`; \`extra\` may never shadow one.`
          : `Use \`${flag}\` instead.`,
    },
  );
}

/** Splits `key=value`, refusing the two shapes that name nothing. */
function splitPair(flag: string, entry: string, example: string): readonly [string, string] {
  const separator = entry.indexOf("=");
  if (separator === -1) {
    throw new UsageError(`${flag} takes \`key=value\` — got "${entry}", which has no \`=\`.`, {
      hint: `For example: ${example}.`,
    });
  }
  if (separator === 0) {
    throw new UsageError(`${flag} "${entry}" names no key.`, {
      hint: `The key comes before the \`=\`: ${example}.`,
    });
  }
  return [entry.slice(0, separator), entry.slice(separator + 1)];
}

/** `key=value` pairs into the merge patch the `PUT` carries, or nothing at all. */
export function parseExtraFlags(entries: readonly string[]): Record<string, unknown> | undefined {
  if (entries.length === 0) return undefined;

  const extra: Record<string, unknown> = {};
  for (const entry of entries) {
    const [key, value] = splitPair(
      "--extra",
      entry,
      "--extra width=520, or --extra width=null to remove the key",
    );
    assertWritableExtraKey(key);
    // Last one wins, like any repeated assignment; `--extra a=1 --extra a=2`
    // sends `a: 2` rather than failing on a contradiction the caller can see.
    extra[key] = parseExtraValue(value);
  }
  return extra;
}

/**
 * `--extra-json key=<json>` — SPEC 38's escape hatch, adjudicated by CLI-018
 * (sprint-018 TEST-639, outcome (a)).
 *
 * `extra` has carried objects and arrays on the wire since CONTRACT-011
 * (`EXTRA_MAX_DEPTH = 8`, and `todo.items` — an array of objects — is the
 * reference plugin's own shape), so the scalars-only limit was never the
 * contract's: it was `--extra`'s grammar, and a CLI-only agent stewarding a
 * plugin key that stores an object had no verb at all. Widening `--extra` to
 * parse `{`-leading values as JSON would have changed what a value already
 * stores today, so the escape hatch is a second flag instead.
 *
 * **Nothing is bounded here.** Depth and size are the contract's
 * (`EXTRA_MAX_DEPTH`, `EXTRA_MAX_BYTES`), enforced server-side over the whole
 * merged object — a second CLI-side limit could only ever disagree with it, and
 * would disagree about a document whose *other* keys it cannot see. The CLI's
 * one rule is that the text must be JSON at all, so a shell-quoting mistake is
 * a usage error before any request rather than a `400` about a string.
 *
 * `null` keeps its RFC 7386 meaning here too — `--extra-json k=null` deletes,
 * exactly like `--extra k=null`.
 */
export function parseExtraJsonFlags(
  entries: readonly string[],
): Record<string, unknown> | undefined {
  if (entries.length === 0) return undefined;

  const extra: Record<string, unknown> = {};
  for (const entry of entries) {
    const [key, value] = splitPair(
      "--extra-json",
      entry,
      `--extra-json publish='{"target":"blog","draft":true}'`,
    );
    assertWritableExtraKey(key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (cause) {
      throw new UsageError(
        `--extra-json ${key}=… is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        {
          hint: 'The value is parsed as JSON, so it needs its own quoting — shells eat double quotes: --extra-json publish=\'{"target":"blog"}\'. For a plain scalar, use --extra.',
        },
      );
    }
    extra[key] = parsed;
  }
  return extra;
}

/**
 * The two `extra` flags land in one merge patch. A key named by both is refused
 * rather than resolved: `ParsedFlags` keeps each flag's own order and not the
 * order they were typed in, so "last one wins" across two flags would depend on
 * which flag the parser happened to read first — a rule nobody could predict
 * from the command line they wrote.
 */
export function combineExtraPatches(
  scalars: Record<string, unknown> | undefined,
  objects: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (scalars === undefined) return objects;
  if (objects === undefined) return scalars;

  const collisions = Object.keys(objects).filter((key) => key in scalars);
  const [first] = collisions;
  if (first !== undefined) {
    throw new UsageError(
      `\`${first}\` is set by both \`--extra\` and \`--extra-json\` — one key, one value.`,
      { hint: `Drop whichever of the two you did not mean; ${collisions.join(", ")} collide.` },
    );
  }
  return { ...scalars, ...objects };
}

/**
 * The §10 view keys, parsed off the flags both verbs declare (CLI-018).
 *
 * A column **is** a `type: view` document with `pinned: true` — its frontmatter
 * holds the query and the board position — so "@agent pin me a view of
 * unresolved finance threads" is these four keys and nothing else. They are
 * core fields on the contract (`packages/contract/src/schemas/doc.ts`), already
 * accepted on `POST /api/docs` and `PUT /api/docs/{id}`; the whole of this
 * issue is the verb surface over them.
 *
 * Returned un-annotated on purpose, like `edit.ts`'s patch: the generated
 * request types use exact optional properties, so a `Partial`-shaped annotation
 * (`pinned?: boolean | undefined`) would not be assignable to them. The
 * spread-of-conditionals form produces exactly the shape the wire wants — a key
 * is present or it is not, and an absent key is "leave it alone" rather than
 * "clear it".
 */
export function parseViewFlags(flags: ParsedFlags) {
  const pinned = parseTriStateBoolean("pinned", flags.string("pinned"));
  const order = parseOrder(flags.string("order"));
  const query = parseQuery(flags.strings("query"));
  const column = parseColumn(flags.string("column"));

  return {
    ...(pinned === undefined ? {} : { pinned }),
    ...(order === undefined ? {} : { order }),
    ...(query === undefined ? {} : { query }),
    ...(column === undefined ? {} : { column }),
  };
}

/**
 * `order` must reach the file as a **YAML number** — the board sorts on it, and
 * a quoted `"1"` is a green unit test and a column in the wrong place (the
 * mistake CLI-016 nearly shipped with `extra.width`). So the grammar is
 * `parseExtraValue`'s, and anything that does not come back a number — a
 * non-canonical literal, an overflowing one, a word — is a usage error here
 * rather than a `400` naming a type.
 */
export function parseOrder(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  const value = parseExtraValue(raw);
  if (value === null || typeof value === "number") return value;
  throw new UsageError(`--order takes a finite number or \`null\` — got "${raw}".`, {
    hint: "The board sorts columns on this number, so it has to be one: `--order 4`, `--order 1.5` to land between two neighbours without renumbering them, or `--order null` to drop the key and take the documented tiebreak (nulls last, then title, then id).",
  });
}

/**
 * `column` is a plugin column reference, `"<plugin>/<type>"` — the shape
 * `COLUMN_REF_PATTERN` pins, imported rather than re-typed.
 *
 * The check is about the **shape** and never about whether the plugin is
 * installed: a view referencing an uninstalled plugin keeps its board position
 * and renders the plugin-missing card (SPEC.md §12 M6), which is the behaviour
 * that makes a plugin removable. `null` clears the key; no legal reference can
 * be the word `null`, since every reference carries a slash.
 */
export function parseColumn(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "null") return null;
  if (!COLUMN_REF_PATTERN.test(raw)) {
    throw new UsageError(`--column takes \`<plugin>/<type>\` — got "${raw}".`, {
      hint: "Exactly one slash, no whitespace: `--column todos/todos`. A plugin that is not installed is still a legal reference — the column keeps its place and renders a plugin-missing card. `--column null` makes it a plain filtered list again.",
    });
  }
  return raw;
}

type QueryValue = ViewQuery[string];
type QueryScalar = Exclude<QueryValue, readonly unknown[]>;

/**
 * The stored board query: a **flat** map from `GET /api/docs` parameter names to
 * a scalar or an array of scalars, where an array ORs (`{type: ["note","view"]}`
 * ≡ `type=note,view` on the wire).
 *
 * Two decisions the flag's description publishes rather than leaving to be
 * discovered (sprint-018 TEST-636):
 *
 * - **Naming any key replaces the whole map.** `query` is one core field, not
 *   an RFC 7386 sub-object like `extra`, so the server stores what it is sent;
 *   a merge would be a read-modify-write this verb deliberately does not do.
 * - **`--query null` clears the key**, which `UpdateDocRequestSchema` gives a
 *   meaning to and nothing else could reach. It cannot be combined with pairs,
 *   because "clear it and also set these" is two contradictory instructions.
 *
 * A `{`- or `[`-leading value is refused before any request: the map is flat,
 * and the alternative — storing the literal characters, which is what
 * `parseExtraValue` would do — is a query key whose value silently never
 * matches anything.
 */
export function parseQuery(entries: readonly string[]): ViewQuery | null | undefined {
  if (entries.length === 0) return undefined;
  if (entries.includes("null")) {
    if (entries.length > 1) {
      throw new UsageError("`--query null` clears the whole query, so it takes no other pairs.", {
        hint: "Clear it, or set it — not both in one command.",
      });
    }
    return null;
  }

  const query: Record<string, QueryValue> = {};
  for (const entry of entries) {
    const [key, raw] = splitPair(
      "--query",
      entry,
      "--query type=thread, or --query null to clear the whole query",
    );
    query[key] = parseQueryValue(key, raw);
  }
  return query;
}

function parseQueryValue(key: string, raw: string): QueryValue {
  if (raw.startsWith("{") || raw.startsWith("[")) {
    throw new UsageError(
      `--query ${key}=… : a board query is a flat map, so its values are not objects or arrays.`,
      {
        hint: "Repeat the flag for more keys (`--query type=thread --query status=open`), and use a comma for an OR (`--query type=note,view`).",
      },
    );
  }

  // A quoted value is verbatim, which is the escape hatch for a search string
  // that contains a comma: `--query q='"salt, pepper"'` is one value, not two.
  const quoted = jsonStringLiteral(raw);
  if (quoted !== undefined) return quoted;

  if (!raw.includes(",")) return queryScalar(key, raw);
  return raw.split(",").map((part) => {
    if (part === "") {
      throw new UsageError(`--query ${key}=${raw} has a blank entry.`, {
        hint: "A comma separates alternatives, so every entry between two commas has to be one.",
      });
    }
    return queryScalar(key, part);
  });
}

function queryScalar(key: string, raw: string): QueryScalar {
  const value = parseExtraValue(raw);
  if (value === null) {
    throw new UsageError(`--query ${key}=null is not a filter.`, {
      hint: "A `GET /api/docs` parameter has no null value: leave the key out of the query, or pass `--query null` to clear the whole thing.",
    });
  }
  // Once `null` is out, `parseExtraValue`'s return type *is* the query scalar:
  // a boolean, a finite number, or the string as typed.
  return value;
}

/**
 * One declaration of the four view flags, shared by `doc create` and `doc edit`
 * so the two verbs cannot describe the same frontmatter key differently — the
 * registry's own rule (SPEC.md §2.3), applied inside a command's flag list.
 *
 * The descriptions cover both verbs because the wire does: on create a `null`
 * is the same as omitting the flag, and on edit it clears the key from the file.
 */
export const VIEW_KEY_FLAGS: readonly FlagSpec[] = [
  {
    name: "pinned",
    type: "string",
    valueName: "true|false",
    description:
      "Pin this document to the board as a column, or unpin it (SPEC.md §10 — **a column IS a " +
      "`type: view` document with `pinned: true`**). Takes an explicit value, like `--evergreen`: " +
      "omitting the flag leaves the field alone, `--pinned false` removes the column. The board " +
      "picks the change up over SSE with no reload. Note this is the **write** side of `doc list " +
      "--pinned`, which is a filter and therefore a plain boolean.",
  },
  {
    name: "order",
    type: "string",
    valueName: "number|null",
    description:
      "Board position of a pinned view, ascending. Any **finite** number: `--order 1.5` lands a " +
      "column between its neighbours without renumbering them, which is what the shipped tiebreak " +
      "(`order` with nulls last, then title, then id) exists for. `--order null` drops the key. " +
      "It reaches the file as a YAML number — the board sorts on it — so a value that is not one " +
      "is a usage error here rather than a column in the wrong place.",
  },
  {
    name: "query",
    type: "string",
    valueName: "key=value",
    repeated: true,
    description:
      "One key of the view's stored board query, repeatably — a **flat** map from `GET /api/docs` " +
      "parameter names (`type`, `status`, `tag`, `folder`, `needs`, `q`, `sort`, …) to a value. A " +
      "comma is an OR (`--query type=note,view` ≡ `type=note,view` on the wire); quote a value to " +
      "keep a comma in it (`--query q='\"salt, pepper\"'`). Values follow `--extra`'s grammar minus " +
      "`null`: `true`/`false` are booleans, a canonical finite number is a number, everything else " +
      "is the string as typed. **Naming any key replaces the whole query** — `query` is one core " +
      "field, not a merge patch — and `--query null` clears it. An object or array value is a " +
      "usage error: the map is flat.",
  },
  {
    name: "column",
    type: "string",
    valueName: "plugin/type",
    description:
      "Render this pinned view as a plugin column type (SPEC.md §10), e.g. `--column todos/todos`; " +
      "`--column null` makes it a plain filtered list again. Exactly one slash, no whitespace. The " +
      "check is about the shape only — a reference to a plugin that is **not installed** is legal " +
      "and keeps its board position, rendering the plugin-missing card (SPEC.md §12).",
  },
];
