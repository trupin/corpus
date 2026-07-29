import type { DocRow } from "@corpus/contract";

/**
 * The view-document contract, read (SPEC.md §11 — "a column IS a `type: view`
 * document with `pinned: true`").
 *
 * Everything a column *is* — its title, its query, its board position, its
 * plugin renderer — lives in that document's frontmatter and reaches the client
 * as first-class fields on the collection row (CONTRACT-011). This module turns
 * one such row into the shape the board renders, and nothing here invents a
 * column: a board with no pinned view documents has no columns, by construction.
 *
 * **What is validated here and what is not.** The wire type says `query` is a
 * flat map of scalars and arrays of scalars, but the file on disk is
 * hand-editable and an agent-editable, so the shape can lie — hence the guard
 * below. Which *parameter names* are legal is the server's grammar (SPEC.md
 * §9.2) and is deliberately not restated: an unknown or misspelled filter is
 * sent, refused with `400`, and rendered as that column's error card. Two
 * copies of the query grammar that can disagree is worse than one round trip.
 */

export const COLUMN_KINDS = ["view", "folder", "plugin"] as const;

export type ColumnKind = (typeof COLUMN_KINDS)[number];

/** One rendered filter chip: the stored query, shown rather than summarised. */
export interface ColumnChip {
  /** The `GET /api/docs` parameter name — also the React key. */
  readonly key: string;
  readonly label: string;
}

/** A `column: "<plugin>/<type>"` reference (SPEC.md §10), already split. */
export interface PluginColumnRef {
  readonly plugin: string;
  readonly type: string;
}

export interface BoardColumn {
  /** The view document's id. The column has no identity of its own. */
  readonly id: string;
  readonly title: string;
  readonly order: number | null;
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
  readonly plugin: PluginColumnRef | null;
  /**
   * Why this column cannot be rendered from its own document, or `null`. Set
   * only for defects the *client* can see (a `query` that is not a map, a
   * malformed `column` reference); a query the server refuses surfaces through
   * the column's own failed request instead.
   */
  readonly error: string | null;
}

/** Exactly one `/` between non-empty, whitespace-free plugin and type names. */
const COLUMN_REF_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

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

/** A chip's text: `folder: inbox/`, `type: thread`, `tag: housing, finance`. */
function chipLabel(key: string, wire: string): string {
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

function readPlugin(column: string | null): {
  readonly plugin: PluginColumnRef | null;
  readonly error: string | null;
} {
  if (column === null || column === "") return { plugin: null, error: null };
  const match = COLUMN_REF_PATTERN.exec(column);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return {
      plugin: null,
      error: `its \`column\` frontmatter is not a "<plugin>/<type>" reference: ${column}`,
    };
  }
  return { plugin: { plugin: match[1], type: match[2] }, error: null };
}

/** The first folder a `folder:` query names — a column scopes to one directory. */
function folderOfFilter(filter: Readonly<Record<string, string>>): string | null {
  const folder = filter["folder"];
  if (folder === undefined || folder === "") return null;
  return (folder.split(",")[0] ?? "").replace(/\/+$/, "") || null;
}

/**
 * One pinned view document, as a column.
 *
 * Never throws and never drops the column: a defect becomes `error`, which the
 * board renders in place. A column that vanishes because its own frontmatter is
 * wrong is the failure mode this shape exists to prevent.
 */
export function toBoardColumn(row: DocRow): BoardColumn {
  const { stored, error: queryError } = readStoredQuery(row.query);
  const compiled = compileQuery(stored);
  const { plugin, error: pluginError } = readPlugin(row.column);
  const folder = folderOfFilter(compiled.filter);
  const sort = compiled.filter["sort"] ?? DEFAULT_SORT;

  return {
    id: row.id,
    title: row.title,
    order: row.order,
    kind: plugin !== null ? "plugin" : folder !== null ? "folder" : "view",
    filter: compiled.filter,
    storedQuery: stored,
    chips: compiled.chips,
    sortLabel: SORT_LABELS[sort] ?? sort,
    folder,
    plugin,
    error: queryError ?? pluginError ?? compiled.error,
  };
}

/**
 * The documented tiebreak (CONTRACT-011): `order` ascending with **nulls last**
 * — a view with no `order` key is placed, never dropped — then `title`, then
 * `id`, so the same column set renders in the same sequence on every load.
 *
 * The server sorts by exactly this rule under `sort=order`. Re-applying it here
 * is belt and braces, and is what makes the ordering testable without a server.
 */
export function compareColumns(left: BoardColumn, right: BoardColumn): number {
  if (left.order !== right.order) {
    if (left.order === null) return 1;
    if (right.order === null) return -1;
    return left.order - right.order;
  }
  if (left.title !== right.title) return left.title < right.title ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
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
