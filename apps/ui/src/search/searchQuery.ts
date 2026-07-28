import type { DocsFilter } from "@corpus/kit";

/**
 * One query shape, three consumers (SPEC.md §11 — the search overlay, and
 * "save as view" pinning that search as a board column).
 *
 * Everything the overlay knows about a search lives in {@link SearchQuery}, and
 * two pure serializers take it the rest of the way: {@link toApiParams} to the
 * single `GET /api/docs` request, and {@link toViewFrontmatter} to the `query`
 * map of a `type: view` document. They are the *same* map — the view frontmatter
 * is the wire form, stringified — which is what makes save-as-view literally
 * "write the current search to a document" and what makes a column re-read it
 * without a translation layer. `viewDoc.ts` compiles that stored map straight
 * back into the filter a column queries with, so there is exactly one grammar in
 * play and nothing to keep in sync.
 *
 * **The archived default is the server's, not this file's.** `docs/query.ts`
 * excludes `status: archived` whenever `status` is absent, so the default is
 * expressed by *omission* here. The `include archived` chip lifts it with
 * `includeArchived=true` rather than by naming a status, because `status` is one
 * value and `status=archived` would narrow to archived-only — the opposite of
 * what the chip's label promises (sprint-010 Open Conflict 3).
 */

/** The lifecycle statuses the status chip offers, straight off the contract. */
export type SearchStatus = NonNullable<DocsFilter["status"]>;
/** Agent-participation states, thread-only (SPEC.md §6). */
export type SearchAgent = NonNullable<DocsFilter["agent"]>;
/** The Attention vocabulary; the overlay offers `form` (SHARED-002). */
export type SearchNeeds = NonNullable<DocsFilter["needs"]>;

export interface SearchQuery {
  /** The FTS text. Empty is legal: filters compose without `q`. */
  readonly text: string;
  /** Comma-separated document types, OR-ing together on the wire. */
  readonly type: string | null;
  readonly tag: string | null;
  readonly status: SearchStatus | null;
  readonly folder: string | null;
  /** ISO 8601 instant — `updated` strictly after it. */
  readonly since: string | null;
  /** An ISO calendar date, or one of the contract's due keywords. */
  readonly due: string | null;
  readonly unread: boolean;
  /** A document id: rows whose body contains `[[<id>]]`. */
  readonly references: string | null;
  readonly agent: SearchAgent | null;
  readonly needs: SearchNeeds | null;
  /** A document id: threads hanging off it. */
  readonly parent: string | null;
  /** Lifts the server's default exclusion of `status: archived`. */
  readonly includeArchived: boolean;
}

export const EMPTY_SEARCH_QUERY: SearchQuery = {
  text: "",
  type: null,
  tag: null,
  status: null,
  folder: null,
  since: null,
  due: null,
  unread: false,
  references: null,
  agent: null,
  needs: null,
  parent: null,
  includeArchived: false,
};

/**
 * `GET /api/docs` parameters, plus the one the contract has not grown yet.
 *
 * `includeArchived` is CONTRACT-012's rider (sprint-010 adjudication 3). It is
 * declared as an intersection rather than waited for so the overlay ships the
 * chip its label promises: the kit forwards unknown filters verbatim and zod
 * strips unknown query keys server-side, so the parameter is inert — not wrong —
 * until the contract and server halves land, at which point this declaration
 * collapses into the generated one.
 */
export type SearchApiParams = DocsFilter & {
  readonly includeArchived?: boolean | undefined;
};

/** The sort a text search wants; the contract rejects it without a `q`. */
export const RELEVANCE_SORT = "relevance";

/**
 * The single request a search issues. Every active chip is a query parameter and
 * nothing is filtered afterwards — SPEC.md §11's "all through the single
 * `GET /api/docs` endpoint" is a statement about this function.
 */
export function toApiParams(query: SearchQuery): SearchApiParams {
  const text = query.text.trim();
  return {
    // `sort=relevance` is only legal alongside `q`; without text the server's
    // own `-updated` default is the honest ordering.
    ...(text === "" ? {} : { q: text, sort: RELEVANCE_SORT }),
    ...(query.type === null ? {} : { type: query.type }),
    ...(query.tag === null ? {} : { tag: query.tag }),
    ...(query.status === null ? {} : { status: query.status }),
    ...(query.folder === null ? {} : { folder: query.folder }),
    ...(query.since === null ? {} : { since: query.since }),
    ...(query.due === null ? {} : { due: query.due }),
    ...(query.unread ? { unread: true } : {}),
    ...(query.references === null ? {} : { references: query.references }),
    ...(query.agent === null ? {} : { agent: query.agent }),
    ...(query.needs === null ? {} : { needs: query.needs }),
    ...(query.parent === null ? {} : { parent: query.parent }),
    ...(query.includeArchived ? { includeArchived: true } : {}),
  };
}

/**
 * The `query` frontmatter of the view document save-as-view creates: the same
 * parameters, as the strings a YAML map holds and `viewDoc.ts` compiles back.
 */
export function toViewFrontmatter(query: SearchQuery): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const [key, value] of Object.entries(toApiParams(query))) {
    if (value === undefined || value === null) continue;
    stored[key] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return stored;
}

function readBoolean(value: string | undefined): boolean {
  return value === "true";
}

function readString(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

/**
 * A stored view query, read back as a {@link SearchQuery}.
 *
 * The round trip this closes is the point of the module: a column saved from a
 * search re-opens as that search, and the unit test proves
 * `toApiParams(fromViewFrontmatter(toViewFrontmatter(q)))` equals
 * `toApiParams(q)` — including the archived default, which survives by being
 * absent from both.
 *
 * Values the overlay has no chip for are dropped rather than guessed at: this
 * reads what save-as-view wrote, and a hand-edited view document remains the
 * column's business, not the overlay's.
 */
export function fromViewFrontmatter(stored: Readonly<Record<string, string>>): SearchQuery {
  const status = readString(stored["status"]);
  const agent = readString(stored["agent"]);
  const needs = readString(stored["needs"]);
  return {
    text: stored["q"] ?? "",
    type: readString(stored["type"]),
    tag: readString(stored["tag"]),
    status: status === null ? null : (status as SearchStatus),
    folder: readString(stored["folder"]),
    since: readString(stored["since"]),
    due: readString(stored["due"]),
    unread: readBoolean(stored["unread"]),
    references: readString(stored["references"]),
    agent: agent === null ? null : (agent as SearchAgent),
    needs: needs === null ? null : (needs as SearchNeeds),
    parent: readString(stored["parent"]),
    includeArchived: readBoolean(stored["includeArchived"]),
  };
}

/** True when nothing has been typed and no chip is set. */
export function isEmptyQuery(query: SearchQuery): boolean {
  return Object.keys(toApiParams(query)).length === 0;
}

/**
 * The title a saved view is born with: the search text, or the filters that
 * stand in for it. Never empty — a column with a blank name is unusable, and the
 * user renames it in place anyway.
 */
export function describeQuery(query: SearchQuery): string {
  const text = query.text.trim();
  if (text !== "") return text;
  const parts = Object.entries(toViewFrontmatter(query))
    .filter(([key]) => key !== "sort")
    .map(([key, value]) => `${key}: ${value}`);
  return parts.length === 0 ? "All documents" : parts.join(" · ");
}
