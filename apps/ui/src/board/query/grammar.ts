import {
  ACTORS,
  CORE_DOC_TYPES,
  DEFAULT_DOC_SORT,
  DOC_SORTS,
  DOC_STATUSES,
  DUE_KEYWORDS,
  DocsQuerySchema,
  NEEDS_FILTERS,
  STALE_TIERS,
  THREAD_AGENT_STATES,
} from "@corpus/contract";

/**
 * The query language a column's `query:` frontmatter is written in, described
 * once for both the editor's autocomplete and its help panel (UI-039).
 *
 * **There is no second grammar here.** A column's query *is* the `GET /api/docs`
 * query string (SPEC.md §9.2, §11), so the field names come from
 * {@link DocsQuerySchema} itself — `Object.keys(schema.shape)` is the parser's
 * own list, read at runtime — and every enumerated value list is the same
 * exported constant `packages/contract/src/schemas/query.ts` builds its
 * validators from. A filter added to the contract therefore appears in this
 * editor with no edit to this file, and no value list here can offer something
 * the server would refuse.
 *
 * What is hand-written is prose: the one-line summary each field gets. That is
 * the only thing that *can* drift, so `grammar.test.ts` asserts every name the
 * schema publishes has one — a new contract filter fails that test until
 * somebody writes its sentence, while the editor keeps working in the meantime.
 *
 * The grammar is deliberately tiny, and the help panel says so: one operator
 * (`=`), two combinators (`&` between fields, `,` within one). There is no
 * negation, no grouping and no comparison — inventing any of them in this UI
 * would teach a language the server does not speak.
 */

/** Every field name `GET /api/docs` accepts, from the schema that parses them. */
export const QUERY_FIELD_NAMES: readonly string[] = Object.keys(DocsQuerySchema.shape);

/** Where an editor gets the values it can offer after `field=`. */
export type ValueSource =
  /** A closed set the contract enumerates — the values *are* the vocabulary. */
  | { readonly kind: "fixed"; readonly values: readonly string[] }
  /** Document types actually in use, plus the core ones (`useQueryVocabulary`). */
  | { readonly kind: "docType" }
  /** Tags actually in use. */
  | { readonly kind: "tag" }
  /** Folders under `data/docs/`, from `GET /api/tree`. */
  | { readonly kind: "folder" }
  /** A document id, offered by title so nobody types `doc_*` by hand (§5). */
  | { readonly kind: "docId" }
  /**
   * Free text with no enumerable vocabulary — a search phrase, an instant, a
   * number. Named rather than absent so the help panel can say what to type.
   */
  | { readonly kind: "free"; readonly hint: string };

export interface QueryField {
  readonly name: string;
  /** One line, for the `.d` column of the menu and the help panel's field list. */
  readonly summary: string;
  readonly values: ValueSource;
  /** True when comma-separated values OR together (`type=note,view`). */
  readonly multi: boolean;
}

type FieldDetail = Omit<QueryField, "name">;

/**
 * The prose half, keyed by the schema's own field names. Values are pulled from
 * the contract's constants rather than retyped, so a value list here cannot
 * disagree with the one the server validates against.
 */
const FIELD_DETAILS: Readonly<Record<string, FieldDetail>> = {
  q: {
    summary: "Full-text search across titles, bodies and thread turns.",
    values: { kind: "free", hint: "words" },
    multi: false,
  },
  type: {
    summary: "Document type. Plugins add their own, so the set is open.",
    values: { kind: "docType" },
    multi: true,
  },
  tag: {
    summary: "Tags from the document's frontmatter.",
    values: { kind: "tag" },
    multi: true,
  },
  status: {
    summary: "Lifecycle status. Archived documents are excluded unless you ask.",
    values: { kind: "fixed", values: DOC_STATUSES },
    multi: false,
  },
  folder: {
    summary: "Folder under data/docs/, including everything beneath it.",
    values: { kind: "folder" },
    multi: false,
  },
  needs: {
    summary: "The Attention filter: me is the union of every reason.",
    values: { kind: "fixed", values: NEEDS_FILTERS },
    multi: false,
  },
  due: {
    summary: "A deadline window, or an ISO date to mean on or before it.",
    values: { kind: "fixed", values: DUE_KEYWORDS },
    multi: false,
  },
  since: {
    summary: "Updated strictly after this instant.",
    values: { kind: "free", hint: "ISO 8601 instant" },
    multi: false,
  },
  stale: {
    summary: "Staleness tier and beyond; evergreen documents never match.",
    values: { kind: "fixed", values: STALE_TIERS },
    multi: false,
  },
  unread: {
    summary: "Threads whose last turn is newer than your last-seen mark.",
    values: { kind: "fixed", values: ["true", "false"] },
    multi: false,
  },
  agent: {
    summary: "Agent participation state. Threads only.",
    values: { kind: "fixed", values: THREAD_AGENT_STATES },
    multi: false,
  },
  author: {
    summary: "Who wrote the thread's last turn. Threads only.",
    values: { kind: "fixed", values: ACTORS },
    multi: false,
  },
  parent: {
    summary: "Threads hanging off this document. Threads only.",
    values: { kind: "docId" },
    multi: false,
  },
  references: {
    summary: "Documents whose body links to this one with [[id]].",
    values: { kind: "docId" },
    multi: false,
  },
  includeArchived: {
    summary: "Show archived documents alongside the rest, rather than instead.",
    values: { kind: "fixed", values: ["true", "false"] },
    multi: false,
  },
  pinned: {
    summary: "Documents carrying pinned: true — the board's own columns.",
    values: { kind: "fixed", values: ["true", "false"] },
    multi: false,
  },
  sort: {
    // Not "a leading - reverses it": the contract enumerates the keys, and only
    // updated and created have a descending form. `sort=-due` is a 400.
    summary: `One of the keys below; ${DEFAULT_DOC_SORT} when unset.`,
    values: { kind: "fixed", values: DOC_SORTS },
    multi: false,
  },
  limit: {
    summary: "How many rows the list holds.",
    values: { kind: "free", hint: "number" },
    multi: false,
  },
  offset: {
    summary: "Rows to skip before collecting the page.",
    values: { kind: "free", hint: "number" },
    multi: false,
  },
};

