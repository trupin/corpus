import {
  KanbanSchema,
  RESERVED_FRONTMATTER_KEYS,
  UNSETTABLE_EXCLUSIONS,
  ViewQuerySchema,
  type ViewQuery,
} from "@corpus/contract";
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
 *
 * **The view flags became board flags on 2026-08-22** (CLI-060, rider 2 signed
 * the same day). `--pinned` is gone rather than deprecated: a view document is a
 * saved query and nothing more, and what puts a column on a board is the
 * **board's** own `columns` list. `--order` survives with a different meaning —
 * a board's position among boards, never a column's place — and `--columns`,
 * `--kanban`, `--default-open` and `--stage` join it.
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
 * meanings for one syntax would make every non-core key ambiguous; a second flag
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
 * The §10 view keys earn entries here the moment they earn flags (CLI-018):
 * before that, `--extra pinned=true` was refused with "core keys are not
 * user-writable through `--extra`" and nowhere to go, which is a refusal an
 * agent cannot act on.
 *
 * **`pinned` deliberately has no entry any more** (CLI-060). It left
 * `RESERVED_FRONTMATTER_KEYS` with rider 2, so `--extra pinned=null` is now a
 * legal write against `extra` — and is exactly how a workspace written before
 * the removal drops the key it no longer reads (`--unset pinned` does the same
 * thing through the general form). Pointing it at a `--pinned` flag that no
 * longer exists would be the one hint an agent cannot act on.
 */
const FLAG_FOR_RESERVED_KEY: Readonly<Record<string, string>> = {
  title: "--title",
  status: "--status",
  due: "--due",
  reviewed: "--reviewed",
  evergreen: "--evergreen",
  tags: "--add-tag`/`--remove-tag",
  stage: "--stage",
  order: "--order",
  query: "--query",
  columns: "--columns",
  kanban: "--kanban",
  "default-open": "--default-open",
  defaultOpen: "--default-open",
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
 * (`EXTRA_MAX_DEPTH = 8` is a depth no scalar needs), so the scalars-only limit
 * was never the contract's: it was `--extra`'s grammar, and a CLI-only agent
 * stewarding a non-core key that stores an object had no verb at all. Widening
 * `--extra` to parse `{`-leading values as JSON would have changed what a value
 * already stores today, so the escape hatch is a second flag instead.
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
 * The §10 view and board keys, parsed off the flags both verbs declare
 * (CLI-018, widened by CLI-060).
 *
 * A board **is** a `type: board` document whose frontmatter lists its columns,
 * its kanban and its position among boards (rider 2, signed 2026-08-22), and a
 * view is a saved query and nothing more. So "@agent build me a triage kanban"
 * is these keys and nothing else. They are core fields on the contract
 * (`packages/contract/src/schemas/doc.ts`), already accepted on `POST /api/docs`
 * and `PUT /api/docs/{id}`; the whole of this issue is the verb surface over
 * them.
 *
 * Returned un-annotated on purpose, like `edit.ts`'s patch: the generated
 * request types use exact optional properties, so a `Partial`-shaped annotation
 * (`stage?: string | undefined`) would not be assignable to them. The
 * spread-of-conditionals form produces exactly the shape the wire wants — a key
 * is present or it is not, and an absent key is "leave it alone" rather than
 * "clear it".
 */
export function parseBoardFlags(flags: ParsedFlags) {
  const stage = parseStage(flags.string("stage"));
  const order = parseOrder(flags.string("order"));
  const query = parseQuery(flags.strings("query"));
  const columns = parseColumns(flags.string("columns"));
  const kanban = parseKanban(flags.string("kanban"));
  const defaultOpen = parseTriStateBoolean("default-open", flags.string("default-open"));

  return {
    ...(stage === undefined ? {} : { stage }),
    ...(order === undefined ? {} : { order }),
    ...(query === undefined ? {} : { query }),
    ...(columns === undefined ? {} : { columns }),
    ...(kanban === undefined ? {} : { kanban }),
    ...(defaultOpen === undefined ? {} : { defaultOpen }),
  };
}

/**
 * `--stage`, passed through **verbatim** (CLI-060).
 *
 * A stage is free-form (SPEC.md §5): the CLI does not know this workspace's
 * vocabulary and must not invent one. The single refusal here is the empty
 * string, and it exists because the empty string is the one value that looks
 * like "clear it" and is not: `stage=` on the wire is the null **filter**
 * sentinel, while `--unset stage` is what removes the key from a file. Sending
 * `""` would be a `400` about a minimum length, which teaches the wrong lesson.
 *
 * **A comma is deliberately not checked here.** `StageValueSchema` refuses one
 * at the contract boundary and names the filter it would break; a second copy of
 * that rule in the CLI is a copy that can disagree with the boundary that owns
 * it.
 */
export function parseStage(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === "") {
    throw new UsageError('`--stage ""` is not a stage: a stage is a non-empty value.', {
      hint: "To remove the key from the file, use `--unset stage`. To set one, pass a value: `--stage triage`.",
    });
  }
  return raw;
}

