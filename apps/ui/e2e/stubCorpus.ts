import type { Page, Route } from "@playwright/test";

/**
 * A corpus, in the browser, for the specs that need one.
 *
 * `playwright.config.ts` deliberately starts **no** workspace server — the
 * shell has to render honestly with nothing behind it, and `smoke.spec.ts`
 * pins exactly that. So a spec about what the board *does* with documents has
 * two options: point the whole suite at a real server (which turns three
 * unrelated tests red) or serve the API from inside the page.
 *
 * This is the second. Everything above the transport is the real application —
 * real React, real TanStack cache, real DOM, real pointer and keyboard events —
 * and only `fetch` is answered from here. It is therefore **half** the
 * evidence, exactly as sprint-016 Adjudication 19 says: the disk, git, lock and
 * projection half comes from each issue's real-app drill against a real
 * `corpus` server, and neither half is acceptance on its own.
 */

export interface StubRow {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  readonly path?: string;
  readonly body?: string;
  readonly status?: string;
  readonly pinned?: boolean;
  readonly order?: number | null;
  readonly query?: Readonly<Record<string, unknown>> | null;
  readonly column?: string | null;
  readonly parent?: string | null;
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly stale?: unknown;
}

interface StoredDoc {
  id: string;
  type: string;
  title: string;
  path: string;
  body: string;
  status: string;
  pinned: boolean;
  order: number | null;
  query: Readonly<Record<string, unknown>> | null;
  column: string | null;
  parent: string | null;
  extra: Record<string, unknown>;
  stale: unknown;
}

export interface StubRequest {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

export interface StubCorpus {
  /** Every `/api` request the page made, in order. */
  readonly requests: () => Promise<readonly StubRequest[]>;
  readonly of: (method: string, path?: string) => Promise<readonly StubRequest[]>;
  /** The stored document, or `undefined` once it has been deleted. */
  readonly doc: (id: string) => Promise<StoredDoc | undefined>;
  readonly ids: () => Promise<readonly string[]>;
}

function seeded(row: StubRow): StoredDoc {
  return {
    id: row.id,
    type: row.type ?? "note",
    title: row.title ?? "Untitled",
    path: row.path ?? `data/docs/inbox/${row.id}.md`,
    body: row.body ?? "",
    status: row.status ?? "open",
    pinned: row.pinned ?? false,
    order: row.order ?? null,
    query: row.query ?? null,
    column: row.column ?? null,
    parent: row.parent ?? null,
    extra: { ...(row.extra ?? {}) },
    stale: row.stale ?? null,
  };
}

/**
 * Installs the stub. Call before `page.goto` — the board queries on first
 * render, and a route added afterwards would miss the first request.
 */
export async function stubCorpus(page: Page, rows: readonly StubRow[]): Promise<StubCorpus> {
  const store = new Map<string, StoredDoc>(rows.map((row) => [row.id, seeded(row)]));
  const requests: StubRequest[] = [];
  let created = 0;

  const json = async (route: Route, payload: unknown, status = 200): Promise<void> => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  };

  const asRow = (doc: StoredDoc): unknown => ({
    id: doc.id,
    type: doc.type,
    title: doc.title,
    path: doc.path,
    status: doc.status,
    tags: [],
    created: "2026-07-01T09:00:00.000Z",
    updated: "2026-07-01T09:00:00.000Z",
    due: null,
    reviewed: null,
    evergreen: false,
    excerpt: doc.body.slice(0, 120),
    stale: doc.stale,
    parent: doc.parent,
    agent: null,
    anchorQuote: null,
    turnCount: doc.type === "thread" ? 1 : null,
    lastAuthor: doc.type === "thread" ? "user" : null,
    lastTurn: doc.type === "thread" ? doc.body : null,
    unread: doc.type === "thread" ? false : null,
    awaitingAgent: doc.type === "thread" ? false : null,
    unreadThreads: 0,
    attention: [],
    snippets: [],
    parentTitle: null,
    pinned: doc.pinned,
    order: doc.order,
    query: doc.query,
    column: doc.column,
    extra: doc.extra,
  });

