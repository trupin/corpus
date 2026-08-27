import {
  ACTORS,
  EXTRA_KEY_PATTERN,
  EXTRA_PARAM_PREFIX,
  CORE_DOC_TYPES,
  DEFAULT_DOC_SORT,
  DOC_SORTS,
  DOC_STATUSES,
  DUE_KEYWORDS,
  DocsQuerySchema,
  FOLDER_SCOPES,
  NEEDS_FILTERS,
  STALE_TIERS,
  THREAD_AGENT_STATES,
} from "@corpus/contract";

/**
 * The query language a column's `query:` frontmatter is written in, described
 * once for both the editor's autocomplete and its help panel (UI-039).
 *
 * **There is no second grammar here.** A column's query *is* the `GET /api/docs`
 * query string (SPEC.md §9.2, §10), so the field names come from
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
  /**
   * The `extra.` namespace: nothing to offer *after* the `=`, because the
   * vocabulary is the workspace's own values and enumerating them would mean
   * offering four hundred customer names for one menu. What can be offered is
   * the **key**, before the `=`, and UI-178 is where that comes from.
   */
  | { readonly kind: "extraKey" }
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
 * What `isParent` is described as, everywhere a description is shown — the
 * completion menu's second column and the help panel's field list.
 *
 * Exported so `grammar.test.ts` can pin the exact wording. That is worth a test
 * where every other field's summary is not, because this is the only field
 * whose name says the opposite of what it does: `isParent=true` selects
 * documents that *have no parent* (CONTRACT-042). A summary that drifted into
 * "documents that are a parent" would be worse than no summary at all, since a
 * user who reads it would build exactly the column they did not want and have
 * no way to tell.
 */