/**
 * `order` must reach the file as a **YAML number** — boards sort on it, and a
 * quoted `"1"` is a green unit test and a board tab in the wrong place (the
 * mistake CLI-016 nearly shipped with `extra.width`). So the grammar is
 * `parseExtraValue`'s, and anything that does not come back a number — a
 * non-canonical literal, an overflowing one, a word — is a usage error here
 * rather than a `400` naming a type.
 *
 * **It is a board's position among boards and nothing else** (rider 7, signed
 * 2026-08-22). A view document has no position of its own: the same view may sit
 * on two boards, and a column's place is its index in that board's `columns`.
 */
export function parseOrder(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  const value = parseExtraValue(raw);
  if (value === null || typeof value === "number") return value;
  throw new UsageError(`--order takes a finite number or \`null\` — got "${raw}".`, {
    hint: "The board bar sorts boards on this number, so it has to be one: `--order 4`, `--order 1.5` to land between two neighbours without renumbering them, or `--order null` to drop the key and take the documented tiebreak (nulls last, then title, then id).",
  });
}

/**
 * `--columns id,id` — the ids of the `type: view` documents a board renders, in
 * display order (rider 2).
 *
 * Comma-separated rather than repeatable because **order is the value**: a
 * repeatable flag would make the board's left-to-right order a property of how
 * the command line was typed, which is exactly the sort of thing a shell wrapper
 * reorders. One string, one list, one reading.
 *
 * `--columns ""` is the **empty list** — a board with no columns, which is what
 * the Files board is — and it is distinct from `--unset columns`, which removes
 * the key altogether. A blank entry between two commas is refused rather than
 * dropped: in a positional list, silently dropping one shifts every column after
 * it.
 */
export function parseColumns(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() === "") return [];

  return raw.split(",").map((entry) => {
    const id = entry.trim();
    if (id === "") {
      throw new UsageError(`--columns ${raw} has a blank entry.`, {
        hint: 'Every entry between two commas is a view document\'s id. For a board with no columns at all, pass `--columns ""`; to remove the key, `--unset columns`.',
      });
    }
    return id;
  });
}

/**
 * `--kanban '<json>'` — the block that turns a board into a kanban: the field,
 * the stages in display order, and optionally the transition graph and the
 * stage-to-status map (rider 6).
 *
 * **JSON because the shape is nested.** `transitions` maps a stage to a list of
 * stages, so no flat `key=value` grammar reaches it, and an agent writing JSON
 * needs no ceremony to do so.
 *
 * It is validated **against the contract's own `KanbanSchema`, imported rather
 * than re-stated**, so this refusal and the server's `400` can never disagree
 * about what a kanban is. Doing it here buys the round trip back: a
 * `transitionz` typo, a stage leading to itself, a status mapped for a stage the
 * board does not draw, are all told before anything is sent. The server's
 * boundary stays the enforcement — this is the better message, exactly as
 * {@link assertWritableExtraKey} is.
 *
 * `--kanban null` clears the key, the same word `--query null` and `--order
 * null` already use.
 *
 * The return type is **inferred, not annotated**, for the reason
 * {@link parseBoardFlags} is: `Kanban` spells its optional members
 * `transitions?: … | undefined`, and the generated request type uses exact
 * optional properties, where present-and-undefined is not the same as absent.
 * The conditional spreads below produce the shape the wire wants; naming the
 * contract's own type here would make it unassignable to the wire built from
 * it.
 */
