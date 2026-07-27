// Full-text search over the projection's `search` table (SPEC.md §9.1, §11):
// turning a human query string into an FTS5 expression that cannot be a syntax
// error, and turning FTS5's `snippet()` output into the contract's structured
// segments.
//
// Two hard constraints shape this module:
//
// - **`q` is never passed to FTS5 as written.** `"unbalanced`, `)))`, `*` and
//   `NEAR(...)` are all either syntax errors or operators, and an error here
//   would be a 500 on a search box (sprint-004 TEST-40). The user's text is
//   tokenized and re-emitted as quoted literals, so the only expression FTS5
//   ever sees is one this module built.
// - **Highlights cross the wire as data, not markup.** The contract's `Snippet`
//   is alternating `{text, match}` segments precisely so the UI never renders
//   server HTML. `snippet()` still needs *some* delimiter, so it gets two ASCII
//   control characters that cannot occur in a markdown corpus, and they are
//   consumed here — never serialized.

import {
  SNIPPET_FIELDS,
  type Snippet,
  type SnippetField,
  type SnippetSegment,
} from "@corpus/contract";

/**
 * Delimiters handed to `snippet()`, stripped again by {@link parseSnippets}.
 * ASCII STX/ETX: control characters a markdown corpus does not contain, so
 * document text cannot forge a highlight the user never searched for.
 */
export const SNIPPET_OPEN = "\u0002";
export const SNIPPET_CLOSE = "\u0003";
export const SNIPPET_ELLIPSIS = "…";

/** Tokens of context `snippet()` returns around a hit. */
export const SNIPPET_TOKENS = 12;

/**
 * How many tokens of `q` reach the FTS expression. A 1 KB paste is a legitimate
 * request (TEST-40) but a 200-term AND chain is not a query anyone meant to run.
 */
export const MAX_QUERY_TOKENS = 24;

/** Snippets carried per row. A thread with 80 matching turns is not 80 excerpts. */
export const MAX_SNIPPETS_PER_ROW = 5;

// Letters, numbers and underscore, matching what `unicode61` indexes; every
// other character is a separator to FTS5 and would only be dropped later.
const TOKEN = /[\p{L}\p{N}_]+/gu;

/**
 * The FTS5 expression for a user query, or `null` when the query carries no
 * indexable token at all (`*`, `)))`, punctuation). `null` means "match
 * nothing" — deliberately not "match everything", because a search box that
 * silently ignores its own query is worse than one that returns no rows.
 *
 * The final token is a prefix term so autocomplete finds `escro|` → `escrow`;
 * earlier tokens are exact, because a mid-query prefix would broaden a
 * deliberately narrow phrase.
 */
export function toFtsMatchExpression(query: string): string | null {
  const tokens = [...query.matchAll(TOKEN)].map((match) => match[0]).slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return null;
  return tokens
    .map((token, index) => `"${token}"${index === tokens.length - 1 ? "*" : ""}`)
    .join(" AND ");
}

/** One `search` row that matched, as aggregated by the query's `hits` CTE. */
interface SearchHit {
  readonly kind: string;
  readonly ref: string;
  readonly title: string;
  readonly body: string;
}

const isSearchHit = (value: unknown): value is SearchHit => {
  if (value === null || typeof value !== "object") return false;
  const hit = value as Record<string, unknown>;
  return (
    typeof hit.kind === "string" &&
    typeof hit.ref === "string" &&
    typeof hit.title === "string" &&
    typeof hit.body === "string"
  );
};

/**
 * Splits one `snippet()` result into contract segments, or `null` when the
 * excerpt carries no highlight at all — which is how a column that did not
 * match is told apart from one that did: `snippet()` returns the head of every
 * column it is asked about, marked up only where the query actually hit.
 */
export function toSegments(excerpt: string): SnippetSegment[] | null {
  const segments: SnippetSegment[] = [];
  let matched = false;
  let rest = excerpt;

  for (;;) {
    const open = rest.indexOf(SNIPPET_OPEN);
    if (open < 0) {
      if (rest !== "") segments.push({ text: rest, match: false });
      break;
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), match: false });

    const close = rest.indexOf(SNIPPET_CLOSE, open + 1);
    const text = close < 0 ? rest.slice(open + 1) : rest.slice(open + 1, close);
    if (text !== "") {
      segments.push({ text, match: true });
      matched = true;
    }
    if (close < 0) break;
    rest = rest.slice(close + 1);
  }

  return matched ? segments : null;
}

/** `ref` of a turn row is `<threadId>#<turn ts>` (projection/project-document.ts). */
const threadIdOf = (ref: string): string => {
  const hash = ref.indexOf("#");
  return hash < 0 ? ref : ref.slice(0, hash);
};

function hitSnippets(hit: SearchHit): Snippet[] {
  if (hit.kind === "turn") {
    const segments = toSegments(hit.body);
    return segments === null ? [] : [{ field: "turn", threadId: threadIdOf(hit.ref), segments }];
  }
  const columns = [
    ["title", hit.title],
    ["body", hit.body],
  ] as const satisfies readonly (readonly [SnippetField, string])[];

  const snippets: Snippet[] = [];
  for (const [field, excerpt] of columns) {
    const segments = toSegments(excerpt);
    if (segments !== null) snippets.push({ field, segments });
  }
  return snippets;
}

const FIELD_ORDER = new Map(SNIPPET_FIELDS.map((field, index) => [field, index]));

/**
 * The `snippets` column of a result row: the JSON array the query's `hits` CTE
 * aggregated, converted to contract snippets. Malformed or absent JSON yields
 * no snippets rather than failing the request — a row is still a valid answer
 * without its highlights.
 */
export function parseSnippets(json: string | null): Snippet[] {
  if (json === null || json === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const snippets = parsed
    .filter(isSearchHit)
    .flatMap(hitSnippets)
    .sort(
      (left, right) => (FIELD_ORDER.get(left.field) ?? 0) - (FIELD_ORDER.get(right.field) ?? 0),
    );
  return snippets.slice(0, MAX_SNIPPETS_PER_ROW);
}
