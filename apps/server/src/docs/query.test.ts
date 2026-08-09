import {
  DocListSchema,
  DocsQuerySchema,
  FORM_ANSWER_LABEL,
  STALE_TIERS,
  type DocList,
  type DocRow,
  type DocsQuery,
  type StaleTier,
} from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInstant } from "../core/time.js";
import { EXCERPT_LENGTH } from "../projection/index.js";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { UNANSWERED_FORM_COUNT_SQL } from "./needs.js";
import { UNREAD_THREADS_SQL, folderPathPrefix, queryDocs } from "./query.js";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => formatInstant(NOW - days * MS_PER_DAY);
const dateIn = (days: number): string =>
  new Date(NOW + days * MS_PER_DAY).toISOString().slice(0, 10);

let ws: Workspace;

/** Parsed exactly as the route parses it, so defaults and coercions are the real ones. */
function run(params: Record<string, string> = {}): DocList {
  const query: DocsQuery = DocsQuerySchema.parse(params);
  return queryDocs(ws.db, query, NOW);
}

const ids = (list: DocList): string[] => list.items.map((item) => item.id).sort();

beforeAll(() => {
  ws = createWorkspace("query");

  // Folders, types, tags, statuses.
  ws.doc({
    id: "doc_fresh",
    path: "data/docs/inbox/fresh.md",
    updated: daysAgo(10),
    tags: ["inbox"],
  });
  ws.doc({ id: "doc_aging", path: "data/docs/inbox/aging.md", updated: daysAgo(45) });
  ws.doc({
    id: "doc_stale",
    path: "data/docs/finance/stale.md",
    updated: daysAgo(100),
    tags: ["finance"],
  });
  ws.doc({
    id: "doc_verystale",
    path: "data/docs/finance/2026/very.md",
    updated: daysAgo(200),
    tags: ["finance", "urgent"],
  });
  ws.doc({ id: "doc_reviewed", updated: daysAgo(200), reviewed: daysAgo(1) });
  ws.doc({ id: "doc_evergreen", updated: daysAgo(200), evergreen: true });
  ws.doc({ id: "doc_archived", status: "archived", tags: ["finance"] });
  ws.doc({ id: "doc_view", type: "view", title: "Attention" });
  ws.doc({ id: "doc_template", type: "template" });
  ws.doc({
    id: "doc_mortgage",
    path: "data/docs/finance/mortgage.md",
    title: "Escrow basics",
    tags: ["Finance"],
    body: "Payments, taxes and insurance.",
  });
  ws.doc({
    id: "doc_amort",
    path: "data/docs/finance/2026/q1.md",
    title: "Q1",
    body: "The amortization schedule for [[doc_mortgage]] is attached.",
  });
  ws.doc({ id: "doc_legal", path: "data/docs/legal/nda.md", title: "NDA" });

  // Deadlines.
  ws.doc({ id: "doc_dueyesterday", due: dateIn(-1) });
  ws.doc({ id: "doc_duetoday", due: dateIn(0) });
  ws.doc({ id: "doc_duefour", due: dateIn(4) });
  ws.doc({ id: "doc_dueforty", due: dateIn(40) });
  // Two reasons at once: overdue *and* very stale.
  ws.doc({ id: "doc_overduestale", due: dateIn(-3), updated: daysAgo(200) });
  ws.doc({ id: "doc_failed", title: "Failed job subject" });

  // Threads: agent states, read state, an unanswered form, a standalone.
  ws.thread({
    id: "th_engaged",
    title: "Re: rates",
    parent: "doc_mortgage",
    agent: "engaged",
    updated: daysAgo(4),
    turns: [
      { author: "user", ts: daysAgo(5), body: "What about the rate?" },
      { author: "agent", ts: daysAgo(4), body: "It moved to 6.4%." },
    ],
  });
  ws.thread({
    id: "th_form",
    title: "Pick one",
    parent: "doc_amort",
    agent: "requested",
    updated: daysAgo(6),
    turns: [
      { author: "user", ts: daysAgo(7), body: "Which option?" },
      {
        author: "agent",
        ts: daysAgo(6),
        body: "That is a cherry-picked assumption.\n\n```form\nprompt: Pick one\noptions: [a, b]\n```\n",
      },
    ],
  });
  ws.thread({
    id: "th_standalone",
    title: "Ask",
    parent: null,
    agent: "none",
    updated: daysAgo(8),
    turns: [{ author: "user", ts: daysAgo(8), body: "A standalone question." }],
  });
  ws.thread({
    id: "th_seen",
    title: "Read already",
    parent: "doc_legal",
    agent: "engaged",
    updated: daysAgo(9),
    turns: [
      { author: "user", ts: daysAgo(10), body: "Ping." },
      { author: "agent", ts: daysAgo(9), body: "Pong." },
    ],
  });
  ws.thread({
    id: "th_never",
    title: "Never opened",
    parent: "doc_legal",
    agent: "none",
    updated: daysAgo(3),
    turns: [{ author: "user", ts: daysAgo(3), body: "Hello." }],
  });

  ws.seen({
    th_engaged: daysAgo(6),
    th_form: daysAgo(1),
    th_standalone: daysAgo(1),
    th_seen: daysAgo(1),
  });
  ws.failedEvent("evt_failedone", { parentId: "doc_failed" });
  ws.reproject();
});

afterAll(() => {
  ws.close();
});

describe("the envelope", () => {
  it("answers `{items, page}` with the declared defaults", () => {
    const list = run();
    expect(Object.keys(list).sort()).toEqual(["items", "page"]);
    expect(list.page).toEqual({ total: list.page.total, limit: 50, offset: 0 });
    expect(list.page.total).toBeGreaterThan(0);
  });

  it("emits rows the contract can parse, with no extra keys", () => {
    const list = run({ q: "escrow" });
    expect(DocListSchema.parse(list)).toEqual(list);
    const row = list.items[0];
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "agent",
      "anchorQuote",
      "attention",
      "awaitingAgent",
      "column",
      "created",
      "due",
      "evergreen",
      "excerpt",
      "extra",
      "id",
      "lastAuthor",
      "lastTurn",
      "order",
      "parent",
      "parentTitle",
      "path",
      "pinned",
      "query",
      "reviewed",
      "snippets",
      "stale",
      "status",
      "tags",
      "title",
      "turnCount",
      "type",
      "unansweredForms",
      "unread",
      "unreadThreads",
      "updated",
    ]);
  });

  it("carries `attention` on every response and empty `snippets` without `q`", () => {
    for (const row of run().items) {
      expect(Array.isArray(row.attention)).toBe(true);
      expect(row.snippets).toEqual([]);
      expect(row.attention).not.toContain("me");
    }
  });

  it("answers an empty corpus honestly", () => {
    const empty = createWorkspace("empty");
    try {
      empty.reproject();
      expect(queryDocs(empty.db, DocsQuerySchema.parse({}), NOW)).toEqual({
        items: [],
        page: { total: 0, limit: 50, offset: 0 },
      });
    } finally {
      empty.close();
    }
  });
});

describe("structured filters", () => {
  it("ORs comma-separated types", () => {
    expect(ids(run({ type: "view,template" }))).toEqual(["doc_template", "doc_view"]);
  });

  it("excludes archived by default and returns it only when asked", () => {
    expect(ids(run())).not.toContain("doc_archived");
    expect(ids(run({ status: "archived" }))).toEqual(["doc_archived"]);
    expect(ids(run({ status: "open" }))).not.toContain("doc_archived");
  });

  it("widens the default into the union with `includeArchived`, rather than narrowing", () => {
    // The chip reads "include archived", so it must be a union: everything the
    // default returns, plus the archived rows — not `status=archived`'s
    // archived-only narrowing (CONTRACT-012).
    const included = ids(run({ includeArchived: "true", limit: "200" }));
    const defaulted = ids(run({ limit: "200" }));
    expect(included).toContain("doc_archived");
    for (const id of defaulted) expect(included).toContain(id);
    expect(included).toEqual([...defaulted, "doc_archived"].sort());
    // …and the archived-only reading is still available, unchanged.
    expect(ids(run({ status: "archived" }))).toEqual(["doc_archived"]);
  });

  it("leaves `includeArchived=false` as today's behaviour, exactly", () => {
    expect(ids(run({ includeArchived: "false", limit: "200" }))).toEqual(
      ids(run({ limit: "200" })),
    );
  });

  it("is a documented no-op alongside an explicit `status`", () => {
    // `status` replaces the default filter outright, so there is no default left
    // to widen: each pair is the same result set as the `status` alone.
    expect(ids(run({ status: "open", includeArchived: "true", limit: "200" }))).toEqual(
      ids(run({ status: "open", limit: "200" })),
    );
    expect(ids(run({ status: "archived", includeArchived: "true" }))).toEqual(["doc_archived"]);
  });

  it("counts the union it returns", () => {
    // The page and the COUNT share the WHERE clause, so the widened default is
    // one change, not two that could disagree.
    const page = run({ includeArchived: "true", limit: "200" });
    expect(page.page.total).toBe(page.items.length);
    expect(page.page.total).toBe(run({ limit: "200" }).page.total + 1);
  });

  it("ORs tags case-insensitively", () => {
    expect(ids(run({ tag: "finance,urgent" }))).toEqual([
      "doc_mortgage",
      "doc_stale",
      "doc_verystale",
    ]);
    expect(ids(run({ tag: "FINANCE" }))).toEqual(ids(run({ tag: "finance" })));
  });

  it("scopes `folder` by prefix, includes descendants, and pulls in threads", () => {
    expect(ids(run({ folder: "finance" }))).toEqual([
      "doc_amort",
      "doc_mortgage",
      "doc_stale",
      "doc_verystale",
      "th_engaged",
      "th_form",
    ]);
    expect(ids(run({ folder: "finance/2026" }))).toEqual(["doc_amort", "doc_verystale", "th_form"]);
    expect(ids(run({ folder: "finance/" }))).toEqual(ids(run({ folder: "finance" })));
    expect(ids(run({ folder: "data/docs/finance" }))).toEqual(ids(run({ folder: "finance" })));
    expect(run({ folder: "nope" })).toEqual({
      items: [],
      page: { total: 0, limit: 50, offset: 0 },
    });
  });

  it("treats `/` as the whole `data/docs/` root", () => {
    const root = ids(run({ folder: "/", limit: "200" }));
    expect(root).toContain("doc_legal");
    expect(root).toContain("th_engaged");
    // Threads whose parent is gone are orphaned records and cannot be placed.
    expect(root).not.toContain("th_standalone");
  });

  it("reads `references` from the links table", () => {
    expect(ids(run({ references: "doc_mortgage" }))).toEqual(["doc_amort"]);
  });

  it("filters `since` strictly after `updated`", () => {
    const since = ids(run({ since: daysAgo(11), limit: "200" }));
    expect(since).toContain("doc_fresh");
    expect(since).not.toContain("doc_aging");
    // A row whose `updated` equals the boundary exactly is excluded — the
    // contract says strictly after.
    expect(ids(run({ since: daysAgo(10), limit: "200" }))).not.toContain("doc_fresh");
  });

  it("resolves the three `due` keywords and an explicit date", () => {
    expect(ids(run({ due: "overdue" }))).toEqual(["doc_dueyesterday", "doc_overduestale"]);
    expect(ids(run({ due: "today" }))).toEqual([
      "doc_duetoday",
      "doc_dueyesterday",
      "doc_overduestale",
    ]);
    expect(ids(run({ due: "week" }))).toEqual([
      "doc_duefour",
      "doc_duetoday",
      "doc_dueyesterday",
      "doc_overduestale",
    ]);
    expect(ids(run({ due: dateIn(5) }))).toEqual(ids(run({ due: "week" })));
    expect(ids(run({ due: "week" }))).not.toContain("doc_dueforty");
    expect(ids(run({ due: "week" }))).not.toContain("doc_fresh");
  });
});