export function parseKanban(raw: string | undefined) {
  if (raw === undefined) return undefined;
  if (raw === "null") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new UsageError(
      `--kanban is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        hint: `The value is parsed as JSON, so it needs its own quoting — shells eat double quotes: --kanban '{"field":"stage","stages":["triage","doing","done"]}'. Pass --kanban null to remove the block.`,
      },
    );
  }

  const result = KanbanSchema.safeParse(parsed);
  if (!result.success) {
    throw new UsageError(`--kanban is not a kanban block: ${issueLines(result.error.issues)}`, {
      hint: `A kanban names the field and its stages, and may name the graph and the status map: --kanban '{"field":"stage","stages":["triage","doing","done"],"transitions":{"triage":["doing"],"doing":["done"]},"status":{"done":"resolved"}}'. Nothing was sent to the server.`,
    });
  }

  // Rebuilt with conditional spreads rather than passed through: Zod's
  // `.optional()` yields `transitions?: … | undefined`, and the generated
  // request type uses exact optional properties, where a present-but-undefined
  // key is not the same thing as an absent one.
  const { field, stages, transitions, status } = result.data;
  return {
    field,
    stages,
    ...(transitions === undefined ? {} : { transitions }),
    ...(status === undefined ? {} : { status }),
  };
}

/** Zod issues as one line: `stages.0: …; transitions.triage: …`. */
function issueLines(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * `--unset <key>` — the general form of "remove this frontmatter key", and the
 * only way to reach a key the core has **stopped** defining (SPEC.md §9.2, §2.4).
 *
 * Keys are named **exactly as the file writes them**, never as the API spells
 * them: the keys most worth removing — `pinned`, a view's old `order` — have no
 * wire spelling at all, and where a core key's two spellings differ the file's
 * is the one that works (`default-open`, never `defaultOpen`). That is the
 * contract's rule, and the flag's description publishes it.
 *
 * `id`, `type` and `created` are refused here as well as at the boundary, from
 * the contract's own `UNSETTABLE_EXCLUSIONS` rather than a copy of it: the
 * caller's next act is to edit that entry out of the command line, and a round
 * trip is a poor way to learn a list of three.
 */
export function parseUnsetKeys(entries: readonly string[]): string[] | undefined {
  if (entries.length === 0) return undefined;

  for (const key of entries) {
    if ((UNSETTABLE_EXCLUSIONS as readonly string[]).includes(key)) {
      throw new UsageError(
        `\`${key}\` cannot be unset: \`${UNSETTABLE_EXCLUSIONS.join("`, `")}\` are a document's identity, its behaviour and its birth.`,
        {
          hint: "Every other frontmatter key may be removed. Drop that `--unset` and keep the rest. Nothing was sent to the server.",
        },
      );
    }
  }
  return [...entries];
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
 *
 * **A whole JSON object may be passed instead** (CLI-060): `--query
 * '{"type":"note","tag":["a","b"]}'` is the same map written the way an agent
 * already holds it, and a board's scope query is where that is worth having. The
 * two forms cannot be mixed, and they cannot be confused either — a `key=value`
 * pair never begins with `{`, because no `GET /api/docs` parameter is named one.
 */
