import {
  DocListSchema,
  DocsQuerySchema,
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
import { UNREAD_SQL } from "./needs.js";
import { folderPathPrefix, queryDocs } from "./query.js";

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
        ].map((id) => [id, daysAgo(2)]),
      ),
    );
    forms.reproject();
  });

  afterAll(() => {
    forms.close();
  });

  it("flags a fence that opens a block, wherever the block starts and however the file ends its lines", () => {
    expect(flagged("form")).toEqual(["th_crlf", "th_formatstart", "th_realform"]);
  });

  it("does not flag a turn that merely mentions a fence", () => {
    for (const id of ["th_formula", "th_quoted", "th_indented", "th_inline"]) {
      expect(flagged("form")).not.toContain(id);
      expect(flagged("me")).not.toContain(id);
    }
  });

  it("lets a resolved thread out of Attention — handling the reason clears the row", () => {
    expect(flagged("form")).not.toContain("th_resolved");
    expect(flagged("me")).not.toContain("th_resolved");
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
    hub.doc({ id: "doc_hub", title: "Four threads" });
    hub.doc({ id: "doc_quiet", title: "No threads at all" });
    hub.doc({ id: "doc_settled", title: "One thread, read" });

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

    hub.thread({
      id: "th_ondoc",
      parent: "doc_settled",
      turns: [{ author: "user", ts: daysAgo(9), body: "Read." }],
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
    // Four threads: two unread, one read to its last turn, one marked seen at a
    // `lastSeenTs` before its last turn.
    expect(aggregate("doc_hub")).toBe(3);
  });

  it("reports 0 for a childless document and for one whose threads are all read", () => {
    expect(aggregate("doc_quiet")).toBe(0);
    expect(aggregate("doc_settled")).toBe(0);
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
    // Not vacuously true: at least one document has a non-zero count.
    expect(documents.some((item) => item.unreadThreads > 0)).toBe(true);
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

  it("seeks the parent index rather than scanning threads per row", () => {
    // The `threads_parent_id` index is what keeps the correlated subquery
    // bounded; without it every row of every page would scan the table.
    const plan = hub.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT (
           SELECT COUNT(*) FROM threads t LEFT JOIN seen s ON s.thread_id = t.id
            WHERE t.parent_id = d.id AND ${UNREAD_SQL}
         ) FROM documents d`,
      )
      .all() as { detail: string }[];
    const details = plan.map((step) => step.detail).join("\n");
    expect(details).toContain("threads_parent_id");
    expect(details).not.toMatch(/SCAN t\b/);
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