describe("degenerate inputs", () => {
  it("matches nothing when a list parameter carries only separators", () => {
    expect(run({ type: "," })).toMatchObject({ items: [], page: { total: 0 } });
    expect(run({ tag: " , " })).toMatchObject({ items: [], page: { total: 0 } });
  });

  it("accepts the folder root spelled out in full", () => {
    expect(folderPathPrefix("data/docs")).toBe("data/docs/");
    expect(ids(run({ folder: "data/docs", limit: "200" }))).toEqual(
      ids(run({ folder: "/", limit: "200" })),
    );
  });

  it("normalizes a sub-second `since` down to the column's precision", () => {
    const withMillis = `${daysAgo(11).slice(0, 19)}.500Z`;
    expect(ids(run({ since: withMillis, limit: "200" }))).toEqual(
      ids(run({ since: daysAgo(11), limit: "200" })),
    );
  });

  it("falls back to the default sort when `q` carries no indexable token", () => {
    expect(run({ q: "***", sort: "relevance" })).toEqual({
      items: [],
      page: { total: 0, limit: 50, offset: 0 },
    });
  });

  it("serializes a row whose projected columns are damaged", () => {
    const damaged = createWorkspace("damaged");
    try {
      damaged.doc({ id: "doc_ok" });
      damaged.reproject();
      // A corrupted cache.db is recoverable by `corpus db rebuild`; until then a
      // list must still answer rather than 500.
      damaged.db.sqlite
        .prepare("UPDATE documents SET tags_json = ?, created = NULL, updated = NULL")
        .run("{not-an-array");
      const [row] = queryDocs(damaged.db, DocsQuerySchema.parse({}), NOW).items;
      // CONTRACT-005: a missing timestamp is reported as `null`, never as an
      // epoch sentinel — "we do not know" is not "1970".
      expect(row).toMatchObject({ id: "doc_ok", tags: [], created: null, updated: null });
      // An undated document has no known age, so it is neither stale nor
      // flagged: an unknown age is not an old one.
      expect(row?.stale).toBeNull();
      expect(row?.attention).toEqual([]);
    } finally {
      damaged.close();
    }
  });

  it("drops a tag entry that is not a string", () => {
    const damaged = createWorkspace("tags");
    try {
      damaged.doc({ id: "doc_ok", tags: ["keep"] });
      damaged.reproject();
      damaged.db.sqlite.prepare("UPDATE documents SET tags_json = ?").run('["keep", 7]');
      expect(queryDocs(damaged.db, DocsQuerySchema.parse({}), NOW).items[0]?.tags).toEqual([
        "keep",
      ]);
    } finally {
      damaged.close();
    }
  });
});

describe("thread-only filters", () => {
  const NON_THREADS = ["doc_fresh", "doc_legal", "doc_mortgage"];

  it.each([
    ["parent", { parent: "doc_mortgage" }],
    ["agent", { agent: "engaged" }],
    ["author", { author: "agent" }],
    ["unread", { unread: "true" }],
  ])("no-ops for non-thread rows: %s", (_label, params) => {
    const result = ids(run({ ...params, limit: "200" }));
    for (const id of NON_THREADS) expect(result).toContain(id);
  });

  it("narrows threads by parent and by agent state", () => {
    expect(ids(run({ type: "thread", parent: "doc_legal" }))).toEqual(["th_never", "th_seen"]);
    expect(ids(run({ type: "thread", agent: "engaged" }))).toEqual(["th_engaged", "th_seen"]);
    expect(ids(run({ type: "thread", agent: "requested" }))).toEqual(["th_form"]);
  });

  it("treats a thread with no seen mark as unread", () => {
    expect(ids(run({ type: "thread", unread: "true" }))).toEqual(["th_engaged", "th_never"]);
    expect(ids(run({ type: "thread", unread: "false" }))).toEqual([
      "th_form",
      "th_seen",
      "th_standalone",
    ]);
  });

  it("narrows threads by the author of the last turn", () => {
    expect(ids(run({ type: "thread", author: "agent" }))).toEqual([
      "th_engaged",
      "th_form",
      "th_seen",
    ]);
  });
});

