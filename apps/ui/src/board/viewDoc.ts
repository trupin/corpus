import type { DocRow } from "@corpus/contract";
import { readStoredWidth } from "./columnWidth";

/**
 * The view-document contract, read (SPEC.md §10, rider 2 — "a view document is a
 * saved query and nothing more").
 *
 * Everything a column *is* — its title, its query, its width — lives in that
 * document's frontmatter and reaches the client as first-class fields on the
 * collection row (CONTRACT-011). What it is **not** is where the column sits:
 * `pinned` and a view's `order` were removed rather than deprecated (rider 2,
 * signed 2026-08-22), and a column's place is now its index in the board
 * document's `columns`. This module turns one view row into the shape the board
 * renders, and nothing here invents a column.
 *
 * **What is validated here and what is not.** The wire type says `query` is a
 * flat map of scalars and arrays of scalars, but the file on disk is
 * hand-editable and an agent-editable, so the shape can lie — hence the guard
 * below. Which *parameter names* are legal is the server's grammar (SPEC.md
 * §9.2) and is deliberately not restated: an unknown or misspelled filter is
 * sent, refused with `400`, and rendered as that column's error card. Two
 * copies of the query grammar that can disagree is worse than one round trip.
 */

export const COLUMN_KINDS = ["view", "folder"] as const;

export type ColumnKind = (typeof COLUMN_KINDS)[number];

/** One rendered filter chip: the stored query, shown rather than summarised. */
export interface ColumnChip {
  /** The `GET /api/docs` parameter name — also the React key. */
  readonly key: string;
  readonly label: string;
}

export interface BoardColumn {
  /**
   * This column's place on the board — the view document's id, or `<id>#<n>`
   * where the board lists the same view more than once. It is the `data-col`,
   * the React key and the key its browser-local state is filed under, so two
   * copies of one view are two columns rather than one column drawn twice.
   */
  readonly id: string;
  /** The view document this column renders. Two slots may share one. */
  readonly viewId: string;
  readonly title: string;
  readonly kind: ColumnKind;
  /**
   * The stored query compiled to wire form — every value a string, arrays
   * comma-joined, exactly what `GET /api/docs` takes. Passed through verbatim
   * so the request a column issues is the query the file holds, with nothing
   * injected.
   */
  readonly filter: Readonly<Record<string, string>>;
  /** The stored query as it arrived, for the ⋯ → Edit query round trip. */
  readonly storedQuery: Readonly<Record<string, unknown>>;
  readonly chips: readonly ColumnChip[];
  readonly sortLabel: string;
  /** The folder a `folder:` query scopes to — where this column's `＋` creates. */
  readonly folder: string | null;
  /**
   * The width the view document carries (SPEC.md §10), or `null` for the
   * default. An unusable stored value reads as `null` rather than as an error:
   * the server never interprets `extra`, so a hand-edited `width: wide` must
   * degrade to the default and not to a broken column.
   */
  readonly width: number | null;
  /**
   * Why this column cannot be rendered from its own document, or `null`. Set
   * only for defects the *client* can see (a `query` that is not a map, a value
   * a query string cannot carry, an id that resolves to no view document at
   * all); a query the server refuses surfaces through the column's own failed
   * request instead.
   */
  readonly error: string | null;
  /**
   * The board lists this id and no `type: view` document answers to it.
   *
   * Distinct from a *broken* view document, because the acts differ: a broken
   * one is fixed by editing the file the card names, and a missing one is fixed
   * by taking it off the board. So the card offers what applies and nothing
   * else — there is no document behind it to rename, re-query or open.
   */
  readonly missing: boolean;
}

/** Rendered as the `.sort` label; pagination is not a filter the user set. */
const NON_CHIP_KEYS = new Set(["sort", "limit", "offset"]);

/**
 * The prototype's sort labels (`design/index.html`: "last activity ↓",
 * "created ↓"), keyed by the contract's `DOC_SORTS` values. An unknown key —
 * a hand-edited file, or a sort the contract grows before this map does —
 * renders verbatim rather than being dropped.
 */
const SORT_LABELS: Readonly<Record<string, string>> = {
  "-updated": "last activity ↓",
  updated: "last activity ↑",
  "-created": "created ↓",
  created: "created ↑",
  due: "due ↑",
  title: "title ↑",
  order: "order ↑",
  relevance: "relevance",
};

/** What `GET /api/docs` sorts by when the stored query names no sort. */
const DEFAULT_SORT = "-updated";

function scalarToWire(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return null;
}

/**
 * One stored query value in wire form, or `null` when the file holds something
 * a query string cannot carry. Arrays OR together as the comma-separated form
 * (`{type: ["note","view"]}` ≡ `type=note,view`).
 */
function valueToWire(value: unknown): string | null {
  if (Array.isArray(value)) {
    const members = value.map(scalarToWire);
    if (members.some((member) => member === null)) return null;
    return members.join(",");
  }
  return scalarToWire(value);
}

/**
 * What `isParent`'s two values are called on a chip (UI-088).
 *
 * Every other chip shows the stored value verbatim, and for every other field
 * that is the honest thing to do. `isParent` is the exception because its name
 * says the opposite of what it selects: `isParent=true` keeps documents with
 * **no** parent (CONTRACT-042), so a chip reading `isParent: true` would tell a
 * user their column shows parent documents when it shows top-level ones. The
 * key is kept — a chip still names the parameter it sends, so the row still
 * maps onto the query string behind ⋯ → Edit query — and only the value is put
 * into words.
 *
 * A value that is neither still renders verbatim: the server owns which values
 * are legal, and inventing a phrase for a hand-edited `isParent: yes` would be
 * this file answering a question that belongs to the round trip.
 */
