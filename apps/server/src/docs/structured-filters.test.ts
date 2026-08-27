import { DocsQuerySchema, splitExtraParams, type DocList, type DocsQuery } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { queryDocs } from "./query.js";

/**
 * SPEC.md §5's **Structured fields** and §9.2's **Pattern matching** — the rider
 * signed 2026-08-04 (SHARED-011), against a real projection.
 *
 * The workspace is seeded through real `.md` files by the real projector, so a
 * passing assertion here is a statement about what the server answers for a
 * workspace somebody could have typed by hand.
 */

let ws: Workspace;

/**
 * Parsed exactly as the route parses it, lift included — so a test that passes
 * here is testing the path a request takes and not a hand-built query object.
 */
function run(params: Record<string, string> = {}): DocList {
  const split = splitExtraParams(params);
  const parsed: DocsQuery = DocsQuerySchema.parse(split.params);
  const query = split.extra === undefined ? parsed : { ...parsed, extra: split.extra };
  return queryDocs(ws.db, query, Date.parse("2026-07-26T12:00:00Z"));
}

const ids = (list: DocList): string[] => list.items.map((item) => item.id).sort();

beforeAll(() => {
  ws = createWorkspace("structured-filters");

  ws.doc({
    id: "doc_theo",
    path: "data/docs/work/tasks/one.md",
    title: "Catch-Up with the broker",
    tags: ["work"],
    body: "Ring the broker about the rate assumption.",
    frontmatter: { assignee: "theo", estimate: 3 },
  });
  ws.doc({
    id: "doc_sam",
    path: "data/docs/work/tasks/two.md",
    title: "Catch-Up with the notary",
    tags: ["Work", "urgent"],
    body: "Notary appointment, Thursday.",
    frontmatter: { assignee: "sam" },
  });
  ws.doc({
    id: "doc_team",
    path: "data/docs/work/plans/three.md",
    title: "Quarterly plan",
    body: "Nothing about brokers here.",
    frontmatter: { owners: ["theo", "dana"] },
  });
  // Carries no invented field at all: the control for "absence never matches".
  ws.doc({
    id: "doc_plain",
    path: "data/docs/personal/four.md",
    title: "Groceries",
    body: "Bread, milk.",
  });
  // A key differing only in case, which `json_extract` distinguishes.
  ws.doc({
    id: "doc_cased",
    path: "data/docs/personal/five.md",
    title: "Casing",
    frontmatter: { Assignee: "theo" },
  });
  // A nested object under an invented key: `json_each` would walk its members.
  ws.doc({
    id: "doc_nested",
    path: "data/docs/personal/six.md",
    title: "Nested",
    frontmatter: { address: { city: "theo" } },
  });

  ws.reproject();
});

afterAll(() => ws.close());