// `isParent` (CONTRACT-042 / SERVER-073): "is this document a child of
// something?". Its own workspace because the cases that matter are structural
// — a root nothing hangs off, a root that has children, a child, an orphaned
// child — and every one of them has to be present at once for the partition
// claims below to say anything.
//
// One word (`cormorant`) runs through every title and body so `q` can be
// composed with the filter without the FTS half quietly selecting a different
// subset than the structural half.
describe("isParent — what a document is under, never what is under it", () => {
  let roots: Workspace;

  const list = (params: Record<string, string> = {}): DocList =>
    queryDocs(roots.db, DocsQuerySchema.parse({ limit: "200", ...params }), NOW);
  const found = (params: Record<string, string> = {}): string[] => ids(list(params));

  /** Every root in the fixture, of every type — the exact answer to `isParent=true`. */
  const ROOTS = [
    "doc_rootChildless",
    "doc_rootParent",
    "doc_rootView",
    "th_rootQuiet",
    "th_rootReply",
  ];
  /** Every child, of every type — the exact answer to `isParent=false`. */
  const CHILDREN = ["th_childOrphan", "th_childQuiet", "th_childReply"];

  beforeAll(() => {
    roots = createWorkspace("is-parent");

    // The case the rejected "has children" reading would have excluded, and the
    // one this suite exists to pin: a note nothing hangs off is still a root.
    roots.doc({
      id: "doc_rootChildless",
      title: "Cormorant field notes",
      body: "A cormorant nests alone.",
      updated: daysAgo(2),
    });
    roots.doc({
      id: "doc_rootParent",
      title: "Cormorant survey",
      body: "The cormorant survey ran all week.",
      updated: daysAgo(2),
    });
    // A non-note, non-thread root, so `isParent` is visibly not type-scoped.
    roots.doc({
      id: "doc_rootView",
      type: "view",
      title: "Cormorant board",
      body: "One cormorant column.",
      updated: daysAgo(2),
    });
    // Archived, so the default lifecycle rule still gets to run first.
    roots.doc({
      id: "doc_rootArchived",
      status: "archived",
      title: "Cormorant retired",
      body: "A retired cormorant note.",
      updated: daysAgo(2),
    });

    roots.thread({
      id: "th_childReply",
      parent: "doc_rootParent",
      agent: "engaged",
      title: "Re: cormorant counts",
      updated: daysAgo(2),
      turns: [
        { author: "user", ts: daysAgo(3), body: "How many cormorant were counted?" },
        { author: "agent", ts: daysAgo(2), body: "Eleven cormorant, all told." },
      ],
    });
    roots.thread({
      id: "th_childQuiet",
      parent: "doc_rootParent",
      title: "Cormorant nesting",
      updated: daysAgo(2),
      turns: [{ author: "user", ts: daysAgo(2), body: "Where does a cormorant nest?" }],
    });
    // Parented at a document that does not exist: `parentTitle` will read null,
    // but the row is a child all the same (SPEC.md §9.2's orphaned thread).
    roots.thread({
      id: "th_childOrphan",
      parent: "doc_vanished",
      title: "Cormorant orphan",
      updated: daysAgo(2),
      turns: [{ author: "user", ts: daysAgo(2), body: "An orphaned cormorant note." }],
    });

    roots.thread({
      id: "th_rootReply",
      parent: null,
      agent: "engaged",
      title: "Cormorant standalone",
      updated: daysAgo(2),
      turns: [
        { author: "user", ts: daysAgo(3), body: "A standalone cormorant question." },
        { author: "agent", ts: daysAgo(2), body: "A standalone cormorant answer." },
      ],
    });
    roots.thread({
      id: "th_rootQuiet",
      parent: null,
      title: "Cormorant aside",
      updated: daysAgo(2),
      turns: [{ author: "user", ts: daysAgo(2), body: "An aside about a cormorant." }],
    });

    roots.reproject();
  });

  afterAll(() => {
    roots.close();
  });

  it("selects roots of every type with `true`, and children with `false`", () => {
    expect(found({ isParent: "true" })).toEqual(ROOTS);
    expect(found({ isParent: "false" })).toEqual(CHILDREN);
  });

  it("counts a document nothing hangs off as a root", () => {
    // The fixture's claim first: nothing hangs off it. `unreadThreads` is the
    // corpus's own count of this document's threads, so the case is a measured
    // fact rather than a naming convention.
    const childless = list().items.find((item) => item.id === "doc_rootChildless");
    expect(childless?.unreadThreads).toBe(0);
    expect(found({ isParent: "true" })).toContain("doc_rootChildless");
    expect(found({ isParent: "false" })).not.toContain("doc_rootChildless");
    // …and the document that *does* have children is a root by the same rule,
    // which is the half of the semantics the rejected reading would have flipped.
    expect(found({ isParent: "true" })).toContain("doc_rootParent");
  });

  it("changes nothing when absent", () => {
    const unfiltered = found();
    expect(unfiltered).toEqual([...ROOTS, ...CHILDREN].sort());
    // Not merely a superset: the two answers partition the unfiltered set, so
    // the filter can neither drop a row nor invent one.
    expect([...found({ isParent: "true" }), ...found({ isParent: "false" })].sort()).toEqual(
      unfiltered,
    );
    expect(
      found({ isParent: "true" }).filter((id) => found({ isParent: "false" }).includes(id)),
    ).toEqual([]);
  });

  it("the `parent` field selects exactly what `isParent=` returns, in both directions", () => {
    const rows = list().items;
    const byField = (wanted: boolean): string[] =>
      rows
        .filter((item) => (item.parent === null) === wanted)
        .map((item) => item.id)
        .sort();
    expect(byField(true)).toEqual(found({ isParent: "true" }));
    expect(byField(false)).toEqual(found({ isParent: "false" }));
  });

  it("treats an orphaned thread as a child, not as a root", () => {
    // `parent` names a document that is gone, so `parentTitle` is empty — but
    // the thread is still *under* something, which is the question asked.
    const orphan = list().items.find((item) => item.id === "th_childOrphan");
    expect(orphan).toMatchObject({ parent: "doc_vanished", parentTitle: null });
    expect(found({ isParent: "false" })).toContain("th_childOrphan");
    expect(found({ isParent: "true" })).not.toContain("th_childOrphan");
  });

  describe("composition", () => {
    it("intersects with `type`, on both sides", () => {
      expect(found({ isParent: "true", type: "thread" })).toEqual(["th_rootQuiet", "th_rootReply"]);
      expect(found({ isParent: "false", type: "thread" })).toEqual(CHILDREN);
      expect(found({ isParent: "true", type: "note" })).toEqual([
        "doc_rootChildless",
        "doc_rootParent",
      ]);
      // No note is anybody's child, so this is genuinely empty rather than
      // no-opped into the whole set the way a thread-only filter would be.
      expect(found({ isParent: "false", type: "note" })).toEqual([]);
      expect(found({ isParent: "true", type: "view" })).toEqual(["doc_rootView"]);
    });

    it("intersects with `q`, and keeps the snippets", () => {
      // Every fixture row matches `cormorant`, so `q` alone selects the whole
      // corpus and the structural half is doing all the narrowing.
      expect(found({ q: "cormorant" })).toEqual([...ROOTS, ...CHILDREN].sort());
      expect(found({ q: "cormorant", isParent: "true" })).toEqual(ROOTS);
      expect(found({ q: "cormorant", isParent: "false" })).toEqual(CHILDREN);
      // …and a term only children carry stays narrowed by the structural half.
      expect(found({ q: "counted", isParent: "false" })).toEqual(["th_childReply"]);
      expect(found({ q: "counted", isParent: "true" })).toEqual([]);
      for (const row of list({ q: "cormorant", isParent: "true" }).items) {
        expect(row.snippets.length).toBeGreaterThan(0);
      }
    });

    it("intersects with `sort=relevance`, which only `q` makes reachable", () => {
      const ranked = list({ q: "cormorant", isParent: "true", sort: "relevance" });
      expect(ranked.items.map((item) => item.id).sort()).toEqual(ROOTS);
      expect(ranked.page.total).toBe(ROOTS.length);
    });

    it("intersects with `needs=`, which has a row on each side", () => {
      // One unread agent reply under a document and one standing on its own, so
      // the intersection is a narrowing in both directions rather than a
      // coincidence of an Attention set that happened to be all roots.
      expect(found({ needs: "unread-reply" })).toEqual(["th_childReply", "th_rootReply"]);
      expect(found({ needs: "unread-reply", isParent: "true" })).toEqual(["th_rootReply"]);
      expect(found({ needs: "unread-reply", isParent: "false" })).toEqual(["th_childReply"]);
      expect(found({ needs: "me", isParent: "true" })).toEqual(["th_rootReply"]);
    });

    it("runs after the archived default, not instead of it", () => {
      expect(found({ isParent: "true" })).not.toContain("doc_rootArchived");
      expect(found({ isParent: "true", status: "archived" })).toEqual(["doc_rootArchived"]);
      expect(found({ isParent: "true", includeArchived: "true" })).toEqual(
        [...ROOTS, "doc_rootArchived"].sort(),
      );
      expect(found({ isParent: "false", includeArchived: "true" })).toEqual(CHILDREN);
    });

    it("intersects with `folder`, `tag` and `author` without losing either half", () => {
      expect(found({ isParent: "false", author: "agent" })).toEqual(["th_childReply"]);
      expect(found({ isParent: "true", author: "agent" })).toEqual([
        // The thread-only filter still no-ops for non-threads, so the two rules
        // stack rather than one overriding the other.
        "doc_rootChildless",
        "doc_rootParent",
        "doc_rootView",
        "th_rootReply",
      ]);
    });
  });

  describe("paging", () => {
    it("counts the filtered set, not the corpus", () => {
      expect(list({ isParent: "true", limit: "2" }).page).toEqual({
        total: ROOTS.length,
        limit: 2,
        offset: 0,
      });
      expect(list({ isParent: "false", limit: "2" }).page.total).toBe(CHILDREN.length);
      // The defect a windowed answer would hide: a `total` that still reported
      // the whole corpus would say the page was one of many.
      expect(list({ isParent: "true", limit: "2" }).page.total).toBeLessThan(list().page.total);
    });

    it("walks the filtered set and nothing else", () => {
      const walked: string[] = [];
      for (let offset = 0; offset < ROOTS.length; offset += 2) {
        walked.push(
          ...list({ isParent: "true", limit: "2", offset: String(offset) }).items.map(
            (item) => item.id,
          ),
        );
      }
      expect(walked.sort()).toEqual(ROOTS);
      expect(list({ isParent: "true", limit: "2", offset: "4" }).items).toHaveLength(1);
      expect(list({ isParent: "true", limit: "2", offset: "6" }).items).toEqual([]);
    });

    it("counts the filtered set under `q` too", () => {
      const page = list({ q: "cormorant", isParent: "false", limit: "1" });
      expect(page.items).toHaveLength(1);
      expect(page.page.total).toBe(CHILDREN.length);
    });
  });

  // The builder pushes an unguarded `t.parent_id IS NULL` because the
  // contradictory pair cannot reach it: the contract refuses `parent=<id>` with
  // `isParent=true` outright (CONTRACT-042). That reliance is pinned here rather
  // than assumed, because the day the refinement is relaxed this filter starts
  // answering a question nobody asked.
  describe("the contradiction the contract refuses", () => {
    it("never reaches the query builder", () => {
      const refused = DocsQuerySchema.safeParse({ parent: "doc_rootParent", isParent: "true" });
      expect(refused.success).toBe(false);
      expect(refused.error?.issues[0]?.path).toEqual(["isParent"]);
    });

    it("accepts the redundant pairing and answers that parent's children", () => {
      expect(found({ parent: "doc_rootParent", isParent: "false" })).toEqual([
        "th_childQuiet",
        "th_childReply",
      ]);
    });
  });
});

describe("staleness", () => {
  it("filters at or beyond a tier, never an evergreen or recently reviewed row", () => {
    const aging = ids(run({ stale: "aging", limit: "200" }));
    expect(aging).toEqual(
      expect.arrayContaining(["doc_aging", "doc_stale", "doc_verystale", "doc_overduestale"]),
    );
    expect(aging).not.toContain("doc_fresh");
    expect(aging).not.toContain("doc_evergreen");
    expect(aging).not.toContain("doc_reviewed");

    const stale = ids(run({ stale: "stale", limit: "200" }));
    expect(stale).toContain("doc_stale");
    expect(stale).not.toContain("doc_aging");

    const very = ids(run({ stale: "very-stale", limit: "200" }));
    expect(very).toEqual(expect.arrayContaining(["doc_verystale", "doc_overduestale"]));
    expect(very).not.toContain("doc_stale");
  });

  it("puts a row exactly on a threshold into that tier", () => {
    const boundary = createWorkspace("boundary");
    try {
      boundary.doc({ id: "doc_thirty", updated: daysAgo(30) });
      boundary.doc({ id: "doc_ninety", updated: daysAgo(90) });
      boundary.doc({ id: "doc_oneeighty", updated: daysAgo(180) });
      boundary.reproject();
      const at = (tier: string): string[] =>
        queryDocs(boundary.db, DocsQuerySchema.parse({ stale: tier }), NOW)
          .items.map((item) => item.id)
          .sort();
      expect(at("aging")).toEqual(["doc_ninety", "doc_oneeighty", "doc_thirty"]);
      expect(at("stale")).toEqual(["doc_ninety", "doc_oneeighty"]);
      expect(at("very-stale")).toEqual(["doc_oneeighty"]);
    } finally {
      boundary.close();
    }
  });

  it("agrees with the `stale` Attention reason", () => {
    const all = run({ limit: "200" });
    const flagged = all.items
      .filter((item) => item.attention.includes("stale"))
      .map((item) => item.id)
      .sort();
    expect(flagged).toEqual(ids(run({ stale: "stale", limit: "200" })));
  });
});