export function parseQuery(entries: readonly string[]): ViewQuery | null | undefined {
  if (entries.length === 0) return undefined;

  const json = entries.find((entry) => entry.startsWith("{"));
  if (json !== undefined) {
    if (entries.length > 1) {
      throw new UsageError(
        "`--query` takes either one JSON object or `key=value` pairs — not both in one command.",
        { hint: "Write the whole map as one JSON object, or write every key as its own pair." },
      );
    }
    return parseQueryJson(json);
  }

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
 * The whole map as one JSON object, checked against the contract's own
 * `ViewQuerySchema` rather than a second flatness rule written here — the same
 * relationship `--kanban` has with `KanbanSchema`.
 */
function parseQueryJson(raw: string): ViewQuery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new UsageError(
      `--query is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        hint: `The value is parsed as JSON, so it needs its own quoting — shells eat double quotes: --query '{"type":"thread","status":"open"}'. The pair form takes no quoting at all: --query type=thread --query status=open.`,
      },
    );
  }

  const result = ViewQuerySchema.safeParse(parsed);
  if (!result.success) {
    throw new UsageError(`--query is not a board query: ${issueLines(result.error.issues)}`, {
      hint: `A board query is a **flat** map from \`GET /api/docs\` parameter names to a value or a list of values: --query '{"type":["note","view"],"tag":"finance"}'. Nothing was sent to the server.`,
    });
  }
  return result.data;
}

/**
 * One declaration of the four view flags, shared by `doc create` and `doc edit`
 * so the two verbs cannot describe the same frontmatter key differently — the
 * registry's own rule (SPEC.md §2.3), applied inside a command's flag list.
 *
 * The descriptions cover both verbs because the wire does: on create a `null`
 * is the same as omitting the flag, and on edit it clears the key from the file.
 */