  const asDoc = (doc: StoredDoc): unknown => ({
    body: doc.body,
    path: doc.path,
    anchors: [],
    frontmatter: {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      created: "2026-07-01T09:00:00.000Z",
      updated: "2026-07-01T09:00:00.000Z",
      tags: [],
      status: doc.status,
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      pinned: doc.pinned,
      order: doc.order,
      query: doc.query,
      column: doc.column,
      extra: doc.extra,
    },
  });

  const matches = (doc: StoredDoc, params: URLSearchParams): boolean => {
    const pinned = params.get("pinned");
    if (pinned !== null && String(doc.pinned) !== pinned) return false;
    const type = params.get("type");
    if (type !== null && !type.split(",").includes(doc.type)) return false;
    const parent = params.get("parent");
    if (parent !== null && doc.parent !== parent) return false;
    // Nothing in these specs links documents, so a backlinks query is empty by
    // construction rather than by filter.
    if (params.get("references") !== null) return false;
    const folder = params.get("folder");
    if (folder !== null && !doc.path.includes(`/${folder.replace(/\/+$/, "")}/`)) return false;
    const status = params.get("status");
    if (status !== null) return status.split(",").includes(doc.status);
    return doc.status !== "archived";
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const raw = request.postData();
    requests.push({
      method,
      path: url.pathname,
      search: url.search,
      body: raw === null ? undefined : (JSON.parse(raw) as unknown),
    });

    if (url.pathname === "/api/locks") return json(route, { locks: [] });
    if (url.pathname === "/api/jobs") return json(route, { jobs: [] });
    if (url.pathname === "/api/tree") return json(route, { folders: [] });
    if (url.pathname === "/api/queue/status") {
      return json(route, {
        pending: 0,
        inProgress: 0,
        deferred: 0,
        failed: 0,
        processed: 0,
        halted: false,
        agent: "idle",
      });
    }

    if (url.pathname === "/api/docs" && method === "GET") {
      const items = [...store.values()]
        .filter((doc) => matches(doc, url.searchParams))
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(asRow);
      return json(route, { items, page: { total: items.length, limit: 50, offset: 0 } });
    }

    if (url.pathname === "/api/docs" && method === "POST") {
      created += 1;
      const input = (requests.at(-1)?.body ?? {}) as Record<string, unknown>;
      const doc = seeded({
        id: `doc_new${String(created)}`,
        type: typeof input["type"] === "string" ? input["type"] : "note",
        title: typeof input["title"] === "string" ? input["title"] : "Untitled",
        path: `data/docs/${typeof input["folder"] === "string" ? input["folder"] : "inbox"}/new${String(created)}.md`,
      });
      store.set(doc.id, doc);
      return json(route, { doc: asDoc(doc), warnings: [] }, 201);
    }

    if (url.pathname.startsWith("/api/docs/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/docs/".length));
      if (method === "DELETE") {
        store.delete(id);
        return json(route, { deletedId: id, orphanedThreadIds: [], warnings: [] });
      }
      const doc = store.get(id);
      if (doc === undefined) return json(route, { code: "not_found", message: id }, 404);
      if (method === "PUT") {
        const changes = (requests.at(-1)?.body ?? {}) as Record<string, unknown>;
        if (typeof changes["title"] === "string") doc.title = changes["title"];
        if (typeof changes["status"] === "string") doc.status = changes["status"];
        if (typeof changes["body"] === "string") doc.body = changes["body"];
        if (changes["extra"] !== undefined && changes["extra"] !== null) {
          // RFC 7386 shallow merge, exactly as the server applies it.
          doc.extra = { ...doc.extra, ...(changes["extra"] as Record<string, unknown>) };
        }
        return json(route, {
          doc: asDoc(doc),
          anchors: { remapped: [], orphaned: [] },
          warnings: [],
        });
      }
      return json(route, asDoc(doc));
    }

    return json(route, {});
  });

  return {
    requests: () => Promise.resolve([...requests]),
    of: (method, path) =>
      Promise.resolve(
        requests.filter(
          (entry) => entry.method === method && (path === undefined || entry.path === path),
        ),
      ),
    doc: (id) => Promise.resolve(store.get(id)),
    ids: () => Promise.resolve([...store.keys()]),
  };
}