describe("needs — the Attention union", () => {
  it("returns one row per document with every matching reason", () => {
    const attention = new Map(
      run({ needs: "me", limit: "200" }).items.map((i) => [i.id, i.attention]),
    );
    expect(attention.get("th_engaged")).toEqual(["unread-reply"]);
    expect(attention.get("th_form")).toEqual(["form"]);
    // The reason and the count are one derivation (CONTRACT-040): the row that
    // carries the reason carries the number behind it.
    expect(run({ needs: "me", limit: "200" }).items.find((i) => i.id === "th_form")).toMatchObject({
      unansweredForms: 1,
    });
    expect(attention.get("doc_dueyesterday")).toEqual(["due"]);
    expect(attention.get("doc_stale")).toEqual(["stale"]);
    expect(attention.get("doc_failed")).toEqual(["failed-job"]);
    expect(attention.get("doc_overduestale")).toEqual(["due", "stale"]);
    expect([...attention.keys()].filter((id) => id === "doc_overduestale")).toHaveLength(1);
  });

  it("filters by each reason, and the reasons union to `me`", () => {
    const union = new Set<string>();
    for (const reason of ["unread-reply", "form", "due", "stale", "failed-job"]) {
      const rows = run({ needs: reason, limit: "200" });
      expect(rows.items.length).toBeGreaterThan(0);
      for (const row of rows.items) {
        expect(row.attention).toContain(reason);
        union.add(row.id);
      }
    }
    expect([...union].sort()).toEqual(ids(run({ needs: "me", limit: "200" })));
  });

  it("composes with the other filters by intersection", () => {
    expect(ids(run({ needs: "me", folder: "finance" }))).toEqual([
      "doc_stale",
      "doc_verystale",
      "th_engaged",
      "th_form",
    ]);
    expect(ids(run({ needs: "me", status: "archived" }))).toEqual([]);
  });

  it("drops a row once its reason is handled", () => {
    const handled = createWorkspace("handled");
    try {
      handled.doc({ id: "doc_old", updated: daysAgo(200) });
      handled.thread({
        id: "th_reply",
        parent: "doc_old",
        agent: "engaged",
        turns: [{ author: "agent", ts: daysAgo(2), body: "Done." }],
      });
      handled.reproject();
      const attention = (): string[] =>
        queryDocs(handled.db, DocsQuerySchema.parse({ needs: "me" }), NOW)
          .items.map((item) => item.id)
          .sort();
      expect(attention()).toEqual(["doc_old", "th_reply"]);

      // Marking seen and recording "still current" are the two real remedies.
      handled.seen({ th_reply: daysAgo(1) });
      handled.doc({ id: "doc_old", updated: daysAgo(200), reviewed: daysAgo(1) });
      handled.reproject();
      expect(attention()).toEqual([]);
    } finally {
      handled.close();
    }
  });
});

describe("needs=form — what counts as an unanswered form", () => {
  // SERVER-022 finding 3: the detector was a bare `LIKE '%```form%'` with no
  // thread-status guard, so a turn *mentioning* a fence — or a thread the user
  // had already resolved — sat in Attention with nothing left that could clear
  // it. Every body below is the agent's last turn of an `agent: requested`
  // thread, which is the shape the detector is about.
  let forms: Workspace;

  const FENCE = "```form\nprompt: Pick one\noptions: [a, b]\n```";

  const seedThread = (id: string, body: string, status = "open"): void => {
    forms.thread({
      id,
      parent: "doc_host",
      agent: "requested",
      status,
      updated: daysAgo(3),
      turns: [
        { author: "user", ts: daysAgo(4), body: "Which option?" },
        { author: "agent", ts: daysAgo(3), body },
      ],
    });
  };

  const flagged = (reason: string): string[] =>
    queryDocs(forms.db, DocsQuerySchema.parse({ needs: reason, limit: "200" }), NOW)
      .items.map((item) => item.id)
      .sort();

  beforeAll(() => {
    forms = createWorkspace("forms");
    forms.doc({ id: "doc_host", updated: daysAgo(3) });
    seedThread("th_realform", `Here you go.\n\n${FENCE}\n`);
    seedThread("th_formatstart", `${FENCE}\n`);
    seedThread("th_crlf", `Here you go.\r\n\r\n${FENCE.replaceAll("\n", "\r\n")}\r\n`);
    // The near misses, each of which the substring read called a form.
    seedThread("th_formula", "Use a ```formula\nx = y\n``` block instead.");
    seedThread("th_quoted", "The skill writes:\n\n> ```form\n> prompt: Pick one\n> ```\n");
    seedThread("th_indented", "For example:\n\n    ```form\n    prompt: Pick one\n    ```\n");
    seedThread("th_inline", "Answer the ```form``` I sent earlier.");
    // A real form in a thread the user has already resolved.
    seedThread("th_resolved", `Here you go.\n\n${FENCE}\n`, "resolved");
    // SERVER-029 (PR #10 finding 8): the shapes the substring read and the
    // answer route disagreed about. Each is now decided by the same reader the
    // route uses, stored in `turns.has_form`.
    seedThread("th_trailingblank", "Here you go.\n\n```form  \nprompt: Pick one\noptions: [a, b]\n```\n"); // prettier-ignore
    seedThread("th_unterminated", "Here you go.\n\n```form\nprompt: Pick one\noptions: [a, b]\n");
    seedThread("th_badyaml", "Here you go.\n\n```form\nprompt: [unclosed\n```\n");
    seedThread("th_notaform", "Here you go.\n\n```form\ntitle: not a form\n```\n");
    // Every thread is marked read, so `form` is the only reason any of these
    // rows can carry and `needs=me` is exactly the form set.
    forms.seen(
      Object.fromEntries(
        [
          "th_realform",
          "th_formatstart",
          "th_crlf",
          "th_formula",
          "th_quoted",
          "th_indented",
          "th_inline",
          "th_resolved",
          "th_trailingblank",
          "th_unterminated",
          "th_badyaml",
          "th_notaform",
        ].map((id) => [id, daysAgo(2)]),
      ),
    );
    forms.reproject();
  });

  afterAll(() => {
    forms.close();
  });

  it("flags a fence that opens a block, wherever the block starts and however the file ends its lines", () => {
    expect(flagged("form")).toEqual([
      "th_crlf",
      "th_formatstart",
      "th_realform",
      // The info string is the rest of its line, and trailing blanks are part of
      // no info string — so this *is* a form fence, and was answerable all along
      // while `needs=form` never mentioned it (SERVER-029).
      "th_trailingblank",
    ]);
  });

  it("does not flag a turn that merely mentions a fence", () => {
    for (const id of ["th_formula", "th_quoted", "th_indented", "th_inline"]) {
      expect(flagged("form")).not.toContain(id);
      expect(flagged("me")).not.toContain(id);
    }
  });

  it("does not flag a fence nobody could answer (SERVER-029)", () => {
    // Each of these sat in Attention with `POST …/form` 404ing it: an opening
    // line is not a form, and the reason has to be one the user can clear.
    for (const id of ["th_unterminated", "th_badyaml", "th_notaform"]) {
      expect(flagged("form")).not.toContain(id);
      expect(flagged("me")).not.toContain(id);
    }
  });

  it("lets a resolved thread out of Attention — handling the reason clears the row", () => {
    expect(flagged("form")).not.toContain("th_resolved");
    expect(flagged("me")).not.toContain("th_resolved");
  });
});