export const BOARD_KEY_FLAGS: readonly FlagSpec[] = [
  {
    name: "stage",
    type: "string",
    valueName: "value",
    description:
      "**Where the document sits in a workflow** (SPEC.md §5) — free-form, named by the kanban " +
      "boards that use it, and filterable with `corpus doc list --stage`. It is not `--status`: " +
      "`status` says whether work remains, `stage` says where in a workflow the document is, and " +
      "a document in any stage is ordinarily `open`. **While a document is in a kanban, its " +
      "stage decides its status**: entering a stage the board's `kanban.status` map names writes " +
      "that status in the same commit, and entering a stage with no mapping writes `open` — the " +
      "response reports it as a `stage_status` warning and this verb prints it on its own line, " +
      "because a caller who asked for one field and got two has to be told. Writing `--status` " +
      "never moves a stage. Two kanbans over the same documents share this one value, so they " +
      "should share a vocabulary. A comma is refused at the write boundary, because `--stage` on " +
      "`doc list` is a comma-separated OR list and a stage with one could never be filtered for. " +
      'To remove the key, `--unset stage` — `--stage ""` is a usage error, not a clear.',
  },
  {
    name: "order",
    type: "string",
    valueName: "number|null",
    description:
      "**A board's position among boards**, ascending — the order the board bar lists them in " +
      "(SPEC.md §10, rider 7). Any **finite** number: `--order 1.5` lands a board between its " +
      "neighbours without renumbering them, which is what the shipped tiebreak (`order` with " +
      "nulls last, then title, then id) exists for. `--order null` drops the key. It reaches the " +
      "file as a YAML number, so a value that is not one is a usage error here rather than a tab " +
      "in the wrong place. **It is a board's position and nothing else**: a `type: view` document " +
      "is a saved query with no position of its own, the same view may sit on two boards, and a " +
      "column's place is its index in that board's `--columns`.",
  },
  {
    name: "columns",
    type: "string",
    valueName: "id,id",
    description:
      "**The columns of a `type: board` document**: the ids of the `type: view` documents that " +
      "render them, in display order (SPEC.md §10, rider 2). Comma-separated rather than " +
      "repeatable because the order _is_ the value. Adding, removing or reordering a column is " +
      "this flag on the board, never a flag on the view — and the same view may sit on two " +
      'boards. `--columns ""` sets an **empty list**, which is what the Files board is; ' +
      "`--unset columns` removes the key altogether, which is what a kanban board has, since a " +
      "kanban's columns are derived one per stage from `--kanban` and are not view documents at " +
      "all.",
  },
  {
    name: "kanban",
    type: "string",
    valueName: "json",
    description:
      "**Draw this board as a kanban over one field** (SPEC.md §10, rider 6), as a JSON object: " +
      '`{"field":"stage"|"status", "stages":[…], "transitions":{…}, "status":{…}}`. ' +
      "JSON because the shape is nested. A complete example: `--kanban " +
      '\'{"field":"stage","stages":["triage","doing","done"],"transitions":' +
      '{"triage":["doing"],"doing":["done","triage"]},"status":{"done":"resolved"}}\'`. ' +
      "`stages` is the display order, one column each, and a document in scope with no value for " +
      "the field sits in the first. **`transitions` omitted is the linear funnel** — each stage " +
      "leads to its neighbours, both ways — while `{}` is a graph nothing may be dragged along; " +
      "the server enforces the **status map**, never the transitions, so anything the graph " +
      "forbids is still done by setting the field. `status` is §5's coupling: entering a stage " +
      "named here writes that status, and entering one not named here writes `open`. The block " +
      "is checked here against the contract's own schema, so a `transitionz` typo, a stage " +
      "leading to itself or a status mapped for an undrawn stage is refused before anything is " +
      "sent. `--kanban null` removes the block.",
  },
  {
    name: "default-open",
    type: "string",
    valueName: "true|false",
    description:
      "**The board a browser opens onto, and the board that receives an open naming no board** " +
      "(SPEC.md §10, rider 2). Takes an explicit value, like `--evergreen`: omitting the flag " +
      "leaves the field alone. **At most one board carries it** — setting it `true` clears the " +
      "flag from every other board in the same commit, and the response reports each one as a " +
      "`default_open_cleared` warning. With none set, the first board in `--order` receives " +
      "those opens. The frontmatter key is `default-open`, which is also how `--unset` names it.",
  },
  {
    name: "query",
    type: "string",
    valueName: "key=value",
    repeated: true,
    description:
      "**A view's stored query, or a kanban board's scope.** Repeatable `key=value` pairs — a " +
      "**flat** map from `GET /api/docs` parameter names (`type`, `status`, `tag`, `stage`, " +
      "`folder`, `needs`, `q`, `sort`, …) to a value. A comma is an OR (`--query type=note,view` " +
      "≡ `type=note,view` on the wire); quote a value to keep a comma in it (`--query " +
      "q='\"salt, pepper\"'`). Values follow `--extra`'s grammar minus `null`: `true`/`false` are " +
      "booleans, a canonical finite number is a number, everything else is the string as typed. " +
      "**The whole map may be given as one JSON object instead** — `--query " +
      '\'{"type":"thread","tag":["finance","housing"]}\'` — which is the form to reach ' +
      "for when the map is already JSON; the two forms cannot be mixed in one command. **Naming " +
      "any key replaces the whole query** — `query` is one core field, not a merge patch — and " +
      "`--query null` clears it. On a kanban board this is the scope every derived stage column " +
      "is drawn from, narrowed per column by that column's own stage.",
  },
];

/**
 * `--unset`, declared beside the keys it removes but **only on `doc edit`**: a
 * create has no key to remove, and a flag that could only ever be a no-op is a
 * flag an agent has to reason about for nothing.
 */
export const UNSET_FLAG: FlagSpec = {
  name: "unset",
  type: "string",
  valueName: "key",
  repeated: true,
  description:
    "**Remove a frontmatter key from the file**, repeatably — the general form behind SPEC.md " +
    "§2.4's data migrations, and the only way to reach a key the core has _stopped_ defining. " +
    "Keys are named **exactly as the file writes them**, not as this CLI's flags spell them: " +
    "`--unset pinned` and `--unset column` drop the keys rider 2 and SHARED-066 removed, and " +
    "where a core key's two spellings differ the file's is the one that works — `--unset " +
    "default-open`, never `defaultOpen`. Removing a key the document does not carry is a no-op " +
    "rather than a failure. **`id`, `type` and `created` are refused**, naming the key: they are " +
    "the document's identity, its behaviour and its birth. It names its own delta, so it needs " +
    "no `--key`.",
};
