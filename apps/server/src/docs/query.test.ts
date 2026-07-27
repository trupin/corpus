import { DocListSchema, DocsQuerySchema, type DocList, type DocsQuery } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInstant } from "../core/time.js";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { folderPathPrefix, queryDocs, UNDATED_INSTANT } from "./query.js";

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
      "attention",
      "created",
      "due",
      "evergreen",
      "excerpt",
      "id",
      "path",
      "reviewed",
      "snippets",
      "status",
      "tags",
      "title",
      "type",
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
      expect(row).toMatchObject({
        id: "doc_ok",
        tags: [],
        created: UNDATED_INSTANT,
        updated: UNDATED_INSTANT,
      });
      // An undated document has no known age, so it is not stale either.
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