// SERVER-032, the Phase 4 evaluator's F-1 reproduced as a test: a thread with
// two unanswered forms left `needs=form` as soon as *either* was answered,
// because the detector asked "is the last turn an agent turn carrying a form?"
// and the answer turn moved `last_author` to `user`. SPEC.md §6 is form-scoped
// — a form "is identified by the timestamp of the turn carrying it… and
// answering a form addresses the turn that carries it" — so the reason holds
// while any agent form is unanswered, and clears when the last one is answered.
describe("needs=form — a thread may carry several independently answerable forms", () => {
  let multi: Workspace;

  const formFence = (label: string): string =>
    `Question ${label}\n\n\`\`\`form\nprompt: Pick ${label}\noptions:\n  - "${label}-yes"\n  - "${label}-no"\n\`\`\`\n`;

  /** Turn timestamps are a turn's identity (§6): one per index, in order. */
  const at = (index: number): string => daysAgo(20 - index);

  type Step = { readonly author: "user" | "agent"; readonly body: string };

  const seed = (id: string, steps: readonly Step[]): void => {
    multi.thread({
      id,
      parent: "doc_host",
      agent: "requested",
      status: "open",
      updated: at(steps.length - 1),
      turns: steps.map((step, index) => ({ author: step.author, ts: at(index), body: step.body })),
    });
    // Read, so `form` is the only reason these rows can carry.
    multi.seen({ [id]: at(steps.length - 1) });
    multi.reproject();
  };

  const asks = (id: string): boolean =>
    queryDocs(multi.db, DocsQuerySchema.parse({ needs: "form", limit: "200" }), NOW).items.some(
      (item) => item.id === id,
    );

  const ASK = { author: "user", body: "Which option?" } as const;
  const F1 = { author: "agent", body: formFence("F1") } as const;
  const F2 = { author: "agent", body: formFence("F2") } as const;
  const F3 = { author: "agent", body: formFence("F3") } as const;
  const answering = (option: string): Step => ({
    author: "user",
    body: `${FORM_ANSWER_LABEL} ${option}`,
  });

  beforeAll(() => {
    multi = createWorkspace("multiform");
    multi.doc({ id: "doc_host", updated: daysAgo(3) });
  });

  afterAll(() => {
    multi.close();
  });

  it("keeps the reason while a second form is still unanswered", () => {
    seed("th_two", [ASK, F1, F2]);
    expect(asks("th_two")).toBe(true);
    seed("th_two", [ASK, F1, F2, answering("F1-yes")]);
    expect(asks("th_two")).toBe(true);
  });

  it("clears the reason once the last form is answered", () => {
    seed("th_both", [ASK, F1, F2, answering("F1-yes"), answering("F2-no")]);
    expect(asks("th_both")).toBe(false);
  });

  it("does not care which form is answered first", () => {
    seed("th_reverse", [ASK, F1, F2, answering("F2-no")]);
    expect(asks("th_reverse")).toBe(true);
    seed("th_reverse", [ASK, F1, F2, answering("F2-no"), answering("F1-yes")]);
    expect(asks("th_reverse")).toBe(false);
  });

  it("holds until every one of three forms is answered", () => {
    const base = [ASK, F1, F2, F3] as const;
    seed("th_three", base);
    expect(asks("th_three")).toBe(true);
    seed("th_three", [...base, answering("F2-no")]);
    expect(asks("th_three")).toBe(true);
    seed("th_three", [...base, answering("F2-no"), answering("F3-yes")]);
    expect(asks("th_three")).toBe(true);
    seed("th_three", [...base, answering("F2-no"), answering("F3-yes"), answering("F1-yes")]);
    expect(asks("th_three")).toBe(false);
  });

  // §6 defines no once-only rule, so answering the same form twice is an
  // ordinary pair of turns — and the second answer must not be allowed to close
  // a form nobody answered. A detector that counted answers against forms would
  // pass every test above and fail this one.
  it("does not let a repeated answer close a different form", () => {
    seed("th_repeat", [ASK, F1, F2, answering("F1-yes"), answering("F1-yes")]);
    expect(asks("th_repeat")).toBe(true);
  });

  it("still clears a single-form thread when its one form is answered", () => {
    seed("th_one", [ASK, F1]);
    expect(asks("th_one")).toBe(true);
    seed("th_one", [ASK, F1, answering("F1-no")]);
    expect(asks("th_one")).toBe(false);
  });

  it("still says nothing about a resolved thread, however many forms it holds", () => {
    multi.thread({
      id: "th_multiresolved",
      parent: "doc_host",
      agent: "requested",
      status: "resolved",
      updated: at(2),
      turns: [ASK, F1, F2].map((step, index) => ({
        author: step.author,
        ts: at(index),
        body: step.body,
      })),
    });
    multi.seen({ th_multiresolved: at(2) });
    multi.reproject();
    expect(asks("th_multiresolved")).toBe(false);
  });

  // A user turn that quotes a form fence is not an agent's question: §6 makes a
  // form something an agent turn carries, and the answer route refuses one on a
  // user turn, so the reason must not appear for it either.
  it("ignores a form fence a user turn quotes", () => {
    seed("th_userfence", [ASK, { author: "user", body: formFence("F9") }]);
    expect(asks("th_userfence")).toBe(false);
  });

  // Wave-3 audit TEST 19. The two halves — "is this a form" (SERVER-029) and
  // "has it been answered" (SERVER-032) — were each tested alone. Together is
  // where a detector that counted fences, or counted answers, goes wrong: a
  // fence nobody can answer must never keep the reason lit, and must never
  // absorb an answer meant for a form somebody can.
  describe("a fence nobody can answer, beside forms somebody can", () => {
    const UNTERMINATED = {
      author: "agent",
      body: "Here you go.\n\n```form\nprompt: Pick\n",
    } as const;
    const BAD_YAML = { author: "agent", body: "Here you go.\n\n```form\nprompt: [unclosed\n```\n" } as const; // prettier-ignore
    const NOT_A_FORM = { author: "agent", body: "Here you go.\n\n```form\ntitle: nope\n```\n" } as const; // prettier-ignore

    it("does not keep the reason lit after the answerable form is answered", () => {
      seed("th_mixed", [ASK, F1, UNTERMINATED, BAD_YAML, NOT_A_FORM]);
      expect(asks("th_mixed")).toBe(true);
      seed("th_mixed", [ASK, F1, UNTERMINATED, BAD_YAML, NOT_A_FORM, answering("F1-yes")]);
      expect(asks("th_mixed")).toBe(false);
    });

    it("does not let an answer be attributed to it", () => {
      // `prompt: Pick` offers no options at all, so nothing here is answerable;
      // the answer turn is ordinary prose that happens to start with the label.
      seed("th_badanswer", [ASK, BAD_YAML, answering("F1-yes")]);
      expect(asks("th_badanswer")).toBe(false);
      // And with a real form beside it, the answer goes to the real one — not
      // swallowed by the malformed neighbour that sits earlier in the thread.
      seed("th_badbeside", [ASK, BAD_YAML, F1, answering("F1-yes")]);
      expect(asks("th_badbeside")).toBe(false);
    });

    it("keeps the reason for the form that is left when another is answered", () => {
      seed("th_mixedtwo", [ASK, F1, NOT_A_FORM, F2, answering("F1-yes")]);
      expect(asks("th_mixedtwo")).toBe(true);
      seed("th_mixedtwo", [ASK, F1, NOT_A_FORM, F2, answering("F1-yes"), answering("F2-no")]);
      expect(asks("th_mixedtwo")).toBe(false);
    });

    // Wave-3 audit FIX 10, end to end through the SQL: a hand-edited turn that
    // both answers a form and carries one is answerable at the route, so it has
    // to be advertised here — and answering it has to clear the reason.
    it("advertises a turn that both answers a form and carries one, until it too is answered", () => {
      const both = {
        author: "agent",
        body: `${FORM_ANSWER_LABEL} F1-yes\n\n${formFence("F2")}`,
      } as const;
      seed("th_answerform", [ASK, F1, both]);
      expect(asks("th_answerform")).toBe(true);
      seed("th_answerform", [ASK, F1, both, answering("F2-no")]);
      expect(asks("th_answerform")).toBe(false);
    });
  });
});

describe("row fields", () => {
  const ANCHOR_QUOTE = "taxes and insurance";
  const LONG_TURN = `${"escrow ".repeat(80)}end.`;
  let fields: Workspace;

  /** The single row for `id`, over a query that returns the whole corpus. */
  const row = (id: string): DocRow => {
    const found = queryDocs(fields.db, DocsQuerySchema.parse({ limit: "200" }), NOW).items.find(
      (item) => item.id === id,
    );
    expect(found, `no row for ${id}`).toBeDefined();
    return found as DocRow;
  };

  beforeAll(() => {
    fields = createWorkspace("fields");
    fields.doc({
      id: "doc_parent",
      path: "data/docs/notes/parent.md",
      body: `Payments, ${ANCHOR_QUOTE} are escrowed.`,
      updated: daysAgo(2),
      anchors: {
        anc_taxes: { exact: ANCHOR_QUOTE, prefix: "Payments, ", suffix: " are escrowed." },
      },
    });
    fields.doc({ id: "doc_fresh", updated: daysAgo(1) });
    fields.doc({ id: "doc_aging", updated: daysAgo(45) });
    fields.doc({ id: "doc_stale", updated: daysAgo(100) });
    fields.doc({ id: "doc_verystale", updated: daysAgo(200) });
    fields.doc({ id: "doc_evergreen", updated: daysAgo(400), evergreen: true });
    // A hand-written file with no timestamps at all (SPEC.md §7) — written raw
    // because the fixture's frontmatter helper always stamps both.
    fields.write(
      "data/docs/notes/undated.md",
      [
        "---",
        "id: doc_undated",
        "type: note",
        'title: "Undated"',
        "tags: []",
        "status: open",
        "anchors: {}",
        "due: null",
        "reviewed: null",
        "evergreen: false",
        "---",
        "",
        "No timestamps at all.",
        "",
      ].join("\n"),
    );

    fields.thread({
      id: "th_anchored",
      title: "Re: escrow",
      parent: "doc_parent",
      anchor: "anc_taxes",
      agent: "engaged",
      turns: [
        { author: "user", ts: daysAgo(4), body: "Why escrow?" },
        { author: "agent", ts: daysAgo(3), body: "Because of taxes." },
      ],
    });
    fields.thread({
      id: "th_whole",
      title: "Whole document",
      parent: "doc_parent",
      anchor: null,
      agent: "requested",
      turns: [{ author: "user", ts: daysAgo(1), body: "Any thoughts on this note?" }],
    });
    fields.thread({
      id: "th_detached",
      title: "Anchor gone",
      parent: "doc_parent",
      anchor: "anc_gone",
      agent: "none",
      turns: [{ author: "user", ts: daysAgo(1), body: "Detached." }],
    });
    fields.thread({
      id: "th_resolved",
      title: "Settled",
      parent: "doc_parent",
      agent: "engaged",
      status: "resolved",
      turns: [{ author: "user", ts: daysAgo(1), body: "Thanks!" }],
    });
    fields.thread({
      id: "th_empty",
      title: "Nothing said yet",
      parent: "doc_parent",
      agent: "none",
      turns: [],
    });
    fields.thread({
      id: "th_standalone",
      title: "Standalone",
      parent: null,
      agent: "none",
      turns: [{ author: "user", ts: daysAgo(1), body: "No parent." }],
    });
    fields.thread({
      id: "th_long",
      title: "Long",
      parent: "doc_parent",
      agent: "none",
      turns: [{ author: "user", ts: daysAgo(1), body: LONG_TURN }],
    });

    fields.seen({ th_anchored: daysAgo(2) });
    fields.reproject();
  });

  afterAll(() => {
    fields.close();
  });

  it("carries every declared key on every row, thread or not", () => {
    const all = queryDocs(fields.db, DocsQuerySchema.parse({ limit: "200" }), NOW);
    expect(DocListSchema.parse(all)).toEqual(all);
    expect(all.items.length).toBeGreaterThan(0);
    // The page's anchor and last-turn joins are keyed on full primary keys, so
    // they cannot multiply a row past the COUNT — which does not make them.
    expect(all.page.total).toBe(all.items.length);
  });

  it("reports null for every thread field on a document row", () => {
    expect(row("doc_parent")).toMatchObject({
      parent: null,
      agent: null,
      anchorQuote: null,
      turnCount: null,
      lastAuthor: null,
      lastTurn: null,
      unread: null,
      awaitingAgent: null,
    });
  });

  it("fills a thread row from its own projected columns", () => {
    expect(row("th_anchored")).toMatchObject({
      parent: "doc_parent",
      agent: "engaged",
      anchorQuote: ANCHOR_QUOTE,
      turnCount: 2,
      lastAuthor: "agent",
      lastTurn: "Because of taxes.",
      unread: false,
      awaitingAgent: false,
    });
  });

  it("leaves `anchorQuote` null for a whole-document, standalone or detached thread", () => {
    expect(row("th_whole").anchorQuote).toBeNull();
    expect(row("th_standalone")).toMatchObject({ parent: null, anchorQuote: null });
    // The thread names an anchor its parent's frontmatter no longer carries.
    expect(row("th_detached")).toMatchObject({ parent: "doc_parent", anchorQuote: null });
  });

  it("reports a thread with no turns as counted-but-silent", () => {
    expect(row("th_empty")).toMatchObject({
      agent: "none",
      turnCount: 0,
      lastAuthor: null,
      lastTurn: null,
      unread: false,
      awaitingAgent: false,
    });
  });

  it("excerpts a long last turn by the same rule as the body excerpt", () => {
    const preview = row("th_long").lastTurn;
    expect(preview).toHaveLength(EXCERPT_LENGTH);
    expect(LONG_TURN.startsWith(preview ?? "")).toBe(true);
  });

  it("marks a thread unread until its last turn is seen", () => {
    // `th_anchored` has a seen mark newer than its last turn; `th_whole` has none.
    expect(row("th_anchored").unread).toBe(false);
    expect(row("th_whole").unread).toBe(true);
  });

  it("awaits the agent only in an open thread it was drawn into, on a user turn", () => {
    expect(row("th_whole").awaitingAgent).toBe(true);
    // Same shape, but resolved — a settled thread stops waiting (SPEC.md §8).
    expect(row("th_resolved")).toMatchObject({
      agent: "engaged",
      lastAuthor: "user",
      awaitingAgent: false,
    });
    // The agent was never drawn in.
    expect(row("th_detached")).toMatchObject({ agent: "none", awaitingAgent: false });
    // The last turn already is the agent's reply.
    expect(row("th_anchored").awaitingAgent).toBe(false);
  });

  it("renders an undated document as null rather than an epoch", () => {
    expect(row("doc_undated")).toMatchObject({ created: null, updated: null, stale: null });
  });

  it("names the tier a document has reached, and null for fresh or evergreen", () => {
    expect(row("doc_fresh").stale).toBeNull();
    expect(row("doc_aging").stale).toBe("aging");
    expect(row("doc_stale").stale).toBe("stale");
    expect(row("doc_verystale").stale).toBe("very-stale");
    // 400 days old, but opted out entirely.
    expect(row("doc_evergreen").stale).toBeNull();
  });

  it("keeps `awaitingAgent` in step with the `agent` and `author` filters", () => {
    for (const item of queryDocs(fields.db, DocsQuerySchema.parse({ limit: "200" }), NOW).items) {
      if (item.agent === null) continue;
      expect(item.awaitingAgent).toBe(
        item.agent !== "none" && item.lastAuthor === "user" && item.status === "open",
      );
    }
  });
});