export const ISPARENT_SUMMARY =
  'Top-level only: true keeps documents with no parent. Never "has children".';

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
  /**
   * SPEC.md §9.2's **Pattern matching**. Both match one field literally, where
   * `q` ranks whole words across the corpus, and both are **exact** without a
   * wildcard — so the summary has to say `*` out loud, because a person who
   * types `title=Mortgage` and gets nothing has no way to guess why.
   */
  title: {
    summary: "The title, matched whole. Use * for a run of characters, ? for one.",
    values: { kind: "free", hint: "text, or a pattern with * and ?" },
    multi: false,
  },
  body: {
    summary: "The body text, matched whole — so this one nearly always wants *foo*.",
    values: { kind: "free", hint: "a pattern with * and ?" },
    multi: false,
  },
  type: {
    summary: "Document type. The set is open — a workspace may hold its own.",
    values: { kind: "docType" },
    multi: true,
  },
  tag: {
    summary: "Tags from the document's frontmatter. Takes * and ? patterns.",
    values: { kind: "tag" },
    multi: true,
  },
  status: {
    summary: "Lifecycle status. Archived documents are excluded unless you ask.",
    values: { kind: "fixed", values: DOC_STATUSES },
    multi: false,
  },
  folder: {
    summary: "Folder under data/docs/, including everything beneath it. Takes * and ?.",
    values: { kind: "folder" },
    multi: false,
  },
  folderScope: {
    // A modifier of `folder` and nothing on its own — it answers `400` without
    // one (CONTRACT-081). `self` is what the explorer's tree asks for.
    summary: "How far under folder to reach: tree is everything beneath it, self is only it.",
    values: { kind: "fixed", values: FOLDER_SCOPES },
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
  /**
   * The one field whose *name* argues against its meaning, so the prose has to
   * do the work the name does not (UI-088).
   *
   * `isParent=true` selects **roots** — documents with no parent — which is what
   * lets a view show top-level documents without the threads hanging off them
   * mixed in. It does **not** mean "has children": a standalone note that
   * nothing hangs off still matches. CONTRACT-042 considered and rejected the
   * literal reading (a parents-only view that hid every uncommented note would
   * be nearly empty) and kept the name the user asked for, so this summary is
   * the only thing standing between the name and the wrong conclusion. That is
   * why {@link ISPARENT_SUMMARY} is exported and pinned by a test.
   *
   * `parent=<id>` alongside `isParent=true` is refused with a `400`. That is
   * deliberately not restated here: the server owns the grammar and a column
   * renders its refusal (`viewDoc.ts`), and a second copy of the rule in this
   * file is a copy that can disagree.
   */
  isParent: {
    summary: ISPARENT_SUMMARY,
    values: { kind: "fixed", values: ["true", "false"] },
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
  /**
   * SPEC.md §5's workflow position, filterable since CONTRACT-074 — it replaced
   * `pinned=`, which left the API with rider 2 because nothing puts a view on a
   * board any more except the board's own `columns`.
   *
   * Free-form, and deliberately so: the values are named by the kanban boards
   * that use them (§10, rider 6), so there is no fixed set to enumerate and a
   * completion list would be this file guessing at a vocabulary the workspace
   * owns. A comma is the one character a stage may not contain, because `stage=`
   * is a comma-separated OR list.
   */
  stage: {
    summary: "Where a document sits in a workflow — a kanban board names the values.",
    values: { kind: "free", hint: "a stage the board names" },
    multi: true,
  },
  /**
   * SPEC.md §5's **Structured fields** — the one entry here that describes a
   * **namespace** rather than a field (SHARED-011's rider, signed 2026-08-04).
   *
   * The schema publishes one name, `extra`, because a parameter's published
   * name must equal its schema key and the real spelling — `extra.assignee` —
   * has an open tail. So this summary has to teach the tail, since nothing else
   * in the editor can: a person who reads "extra" and types `extra=theo` gets a
   * filter the server will not honour.
   */
  extra: {
    summary: "Any frontmatter field this workspace uses: extra.assignee=theo.",
    values: { kind: "extraKey" },
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
  // Beside `q` because they answer the same question — "match this text" — and
  // the difference between them is the thing a reader most needs to see: `q`
  // ranks whole words across the corpus, these two match one field literally.
  "title",
  "body",
  "type",
  "tag",
  "status",
  "folder",
  // Immediately after the filter it modifies: it selects nothing alone.
  "folderScope",
  "needs",
  "due",
  "since",
  "stale",
  "unread",
  "agent",
  "author",
  "parent",
  // Next to `parent`, whose question it is the other half of — and whose `400`
  // when both are set (CONTRACT-042) is easier to reason about when the two are
  // read one after the other.
  "isParent",
  "references",
  "includeArchived",
  // Last of the filters and first of the things a workspace invented: it is the
  // only entry that opens onto names this build cannot know.
  "extra",
  // Beside `status`'s neighbours rather than beside `status` itself, because the
  // two are never substitutes (SPEC.md §5): `status` says whether work remains,
  // `stage` says where in a workflow the document is.
  "stage",
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

/** Queries that run as written; the first is the field's own placeholder. */
export const QUERY_EXAMPLES: readonly QueryExample[] = [
  { query: "type=thread&status=open", meaning: "Conversations still open." },
  { query: "needs=me&folder=finance", meaning: "Attention, inside one folder." },
  { query: "type=note,view&tag=finance", meaning: "Notes or views tagged finance." },
  { query: "due=week&sort=due", meaning: "Due within the week, soonest first." },
  // Shown because the name misleads and an example does not: this is the shape
  // of the request the user actually had — a list without the threads hanging
  // off its documents (UI-088).
  { query: "isParent=true&status=open", meaning: "Top-level only, still open." },
  // SPEC.md §5's **Structured fields** and §9.2's **Pattern matching**, shown
  // together because they arrived together and because neither is guessable
  // from the field list alone: one has a name this build cannot know, and the
  // other is a property of four fields' *values* rather than a syntax of its
  // own. There is deliberately no `QUERY_OPERATORS` entry for `*` — an operator
  // entry would claim a syntax the parser does not have.
  { query: "extra.assignee=theo", meaning: "A frontmatter field this workspace invented." },
  { query: "title=Catch-Up*", meaning: "Glob on a field: * is any run, ? is one." },
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
  return Object.keys(filter).filter(isUnknownField).sort();
}

/**
 * `extra.<key>` is a real filter whose **name** the schema cannot publish, so
 * one rule stands beside the field list rather than a second field list beside
 * it (SPEC.md §5's **Structured fields**).
 *
 * Without it every working `extra.assignee=theo` column would be marked as
 * naming a filter that does not exist — the exact warning this function exists
 * to raise for a genuine typo, aimed at the one filter a workspace invented on
 * purpose.
 *
 * The key rule is the contract's own {@link EXTRA_KEY_PATTERN}, imported rather
 * than restated, for the reason this module already gives about its value
 * lists: a copy here is a copy that can disagree with the server. `extra.a.b`
 * fails it, because the key is everything after the **first** dot and `a.b` is
 * not an identifier — do not split on the last one.
 */
function isUnknownField(name: string): boolean {
  if (name.startsWith(EXTRA_PARAM_PREFIX)) {
    return !EXTRA_KEY_PATTERN.test(name.slice(EXTRA_PARAM_PREFIX.length));
  }
  return !QUERY_FIELD_NAMES.includes(name);
}

/** The core document types, for the value vocabulary's "not in use yet" tail. */
export const CORE_TYPE_VALUES: readonly string[] = CORE_DOC_TYPES;