describe("extra.<key>", () => {
  it("matches a document carrying the field with that value", () => {
    expect(ids(run({ "extra.assignee": "theo" }))).toEqual(["doc_theo"]);
  });

  it("never matches a document that does not carry the key", () => {
    // The control: `doc_plain` has no `assignee` at all, and no value — not even
    // a wildcard — brings it back.
    expect(ids(run({ "extra.assignee": "*" }))).toEqual(["doc_sam", "doc_theo"]);
    expect(ids(run({ "extra.assignee": "theo" }))).not.toContain("doc_plain");
  });

  it("takes a glob in the value", () => {
    expect(ids(run({ "extra.assignee": "t*" }))).toEqual(["doc_theo"]);
    expect(ids(run({ "extra.assignee": "?am" }))).toEqual(["doc_sam"]);
  });

  it("matches any element when the field holds an array, the way `tag` ORs", () => {
    expect(ids(run({ "extra.owners": "dana" }))).toEqual(["doc_team"]);
    expect(ids(run({ "extra.owners": "the*" }))).toEqual(["doc_team"]);
    expect(ids(run({ "extra.owners": "nobody" }))).toEqual([]);
  });

  it("matches a non-string value by its text", () => {
    // `estimate: 3` is a JSON number in `extra_json`. Everything is a string
    // match — the rider signed no comparison operators — so `3` finds it and
    // `>2` is not a thing anyone can write.
    expect(ids(run({ "extra.estimate": "3" }))).toEqual(["doc_theo"]);
  });

  it("ANDs several keys, like every other filter", () => {
    expect(ids(run({ "extra.assignee": "theo", "extra.estimate": "3" }))).toEqual(["doc_theo"]);
    expect(ids(run({ "extra.assignee": "sam", "extra.estimate": "3" }))).toEqual([]);
  });

  it("keeps two keys that differ only in case apart", () => {
    // A key is an identifier its author chose and `json_extract` is
    // case-sensitive, so `Assignee` is genuinely a different field. Only the
    // *value* comparison is case-insensitive.
    expect(ids(run({ "extra.Assignee": "theo" }))).toEqual(["doc_cased"]);
    expect(ids(run({ "extra.assignee": "theo" }))).toEqual(["doc_theo"]);
  });

  it("composes with a core filter by intersection", () => {
    expect(ids(run({ "extra.assignee": "theo", tag: "work" }))).toEqual(["doc_theo"]);
    expect(ids(run({ "extra.assignee": "theo", tag: "urgent" }))).toEqual([]);
  });

  /**
   * Found in flight and fixed here, so it stays fixed: the first version read
   * the type with `json_type(json_extract(d.extra_json, path))`, whose
   * one-argument form re-parses what it is handed. An extracted word like
   * `theo` is not valid JSON, so **every** query against a field holding a word
   * raised `malformed JSON` from SQLite. It survived a one-document fixture and
   * died on two.
   */
  it("reads a field holding a bare word without raising", () => {
    expect(() => run({ "extra.assignee": "theo" })).not.toThrow();
    expect(ids(run({ "extra.assignee": "anything" }))).toEqual([]);
  });

  it("does not walk into a nested object", () => {
    // `extra.address=theo` matching a nested `{ city: "theo" }` is a claim
    // nobody has made, and `json_each` would happily make it.
    expect(ids(run({ "extra.address": "theo" }))).toEqual([]);
    expect(ids(run({ "extra.address": "*" }))).toEqual([]);
  });

  /**
   * The key becomes a JSON path, so it binds. Validation refuses this key
   * upstream; the bind is the guard that holds whether or not it stays correct.
   */
  it("never lets a key become SQL text", () => {
    expect(() => run({ 'extra.a"b': "x" })).toThrow();
  });
});

describe("glob patterns", () => {
  it("matches a title exactly without a wildcard, and by pattern with one", () => {
    expect(ids(run({ title: "Groceries" }))).toEqual(["doc_plain"]);
    expect(ids(run({ title: "Catch-Up*" }))).toEqual(["doc_sam", "doc_theo"]);
    expect(ids(run({ title: "*broker" }))).toEqual(["doc_theo"]);
    // Exact means exact: a substring is spelled with wildcards, not implied.
    expect(ids(run({ title: "Catch-Up" }))).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(ids(run({ title: "groceries" }))).toEqual(["doc_plain"]);
    expect(ids(run({ title: "catch-up*" }))).toEqual(["doc_sam", "doc_theo"]);
  });

  it("reads a body from the indexed text rather than the excerpt", () => {
    expect(ids(run({ body: "*rate assumption*" }))).toEqual(["doc_theo"]);
    expect(ids(run({ body: "*Thursday*" }))).toEqual(["doc_sam"]);
    expect(ids(run({ body: "*nothing in this corpus*" }))).toEqual([]);
  });

  it("takes a glob on a tag, and leaves a wildcard-free tag exactly as it was", () => {
    expect(ids(run({ tag: "work" }))).toEqual(["doc_sam", "doc_theo"]);
    expect(ids(run({ tag: "w*" }))).toEqual(["doc_sam", "doc_theo"]);
    expect(ids(run({ tag: "urg*" }))).toEqual(["doc_sam"]);
    expect(ids(run({ tag: "u*,w*" }))).toEqual(["doc_sam", "doc_theo"]);
  });

  it("takes a glob on a folder, with or without the root spelled out", () => {
    expect(ids(run({ folder: "work/tasks/*" }))).toEqual(["doc_sam", "doc_theo"]);
    expect(ids(run({ folder: "data/docs/work/tasks/*" }))).toEqual(["doc_sam", "doc_theo"]);
    expect(ids(run({ folder: "work/*" }))).toEqual(["doc_sam", "doc_team", "doc_theo"]);
  });

  it("leaves a wildcard-free folder the prefix match it has always been", () => {
    expect(ids(run({ folder: "work" }))).toEqual(["doc_sam", "doc_team", "doc_theo"]);
    expect(ids(run({ folder: "work", folderScope: "self" }))).toEqual([]);
    expect(ids(run({ folder: "work/tasks", folderScope: "self" }))).toEqual([
      "doc_sam",
      "doc_theo",
    ]);
  });

  it("refuses a scope alongside a pattern rather than guessing at it", () => {
    expect(() => run({ folder: "work/*", folderScope: "self" })).toThrow();
  });
});