describe("field/filter agreement", () => {
  const all = (): DocRow[] => run({ limit: "200" }).items;
  const atOrBeyond = (tier: StaleTier | null, floor: StaleTier): boolean =>
    tier !== null && STALE_TIERS.indexOf(tier) >= STALE_TIERS.indexOf(floor);

  it.each(STALE_TIERS)("the `stale` field selects exactly what `stale=%s` returns", (tier) => {
    const carrying = all()
      .filter((item) => atOrBeyond(item.stale, tier))
      .map((item) => item.id)
      .sort();
    expect(carrying).toEqual(ids(run({ stale: tier, limit: "200" })));
    expect(carrying.length).toBeGreaterThan(0);
  });

  it("gives the `stale` Attention reason to exactly the rows at or beyond that tier", () => {
    for (const item of all()) {
      expect(item.attention.includes("stale")).toBe(atOrBeyond(item.stale, "stale"));
    }
  });

  it.each([
    ["agent", "engaged"],
    ["agent", "requested"],
    ["agent", "none"],
  ])("the `%s` field selects exactly what `%s=%s` returns", (_field, value) => {
    const carrying = all()
      .filter((item) => item.agent === value)
      .map((item) => item.id)
      .sort();
    expect(carrying).toEqual(ids(run({ type: "thread", agent: value, limit: "200" })));
  });

  it("the `unread` field selects exactly what `unread=` returns, in both directions", () => {
    for (const wanted of [true, false]) {
      const carrying = all()
        .filter((item) => item.unread === wanted)
        .map((item) => item.id)
        .sort();
      expect(carrying).toEqual(ids(run({ type: "thread", unread: String(wanted), limit: "200" })));
      expect(carrying.length).toBeGreaterThan(0);
    }
  });

  it("the `lastAuthor` and `parent` fields select exactly what `author=`/`parent=` return", () => {
    const byAuthor = all()
      .filter((item) => item.lastAuthor === "agent")
      .map((item) => item.id)
      .sort();
    expect(byAuthor).toEqual(ids(run({ type: "thread", author: "agent", limit: "200" })));

    const byParent = all()
      .filter((item) => item.parent === "doc_legal")
      .map((item) => item.id)
      .sort();
    expect(byParent).toEqual(ids(run({ type: "thread", parent: "doc_legal", limit: "200" })));
    expect(byParent.length).toBeGreaterThan(0);
  });

  it("leaves every thread field null on rows that are not threads", () => {
    const threads = new Set(ids(run({ type: "thread", limit: "200" })));
    for (const item of all()) {
      if (threads.has(item.id)) continue;
      expect(item).toMatchObject({
        parent: null,
        agent: null,
        anchorQuote: null,
        turnCount: null,
        lastAuthor: null,
        lastTurn: null,
        unread: null,
        awaitingAgent: null,
      });
    }
  });
});

