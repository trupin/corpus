// `matchesQuery` — the collection query asked about one document (SERVER-138).
//
// The whole point of the function is that it is not a second implementation of
// the filter grammar, so the test that matters is **parity**: for every document
// in a real workspace and every query shape the board can store, the one-document
// answer and `GET /api/docs`'s own result set agree. A hand-written membership
// test would pass its own unit tests and disagree with the list a person is
// looking at, which is exactly the failure §5's coupling cannot afford.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FilterQuery } from "./filters.js";
import { boardScopeQuery } from "./kanban.js";
import { matchesQuery, queryDocIds } from "./query.js";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";

const NOW = Date.parse("2026-07-27T12:00:00Z");

let ws: Workspace;
let everyId: string[];

beforeAll(() => {
  ws = createWorkspace("matches-query");

  ws.doc({ id: "doc_inbox1", path: "data/docs/inbox/one.md", title: "Escrow one", tags: ["a"] });
  ws.doc({
    id: "doc_inbox2",
    path: "data/docs/inbox/two.md",
    title: "Escrow two",
    tags: ["a", "b"],
    frontmatter: { stage: "triage" },
  });
  ws.doc({
    id: "doc_finance",
    path: "data/docs/finance/mortgage.md",
    title: "Mortgage",
    tags: ["b"],
    due: "2026-07-20",
    frontmatter: { stage: "doing" },
  });
  ws.doc({
    id: "doc_archived",
    path: "data/docs/inbox/gone.md",
    title: "Gone",
    status: "archived",
    frontmatter: { stage: "doing" },
  });
  ws.doc({ id: "doc_view", path: "data/docs/views/a.md", type: "view", title: "A view" });
  ws.doc({
    id: "doc_ever",
    path: "data/docs/inbox/ever.md",
    title: "Evergreen",
    evergreen: true,
    updated: "2020-01-01T00:00:00Z",
  });
  ws.thread({ id: "th_parented", title: "Re: mortgage", parent: "doc_finance" });
  ws.thread({ id: "th_standalone", title: "A question", parent: null });

  ws.reproject();
  everyId = (ws.db.prepare("SELECT id FROM documents ORDER BY id").all() as { id: string }[]).map(
    (row) => row.id,
  );
});

afterAll(() => {
  ws.close();
});

/**
 * Every query shape a board can store, plus the ones that exercise the branches
 * a one-document statement could plausibly get wrong: the archived default, a
 * thread-only filter, an FTS query, and a `q` that carries no indexable token.
 */
const QUERIES: readonly (readonly [string, FilterQuery])[] = [
  ["no filters at all", {}],
  ["a folder", { folder: "inbox" }],
  ["a folder and archived included", { folder: "inbox", includeArchived: true }],
  ["a type", { type: "note" }],
  ["two types ORed", { type: "note,view" }],
  ["a tag", { tag: "a" }],
  ["two tags ORed", { tag: "a,b" }],
  ["a stage", { stage: "doing" }],
  ["a stage and the null sentinel", { stage: ",triage" }],
  ["the null sentinel alone", { stage: "" }],
  ["a stage with archived included", { stage: "doing", includeArchived: true }],
  ["an explicit status", { status: "archived" }],
  ["a due keyword", { due: "overdue" }],
  ["a staleness tier", { stale: "aging" }],
  ["a thread-only filter", { parent: "doc_finance" }],
  ["the structural filter", { isParent: true }],
  ["an attention reason", { needs: "due" }],
  ["full text", { q: "escrow" }],
  ["full text with a filter", { q: "escrow", folder: "inbox" }],
  ["full text that carries no token", { q: "!!!" }],
];

describe("matchesQuery agrees with the collection query, one document at a time", () => {
  it.each(QUERIES)("for %s", (_label, query) => {
    const listed = queryDocIds(ws.db, query, NOW);
    const asked = everyId.filter((id) => matchesQuery(ws.db, query, id, NOW));
    expect(asked).toEqual(listed);
  });

  it("answers false for an id no document holds", () => {
    expect(matchesQuery(ws.db, {}, "doc_nosuchthing", NOW)).toBe(false);
  });
});

describe("boardScopeQuery compiles a board's stored scope", () => {
  it("ORs an array the way the comma-separated wire form does", () => {
    expect(boardScopeQuery({ type: ["note", "view"] })).toMatchObject({ type: "note,view" });
  });

  it("forces archived documents in, because §5 says a kanban still holds them", () => {
    expect(boardScopeQuery({ folder: "inbox" })).toMatchObject({
      folder: "inbox",
      includeArchived: true,
    });
    expect(boardScopeQuery(null)).toMatchObject({ includeArchived: true });
  });

  /**
   * §10: "an unknown key degrades in the client, never on the wire". Here it
   * degrades in the server, for the same reason and one step further along: this
   * query belongs to a **third** document the caller never named, so refusing it
   * would make one board's typo break every stage write in the corpus.
   */
  it("drops a key the query grammar does not define rather than refusing", () => {
    const compiled = boardScopeQuery({ folder: "inbox", colour: "blue" }) as Record<
      string,
      unknown
    >;
    expect(compiled["folder"]).toBe("inbox");
    expect(compiled["colour"]).toBeUndefined();
  });

  it("falls back to the widest scope when a value is one no query can run", () => {
    // `status` is a closed enum, so this parse fails outright. The fallback is
    // every non-archived document plus the archived ones — visibly too wide,
    // rather than invisibly empty.
    expect(boardScopeQuery({ status: "nonsense" })).toEqual({ includeArchived: true });
  });

  it("drops the paging and ordering a stored query carries", () => {
    const compiled = boardScopeQuery({ folder: "inbox", sort: "title", limit: 5 }) as Record<
      string,
      unknown
    >;
    expect(compiled["sort"]).toBeUndefined();
    expect(compiled["limit"]).toBeUndefined();
    expect(compiled["offset"]).toBeUndefined();
  });
});