const ISPARENT_CHIP_VALUES: Readonly<Record<string, string>> = {
  true: "top-level only",
  false: "children only",
};

/** A chip's text: `folder: inbox/`, `type: thread`, `tag: housing, finance`. */
function chipLabel(key: string, wire: string): string {
  if (key === "isParent") return `${key}: ${ISPARENT_CHIP_VALUES[wire] ?? wire}`;
  // The prototype writes folder chips with a trailing slash — it is a directory,
  // and the slash is what says so at a glance.
  const value = key === "folder" && !wire.endsWith("/") ? `${wire}/` : wire;
  return `${key}: ${value.split(",").join(", ")}`;
}

interface CompiledQuery {
  readonly filter: Record<string, string>;
  readonly chips: ColumnChip[];
  readonly error: string | null;
}

function compileQuery(stored: Readonly<Record<string, unknown>>): CompiledQuery {
  const filter: Record<string, string> = {};
  const chips: ColumnChip[] = [];
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(stored)) {
    const wire = valueToWire(raw);
    if (wire === null) {
      rejected.push(key);
      continue;
    }
    filter[key] = wire;
    if (!NON_CHIP_KEYS.has(key) && wire !== "") chips.push({ key, label: chipLabel(key, wire) });
  }

  return {
    filter,
    chips,
    error:
      rejected.length === 0
        ? null
        : `its stored query holds a value that is not a filter: ${rejected.sort().join(", ")}`,
  };
}

/**
 * The stored query as a map, or an error when the document says something a
 * query cannot be.
 *
 * `DocRow.query` is typed as a map, but the type describes what the server
 * *promises*, and this file is hand- and agent-editable — `query: needs=me`
 * parses as a perfectly good YAML string and would otherwise reach
 * `Object.entries` as a crash.
 */
function readStoredQuery(query: unknown): {
  readonly stored: Record<string, unknown>;
  readonly error: string | null;
} {
  if (query === null || query === undefined) return { stored: {}, error: null };
  if (typeof query !== "object" || Array.isArray(query)) {
    return { stored: {}, error: "its `query` frontmatter is not a map of filters" };
  }
  return { stored: query as Record<string, unknown>, error: null };
}

/** The first folder a `folder:` query names — a column scopes to one directory. */
function folderOfFilter(filter: Readonly<Record<string, string>>): string | null {
  const folder = filter["folder"];
  if (folder === undefined || folder === "") return null;
  return (folder.split(",")[0] ?? "").replace(/\/+$/, "") || null;
}

/**
 * One view document, as a column of the board that lists it.
 *
 * Never throws and never drops the column: a defect becomes `error`, which the
 * board renders in place. A column that vanishes because its own frontmatter is
 * wrong is the failure mode this shape exists to prevent.
 */
export function toBoardColumn(slotId: string, row: DocRow): BoardColumn {
  const { stored, error: queryError } = readStoredQuery(row.query);
  const compiled = compileQuery(stored);
  const folder = folderOfFilter(compiled.filter);
  const sort = compiled.filter["sort"] ?? DEFAULT_SORT;

  return {
    id: slotId,
    viewId: row.id,
    title: row.title,
    kind: folder !== null ? "folder" : "view",
    filter: compiled.filter,
    storedQuery: stored,
    chips: compiled.chips,
    sortLabel: SORT_LABELS[sort] ?? sort,
    folder,
    width: readStoredWidth(row.extra),
    error: queryError ?? compiled.error,
    missing: false,
  };
}

/**
 * A column the board lists and the corpus cannot answer for.
 *
 * The id is kept as the title on purpose: it is the only thing known about this
 * column, and it is exactly what a person needs in order to find the line in the
 * board document — or to hand it to `corpus doc show`.
 */
export function missingColumn(slotId: string, viewId: string): BoardColumn {
  return {
    id: slotId,
    viewId,
    title: viewId,
    kind: "view",
    filter: {},
    storedQuery: {},
    chips: [],
    sortLabel: "",
    folder: null,
    width: null,
    error:
      "this board lists it as a column, and no `type: view` document with that id could be read " +
      "— it may have been archived or deleted",
    missing: true,
  };
}

/**
 * The stored query in the wire's own grammar (`type=thread&status=open`), which
 * is what the ⋯ → Edit query field shows and takes back. The same string the
 * chips describe and the same one `GET /api/docs` would receive — so a user
 * editing it is editing the query, not a translation of it.
 */
export function formatQueryString(filter: Readonly<Record<string, string>>): string {
  return Object.entries(filter)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/**
 * Whether two wire-form queries say the same thing.
 *
 * Key order is not meaning, and neither is the spelling of the field the user
 * typed into: `type=note&status=open` and `status=open&type=note` are one
 * query. The Edit-query field compares with this before writing, because a
 * committed `PUT` that changes nothing still rewrites the view document,
 * bumps `updated` and lands a commit in the log for a field somebody merely
 * clicked out of (PR #10 finding 19).
 */
export function sameQuery(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

/**
 * Parses that field back. Values are kept as strings — the file stores what the
 * user typed, and the server owns which values are legal.
 */
export function parseQueryString(text: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const part of text.split("&")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key === "" || value === "") continue;
    query[key] = value;
  }
  return query;
}