// The aggregate a document row carries so a list never issues one
// `?parent=<id>&type=thread&unread=true` per row (CONTRACT-012). Its own
// workspace because the interesting cases are read-state combinations, and the
// property below is only meaningful over a corpus that has all of them.
describe("unreadThreads", () => {
  let hub: Workspace;

  const rows = (params: Record<string, string> = {}): DocRow[] =>
    queryDocs(hub.db, DocsQuerySchema.parse({ limit: "200", ...params }), NOW).items;

  const aggregate = (id: string): number => {
    const found = rows().find((item) => item.id === id);
    expect(found, `no row for ${id}`).toBeDefined();
    return (found as DocRow).unreadThreads;
  };

  /** What a client would otherwise have had to ask per row — the N+1 this field replaces. */
  const perRowQuery = (id: string): number =>
    rows({ parent: id, type: "thread", unread: "true" }).length;

  beforeAll(() => {
    hub = createWorkspace("unread-threads");
    hub.doc({ id: "doc_hub", title: "Four live threads and an archived one" });
    hub.doc({ id: "doc_quiet", title: "No threads at all" });
    hub.doc({ id: "doc_settled", title: "One thread, read" });
    hub.doc({ id: "doc_archivedonly", title: "Its only unread thread is archived" });
    hub.doc({ id: "doc_archiving", title: "Archived mid-test" });

    // Two plainly unread…
    hub.thread({
      id: "th_unreadnew",
      parent: "doc_hub",
      turns: [{ author: "user", ts: daysAgo(3), body: "Never opened." }],
    });
    hub.thread({
      id: "th_unreadreply",
      parent: "doc_hub",
      agent: "engaged",
      turns: [
        { author: "user", ts: daysAgo(5), body: "Question." },
        { author: "agent", ts: daysAgo(2), body: "Answer." },
      ],
    });
    // …one read right up to its last turn…
    hub.thread({
      id: "th_read",
      parent: "doc_hub",
      agent: "engaged",
      turns: [
        { author: "user", ts: daysAgo(6), body: "Ping." },
        { author: "agent", ts: daysAgo(4), body: "Pong." },
      ],
    });
    // …and one marked seen at an instant BEFORE its last turn: a partial read,
    // which the contract counts as unread in both places (SPEC.md §7).
    hub.thread({
      id: "th_partial",
      parent: "doc_hub",
      agent: "engaged",
      turns: [
        { author: "user", ts: daysAgo(8), body: "First." },
        { author: "agent", ts: daysAgo(7), body: "Second, unseen." },
      ],
    });

    // …and one that is unread but ARCHIVED, which §11 drops from the default
    // set. `?parent=doc_hub&type=thread&unread=true` does not return it, so the
    // aggregate must not count it either (PR #10 review, finding 4).
    hub.thread({
      id: "th_archived",
      parent: "doc_hub",
      status: "archived",
      turns: [{ author: "user", ts: daysAgo(2), body: "Dealt with, then archived." }],
    });

    hub.thread({
      id: "th_ondoc",
      parent: "doc_settled",
      turns: [{ author: "user", ts: daysAgo(9), body: "Read." }],
    });
    // A document whose *only* unread thread is archived: its pill is 0, not 1.
    hub.thread({
      id: "th_onlyarchived",
      parent: "doc_archivedonly",
      status: "archived",
      turns: [{ author: "user", ts: daysAgo(3), body: "Archived, never opened." }],
    });
    // Live at seeding; archived later, to watch the pill drop.
    hub.thread({
      id: "th_archiving",
      parent: "doc_archiving",
      turns: [{ author: "user", ts: daysAgo(3), body: "Still open for now." }],
    });
    // A thread hanging off a *thread*: the row it hangs on still reports 0.
    hub.thread({
      id: "th_onthread",
      parent: "th_unreadnew",
      turns: [{ author: "user", ts: daysAgo(1), body: "About that thread." }],
    });
    // A thread with no parent aggregates onto nothing.
    hub.thread({
      id: "th_loose",
      parent: null,
      turns: [{ author: "user", ts: daysAgo(1), body: "Standalone." }],
    });

    hub.seen({ th_read: daysAgo(4), th_partial: daysAgo(8), th_ondoc: daysAgo(9) });
    hub.reproject();
  });

  afterAll(() => {
    hub.close();
  });

  it("counts the document's unread threads, with a partial read counting as unread", () => {
    // Four live threads: two unread, one read to its last turn, one marked seen
    // at a `lastSeenTs` before its last turn. The fifth is archived.
    expect(aggregate("doc_hub")).toBe(3);
  });

  it("reports 0 for a childless document and for one whose threads are all read", () => {
    expect(aggregate("doc_quiet")).toBe(0);
    expect(aggregate("doc_settled")).toBe(0);
  });

  it("does not count archived threads, which the default set excludes (§11)", () => {
    // The fixture's archived thread IS unread — it is excluded for its
    // lifecycle, not for its read state.
    const archived = rows({ status: "archived", type: "thread", unread: "true" }).map((i) => i.id);
    expect(archived).toContain("th_archived");
    expect(archived).toContain("th_onlyarchived");

    // doc_hub has five child threads and counts the four live ones' unread; the
    // document whose only unread thread is archived shows no pill at all.
    expect(aggregate("doc_hub")).toBe(3);
    expect(aggregate("doc_archivedonly")).toBe(0);
    expect(perRowQuery("doc_archivedonly")).toBe(0);
  });

  it("reports 0 on every thread row, including one that has a thread of its own", () => {
    for (const item of rows({ type: "thread" })) expect(item.unreadThreads).toBe(0);
    // `th_unreadnew` is the parent of an unread thread and is itself unread —
    // and still reports 0, because a thread does not aggregate here.
    const parentThread = rows({ type: "thread" }).find((item) => item.id === "th_unreadnew");
    expect(parentThread).toMatchObject({ unread: true, unreadThreads: 0 });
  });

  it("is never null or absent — `0` means nothing unread, never unknown", () => {
    for (const item of rows()) {
      expect(Number.isInteger(item.unreadThreads)).toBe(true);
      expect(item.unreadThreads).toBeGreaterThanOrEqual(0);
    }
  });

  it("equals the per-row query it replaces, for every document in the corpus", () => {
    const documents = rows().filter((item) => item.type !== "thread");
    expect(documents.length).toBeGreaterThan(0);
    for (const item of documents) {
      expect(item.unreadThreads, `unreadThreads for ${item.id}`).toBe(perRowQuery(item.id));
    }
    // Not vacuously true: at least one document has a non-zero count, and the
    // corpus contains an *archived* unread thread — the case that made the two
    // sides disagree, and the one this property is worth asserting over.
    expect(documents.some((item) => item.unreadThreads > 0)).toBe(true);
    expect(rows({ status: "archived", type: "thread", unread: "true" }).length).toBeGreaterThan(0);
  });

  it("moves in both directions as read state changes", () => {
    expect(aggregate("doc_hub")).toBe(3);

    // Reading the partial thread through to its last turn.
    hub.seen({ th_read: daysAgo(4), th_partial: daysAgo(7), th_ondoc: daysAgo(9) });
    hub.reproject();
    expect(aggregate("doc_hub")).toBe(2);
    expect(perRowQuery("doc_hub")).toBe(2);

    // A new turn on an already-read thread makes it unread again.
    hub.thread({
      id: "th_read",
      parent: "doc_hub",
      agent: "engaged",
      turns: [
        { author: "user", ts: daysAgo(6), body: "Ping." },
        { author: "agent", ts: daysAgo(4), body: "Pong." },
        { author: "agent", ts: daysAgo(1), body: "One more thing." },
      ],
    });
    hub.reproject();
    expect(aggregate("doc_hub")).toBe(3);
    expect(perRowQuery("doc_hub")).toBe(3);
  });

  it("drops the pill when the unread thread behind it is archived", () => {
    expect(aggregate("doc_archiving")).toBe(1);
    expect(perRowQuery("doc_archiving")).toBe(1);

    // Same file, same turns, same unread state — only its lifecycle changed.
    hub.thread({
      id: "th_archiving",
      parent: "doc_archiving",
      status: "archived",
      turns: [{ author: "user", ts: daysAgo(3), body: "Still open for now." }],
    });
    hub.reproject();

    expect(aggregate("doc_archiving")).toBe(0);
    expect(perRowQuery("doc_archiving")).toBe(0);
  });

  it("seeks the parent index rather than scanning threads per row", () => {
    // The `threads_parent_id` index is what keeps the correlated subquery
    // bounded; without it every row of every page would scan the table. The
    // shipped fragment is spliced verbatim, so this measures the real SQL —
    // including the `documents` join the archived exclusion added.
    const plan = hub.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT ${UNREAD_THREADS_SQL}
           FROM documents d LEFT JOIN threads t ON t.id = d.id`,
      )
      .all() as { detail: string }[];
    const details = plan.map((step) => step.detail).join("\n");
    expect(details).toContain("threads_parent_id");
    expect(details).not.toMatch(/SCAN t\b/);
  });
});

// The count behind §11's last Attention clause — "a thread holding more than
// one unanswered form says how many are still open" (CONTRACT-040, SERVER-084).
// Its own workspace because the interesting cases are *how many* forms are open
// at once, and the shared corpus deliberately has exactly one such thread.
//
// The published invariant is an `iff` with a stated direction — `unansweredForms
// > 0` **iff** `attention` contains `form` — so it is asserted here as two
// implications with witnesses for each, never as one direction plus a hope.
describe("unansweredForms", () => {
  let open: Workspace;

  /** An agent turn carrying one answerable form (SPEC.md §6). */
  const formFence = (label: string): string =>
    `Question ${label}\n\n\`\`\`form\nprompt: Pick ${label}\noptions:\n  - "${label}-yes"\n  - "${label}-no"\n\`\`\`\n`;

  const answering = (option: string): TurnStep => ({
    author: "user",
    body: `${FORM_ANSWER_LABEL} ${option}`,
  });

  interface TurnStep {
    readonly author: "user" | "agent";
    readonly body: string;
  }

  const ASK: TurnStep = { author: "user", body: "Which option?" };
  const form = (label: string): TurnStep => ({ author: "agent", body: formFence(label) });

  /** Turn timestamps are a turn's identity (§6): one per index, in order. */
  const at = (index: number): string => daysAgo(30 - index);

  /**
   * The fixture rewrites `seen.json` wholesale, so the marks accumulate here
   * rather than each seed silently un-reading every thread before it.
   */
  const marks = new Map<string, string>();

  const seed = (
    id: string,
    steps: readonly TurnStep[],
    { status = "open", read = true }: { status?: string; read?: boolean } = {},
  ): void => {
    open.thread({
      id,
      parent: "doc_host",
      agent: "requested",
      status,
      updated: at(steps.length - 1),
      turns: steps.map((step, index) => ({ author: step.author, ts: at(index), body: step.body })),
    });
    // Read through to the last turn by default, so `form` is the only Attention
    // reason these rows can carry and `unread` cannot stand in for it.
    if (read) marks.set(id, at(steps.length - 1));
    else marks.delete(id);
    open.seen(Object.fromEntries(marks));
  };

  const rows = (params: Record<string, string> = {}): DocRow[] =>
    queryDocs(open.db, DocsQuerySchema.parse({ limit: "200", ...params }), NOW).items;

  const row = (id: string, params: Record<string, string> = {}): DocRow => {
    const found = rows(params).find((item) => item.id === id);
    expect(found, `no row for ${id}`).toBeDefined();
    return found as DocRow;
  };

  const counted = (id: string, params: Record<string, string> = {}): number =>
    row(id, params).unansweredForms;

  beforeAll(() => {
    open = createWorkspace("unanswered-forms");
    open.doc({ id: "doc_host", title: "The commented document" });
    open.doc({ id: "doc_quiet", title: "No threads at all" });

    // 0, 1, 2 and 3 open questions — the numbers §11's clause reads.
    seed("th_zero", [ASK, { author: "agent", body: "Ordinary prose, no question." }]);
    seed("th_one", [ASK, form("F1")]);
    seed("th_two", [ASK, form("F1"), form("F2")]);
    seed("th_three", [ASK, form("F1"), form("F2"), form("F3")]);
    // Three asked, one answered: the count is what is *left*.
    seed("th_partly", [ASK, form("F1"), form("F2"), form("F3"), answering("F2-no")]);
    // Asked and answered: back to zero without the thread being settled.
    seed("th_answered", [ASK, form("F1"), answering("F1-yes")]);
    // A settled conversation is not waiting for an answer (SPEC.md §6, §11).
    seed("th_resolved", [ASK, form("F1"), form("F2")], { status: "resolved" });
    // Same two forms, archived rather than resolved.
    seed("th_archived", [ASK, form("F1"), form("F2")], { status: "archived" });
    // A form fence a *user* turn quotes is not the agent's question, and a fence
    // nobody can answer is not a form at all — neither is countable.
    seed("th_userfence", [ASK, { author: "user", body: formFence("F9") }]);
    seed("th_unanswerable", [
      ASK,
      { author: "agent", body: "Here you go.\n\n```form\nprompt: Pick\n" },
    ]);
    // A thread hanging off a thread, so "the parent is a thread" is covered too.
    open.thread({
      id: "th_child",
      parent: "th_two",
      agent: "none",
      updated: at(1),
      turns: [{ author: "user", ts: at(1), body: "About that thread." }],
    });
    open.reproject();
  });

  afterAll(() => {
    open.close();
  });

  it("counts the forms still open, one row per number", () => {
    expect(counted("th_zero")).toBe(0);
    expect(counted("th_one")).toBe(1);
    expect(counted("th_two")).toBe(2);
    expect(counted("th_three")).toBe(3);
  });

  it("counts what is left, not what was asked", () => {
    // Three forms, one answered — §6 identifies a form by the turn carrying it,
    // so answering one addresses one.
    expect(counted("th_partly")).toBe(2);
    expect(counted("th_answered")).toBe(0);
  });

  it("counts only an agent turn carrying a form somebody can answer", () => {
    expect(counted("th_userfence")).toBe(0);
    expect(counted("th_unanswerable")).toBe(0);
  });

  it("reports 0 and no `form` reason on a document row — one guard settles both", () => {
    // `t.id IS NOT NULL` is the same term for the count and for the reason, so a
    // document row cannot report one without the other. `doc_host` is the parent
    // of six threads holding open forms between them and still counts none.
    for (const id of ["doc_host", "doc_quiet"]) {
      expect(row(id).unansweredForms).toBe(0);
      expect(row(id).attention).not.toContain("form");
      expect(row(id).turnCount).toBeNull();
    }
    // Not vacuous: `doc_host` is the parent of threads that do count.
    expect(rows().filter((item) => item.unansweredForms > 0).length).toBeGreaterThan(0);
  });

  it("treats an archived thread exactly as it treats a resolved one", () => {
    // `threads.status` is the document's own `status` column, so `t.status =
    // 'open'` — the one term both the count and the reason hang off — excludes
    // archived as it excludes resolved. The row is still *visible* under an
    // explicit `status=archived`; what it reports there is 0 and no reason.
    expect(row("th_resolved", { status: "resolved" })).toMatchObject({
      unansweredForms: 0,
      attention: [],
    });
    expect(row("th_archived", { status: "archived" })).toMatchObject({
      unansweredForms: 0,
      attention: [],
    });
  });

  it("is never null or absent — `0` means none, never unknown", () => {
    const all = rows({ includeArchived: "true" });
    expect(all.length).toBeGreaterThan(0);
    for (const item of all) {
      expect(Number.isInteger(item.unansweredForms), `unansweredForms for ${item.id}`).toBe(true);
      expect(item.unansweredForms).toBeGreaterThanOrEqual(0);
    }
    // And the whole page still parses as the declared shape.
    const list = queryDocs(open.db, DocsQuerySchema.parse({ limit: "200" }), NOW);
    expect(DocListSchema.parse(list)).toEqual(list);
  });

  // CONTRACT-040's invariant, asserted as the two implications it is made of.
  // A single-direction test is what lets a count drift above a reason that
  // stopped holding, or a reason survive a count that went to zero.
  it("keeps the count and the `form` reason in step — left to right", () => {
    const all = rows({ includeArchived: "true" });
    const witnesses = all.filter((item) => item.unansweredForms > 0);
    // Not vacuous: the corpus really does hold rows with open forms.
    expect(witnesses.map((item) => item.id).sort()).toEqual([
      "th_one",
      "th_partly",
      "th_three",
      "th_two",
    ]);
    for (const item of witnesses) {
      expect(item.attention, `counted ${String(item.unansweredForms)} on ${item.id}`).toContain(
        "form",
      );
    }
  });

  it("keeps the count and the `form` reason in step — right to left", () => {
    const all = rows({ includeArchived: "true" });
    const flagged = all.filter((item) => item.attention.includes("form"));
    // Not vacuous in the other direction either: rows carry the reason, and
    // rows exist that carry neither.
    expect(flagged.length).toBeGreaterThan(0);
    expect(all.some((item) => item.unansweredForms === 0 && !item.attention.includes("form"))).toBe(
      true,
    );
    for (const item of flagged) {
      expect(item.unansweredForms, `reason without a count on ${item.id}`).toBeGreaterThan(0);
    }
  });

  it("holds the invariant on every row of every listing, not only the default one", () => {
    for (const params of [
      {},
      { includeArchived: "true" },
      { status: "archived" },
      { status: "resolved" },
      { type: "thread" },
      { needs: "me" },
      { needs: "form" },
      { parent: "doc_host" },
    ]) {
      for (const item of rows(params)) {
        expect(
          item.unansweredForms > 0,
          `${JSON.stringify(params)} → ${item.id} counts ${String(item.unansweredForms)} with [${item.attention.join(",")}]`,
        ).toBe(item.attention.includes("form"));
      }
    }
  });

  // The filter compiles from the same fragment the reason column does, so a
  // filtered list and the rows in it cannot disagree about which threads are
  // waiting — *within* that list.
  it("agrees with `needs=form` on every row the filter returns", () => {
    const filtered = rows({ needs: "form" });
    expect(filtered.map((item) => item.id).sort()).toEqual([
      "th_one",
      "th_partly",
      "th_three",
      "th_two",
    ]);
    for (const item of filtered) expect(item.unansweredForms).toBeGreaterThan(0);
    // And within one result set the two are the same rows.
    expect(
      rows()
        .filter((item) => item.unansweredForms > 0)
        .map((item) => item.id)
        .sort(),
    ).toEqual(filtered.map((item) => item.id).sort());
  });

  // What the contract deliberately does NOT publish: that `needs=form`'s item
  // set equals the non-zero rows *globally*. It filters — the rest of the query
  // still decides which rows come back at all — so a composed listing returns
  // fewer rows than there are non-zero ones, and that is not a disagreement.
  it("is a filter, not a promise about which rows a listing returns", () => {
    const everywhere = rows({ includeArchived: "true" }).filter((item) => item.unansweredForms > 0);
    const narrowed = rows({ needs: "form", parent: "th_two" });
    expect(narrowed).toHaveLength(0);
    expect(everywhere.length).toBeGreaterThan(0);
    // Same predicate, fewer rows — a `type` the forms are not on returns none.
    expect(rows({ needs: "form", type: "note" })).toHaveLength(0);
  });

  // The transitions, in a workspace of their own: they rewrite thread files, and
  // the assertions above pin the corpus by name.
  describe("as the thread changes", () => {
    let moving: Workspace;

    const movingRow = (id: string): DocRow => {
      const found = queryDocs(
        moving.db,
        DocsQuerySchema.parse({ limit: "200", includeArchived: "true" }),
        NOW,
      ).items.find((item) => item.id === id);
      expect(found, `no row for ${id}`).toBeDefined();
      return found as DocRow;
    };

    const put = (id: string, status: string, read: boolean): void => {
      const steps = [ASK, form("F1"), form("F2")];
      moving.thread({
        id,
        parent: "doc_host",
        agent: "requested",
        status,
        updated: at(steps.length - 1),
        turns: steps.map((step, index) => ({
          author: step.author,
          ts: at(index),
          body: step.body,
        })),
      });
      moving.seen(read ? { [id]: at(steps.length - 1) } : {});
      moving.reproject();
    };

    beforeAll(() => {
      moving = createWorkspace("unanswered-forms-moving");
      moving.doc({ id: "doc_host", title: "The commented document" });
    });

    afterAll(() => {
      moving.close();
    });

    it("clears the count and the reason together when the thread is resolved", () => {
      put("th_settling", "open", true);
      expect(movingRow("th_settling")).toMatchObject({ unansweredForms: 2, status: "open" });
      expect(movingRow("th_settling").attention).toContain("form");

      // Same file, same turns, the same two unanswered forms — only its status
      // changed, and `t.status = 'open'` is the one term both hang off.
      put("th_settling", "resolved", true);
      expect(movingRow("th_settling")).toMatchObject({ unansweredForms: 0, status: "resolved" });
      expect(movingRow("th_settling").attention).not.toContain("form");
    });

    // §11: "an unanswered form's row is the one that survives being read" — the
    // opposite of `unread`/`unreadThreads`, which being read is what clears.
    it("survives being read, while `unread` does not", () => {
      put("th_reading", "open", false);
      expect(movingRow("th_reading")).toMatchObject({ unread: true, unansweredForms: 2 });

      put("th_reading", "open", true);
      expect(movingRow("th_reading")).toMatchObject({ unread: false, unansweredForms: 2 });
      expect(movingRow("th_reading").attention).toContain("form");
    });
  });

  it("seeks the open questions rather than scanning a thread's turns", () => {
    // The partial index `turns_unanswered_form` is what keeps the correlated
    // COUNT bounded by how many questions are open rather than by how long the
    // conversation is. `docs/performance.test.ts` asserts the same fragment in
    // the WHERE clause; this asserts it in the SELECT list, which is where the
    // row's count is computed.
    const plan = open.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT ${UNANSWERED_FORM_COUNT_SQL}
           FROM documents d LEFT JOIN threads t ON t.id = d.id`,
      )
      .all() as { detail: string }[];
    const details = plan.map((step) => step.detail).join("\n");
    expect(details).toContain("turns_unanswered_form");
    expect(details).not.toMatch(/SCAN tu\b/);
  });
});

describe("sorting and pagination", () => {
  it("orders by each declared key", () => {
    const titles = run({ sort: "title", limit: "200" }).items.map((item) => item.title);
    expect([...titles].sort((a, b) => a.localeCompare(b))).toEqual(titles);

    const ascending = run({ sort: "updated", limit: "200" }).items.map((item) => item.updated);
    expect([...ascending].sort()).toEqual(ascending);

    const descending = run({ sort: "-updated", limit: "200" }).items.map((item) => item.updated);
    expect([...descending].sort().reverse()).toEqual(descending);

    const created = run({ sort: "created", limit: "200" }).items.map((item) => item.created);
    expect([...created].sort()).toEqual(created);

    const due = run({ sort: "due", limit: "200", status: "open" })
      .items.map((item) => item.due)
      .filter((value): value is string => value !== null);
    expect([...due].sort()).toEqual(due);
  });

  it("defaults to `-updated`", () => {
    expect(run({ limit: "200" }).items.map((i) => i.id)).toEqual(
      run({ sort: "-updated", limit: "200" }).items.map((i) => i.id),
    );
  });

  it("pages stably across ties", () => {
    const first = run({ limit: "5", offset: "0" }).items.map((i) => i.id);
    const second = run({ limit: "5", offset: "5" }).items.map((i) => i.id);
    expect(new Set([...first, ...second]).size).toBe(10);
    expect(run({ limit: "5", offset: "0" }).items.map((i) => i.id)).toEqual(first);
    expect(run({ limit: "10", offset: "0" }).items.map((i) => i.id)).toEqual([...first, ...second]);
  });
});
