// §10's **whole-result-set** selection, resolved into the ids one Save acts on.
//
// A staged set is enumerated rows — a document somebody looked at and chose a
// verb for — with one exception §10 states outright: "because there is no
// per-row gesture for rows nobody enumerated, a whole-result-set selection
// stages as a **single entry** … carrying one action for all of them", and "the
// count is re-evaluated when the Save runs". That last clause is why this module
// exists on the server at all: a set of ids the caller resolved before it sent
// would be a different promise, and the difference is exactly the documents that
// entered or left the result set in between.
//
// **The query is compiled, never re-implemented.** `ViewQuery` is the flat
// parameter map a `type: view` document already stores, so the only honest
// reading of "everything the query matches" is "what `GET /api/docs` would
// answer": the map is turned into that endpoint's own wire form, parsed with
// `DocsQuerySchema`, and run through `compileFilters` — the same predicates,
// the same archived default, the same thread-only no-ops. A second filter
// grammar here would let a Save write a set the board could never show.
//
// **An unrecognised key is a `400` for the whole request** (CONTRACT-048
// decision 2). A stored view's unknown key degrades in the client, because a
// column rendering one chip too few is harmless; here the query decides which
// documents get **written**, and a silently narrower — or silently wider — act
// is not something a caller can notice afterwards. `DocsQuerySchema` strips
// unknown keys rather than rejecting them, so the keys are checked against its
// shape here before it ever runs.

import {
  DocsQuerySchema,
  type BulkWholeResultSetEntry,
  type DocsQuery,
  type ValidationIssue,
  type ViewQuery,
} from "@corpus/contract";
import { queryDocIds } from "./query.js";
import { validationError, type DocsWorkspace } from "./write.js";

/** Every parameter `GET /api/docs` accepts, from the schema rather than a list. */
const QUERY_KEYS: ReadonlySet<string> = new Set(Object.keys(DocsQuerySchema.shape));

const ISSUE_PATH = "wholeResultSet.query";

const scalarToWire = (value: string | number | boolean): string =>
  typeof value === "string" ? value : String(value);

/**
 * One stored value in the wire form the collection query parses. Arrays OR
 * together as the comma-separated form (`{type: ["note","view"]}` ≡
 * `type=note,view`), which is the same translation the board makes when it turns
 * a column's stored query into a request — stated by `ViewQuerySchema` itself.
 *
 * Total, with no failure case: the contract's `ViewQuery` admits only strings,
 * finite numbers, booleans and arrays of those (JSON carries no `NaN`), so every
 * value that reaches here has a wire spelling. What a value *means* is
 * `DocsQuerySchema`'s question, and it answers with a `400`.
 */
const valueToWire = (value: ViewQuery[string]): string =>
  Array.isArray(value) ? value.map(scalarToWire).join(",") : scalarToWire(value);

/**
 * The column's query as the collection query, or a `400` naming what was wrong
 * with it.
 *
 * `limit`, `offset` and `sort` are accepted and then **deliberately ignored**:
 * they are how a column pages and orders what it *shows*, and §10's second
 * selection act extends the selection to "everything the query matches" — "all
 * 412 matching", not the fifty on screen. Refusing them instead would refuse the
 * board's own stored queries, which carry `sort` as a matter of course.
 */
export function compileSelectionQuery(query: ViewQuery): DocsQuery {
  const wire: Record<string, string> = {};
  const unknown: ValidationIssue[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (!QUERY_KEYS.has(key)) {
      unknown.push({
        path: `${ISSUE_PATH}.${key}`,
        message:
          `\`${key}\` is not a filter \`GET /api/docs\` accepts, so nothing here can say which ` +
          "documents it means. A stored view degrades on an unknown key; a Save cannot, because " +
          "this query decides what gets written (SPEC.md §10).",
      });
      continue;
    }
    wire[key] = valueToWire(value);
  }
  if (unknown.length > 0) {
    validationError("the whole-result-set query names a filter that does not exist", unknown);
  }

  const parsed = DocsQuerySchema.safeParse(wire);
  if (!parsed.success) {
    validationError(
      "the whole-result-set query is not a query the corpus can run",
      parsed.error.issues.map((issue) => ({
        path: [ISSUE_PATH, ...issue.path.map(String)].join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * The ids §10's single whole-result-set entry covers, **at the moment the Save
 * runs**.
 *
 * Read outside every write lane, because which lanes the act holds is decided
 * from this list — so a document created between this read and the first write
 * is not in the act, exactly as one created a second before the Save was pressed
 * would not be. §10 asks for the count to be re-evaluated *when the Save runs*,
 * which this is, and for the result to report what actually changed, which the
 * three parts do.
 */
export function resolveWholeResultSet(
  workspace: DocsWorkspace,
  entry: BulkWholeResultSetEntry,
): string[] {
  return queryDocIds(workspace.projection, compileSelectionQuery(entry.query), workspace.now());
}