/**
 * A field the schema publishes and this file has no sentence for. It is still
 * offered — the server accepts it, so hiding it would be the bigger lie — and
 * `grammar.test.ts` fails until it gets a real description.
 */
const UNDOCUMENTED: FieldDetail = {
  summary: "A filter this build has no description for yet.",
  values: { kind: "free", hint: "value" },
  multi: false,
};

/**
 * Reading order for the menu and the help panel: what a person reaches for
 * first, not the schema's declaration order (which starts with pagination).
 * A name missing from this list still renders — it sorts to the end.
 */
const READING_ORDER: readonly string[] = [
  "q",
  "type",
  "tag",
  "status",
  "folder",
  "needs",
  "due",
  "since",
  "stale",
  "unread",
  "agent",
  "author",
  "parent",
  "references",
  "includeArchived",
  "pinned",
  "sort",
  "limit",
  "offset",
];

function rank(name: string): number {
  const index = READING_ORDER.indexOf(name);
  return index === -1 ? READING_ORDER.length : index;
}

/** Every field the query language accepts, in reading order. */
export const QUERY_FIELDS: readonly QueryField[] = [...QUERY_FIELD_NAMES]
  .sort((left, right) => rank(left) - rank(right) || (left < right ? -1 : 1))
  .map((name) => ({ name, ...(FIELD_DETAILS[name] ?? UNDOCUMENTED) }));

export function queryField(name: string): QueryField | undefined {
  return QUERY_FIELDS.find((field) => field.name === name);
}

export interface GrammarRule {
  readonly token: string;
  readonly meaning: string;
}

export const QUERY_OPERATORS: readonly GrammarRule[] = [
  { token: "=", meaning: "The only operator: field = value." },
];

export const QUERY_COMBINATORS: readonly GrammarRule[] = [
  { token: "&", meaning: "AND, between fields — every one must match." },
  { token: ",", meaning: "OR, within one field — type=note,view." },
];

export interface QueryExample {
  readonly query: string;
  readonly meaning: string;
}

/** Four queries that run as written; the first is the field's own placeholder. */
export const QUERY_EXAMPLES: readonly QueryExample[] = [
  { query: "type=thread&status=open", meaning: "Conversations still open." },
  { query: "needs=me&folder=finance", meaning: "Attention, inside one folder." },
  { query: "type=note,view&tag=finance", meaning: "Notes or views tagged finance." },
  { query: "due=week&sort=due", meaning: "Due within the week, soonest first." },
];

/**
 * Field names in a query string that the schema does not publish.
 *
 * Worth surfacing because the server is *silent* about them: `DocsQuerySchema`
 * is a tolerant object, so an unknown parameter is stripped rather than
 * refused, and `typ=todo` renders a perfectly healthy column that ignores the
 * filter it was given. Autocomplete prevents the typo; this catches the one
 * already stored in a hand-edited view document.
 */
export function unknownQueryFields(filter: Readonly<Record<string, string>>): readonly string[] {
  return Object.keys(filter)
    .filter((name) => !QUERY_FIELD_NAMES.includes(name))
    .sort();
}

/** The core document types, for the value vocabulary's "not in use yet" tail. */
export const CORE_TYPE_VALUES: readonly string[] = CORE_DOC_TYPES;
