import type { Doc, DocRow, Lock, Thread } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";

/**
 * A recording transport for the reader's suites.
 *
 * Stubbed at the **transport** boundary, like `boardFixture`: a test that mocks
 * the kit hooks proves the reader calls a function, while this one proves it
 * issues the requests the server actually answers — which is what the request
 * assertions (no request per ref, one backlinks query, no `DELETE` before the
 * second click) are about.
 */

export interface ReaderCall {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

export interface ReaderTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: ReaderCall[];
  readonly of: (method: string, path?: string) => ReaderCall[];
  /** Replaces a document mid-test, for out-of-band edits arriving over SSE. */
  readonly put: (doc: Doc) => void;
  readonly setLocks: (locks: readonly Lock[]) => void;
}

export interface ReaderTransportOptions {
  readonly docs?: readonly Doc[];
  readonly threads?: readonly Thread[];
  /** Rows returned for a `/api/docs` collection query, keyed by search string. */
  readonly rows?: Readonly<Record<string, readonly DocRow[]>>;
  readonly locks?: readonly Lock[];
  /** `"<METHOD> <pathname>"` → status, for the failure paths. */
  readonly failing?: Readonly<Record<string, number>>;
}

/** Every field overridable, `frontmatter` field by field rather than wholesale. */
export type DocOverrides = Omit<Partial<Doc>, "frontmatter"> & {
  readonly frontmatter?: Partial<Doc["frontmatter"]>;
};

export function docFixture(overrides: DocOverrides = {}): Doc {
  const frontmatterOverrides = overrides.frontmatter ?? {};
  return {
    body: "",
    path: "data/docs/finance/fixture.md",
    anchors: [],
    ...overrides,
    frontmatter: {
      id: "doc_fixture",
      type: "note",
      title: "Fixture document",
      created: "2026-07-01T09:00:00.000Z",
      updated: "2026-07-02T09:00:00.000Z",
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra: {},
      ...frontmatterOverrides,
    },
  };
}

export function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "th_fixture",
    title: "Fixture thread",
    created: "2026-07-01T09:00:00.000Z",
    updated: "2026-07-01T09:05:00.000Z",
    status: "open",
    tags: [],
    parent: null,
    anchor: null,
    agent: "none",
    turns: [],
    ...overrides,
  };
}

export function threadRowFixture(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    id: "th_fixture",
    type: "thread",
    title: "Fixture thread",
    path: "data/threads/th_fixture.md",
    turnCount: 2,
    lastAuthor: "agent",
    lastTurn: "A reply.",
    unread: false,
    awaitingAgent: false,
    ...overrides,
  });
}

export function readerTransport(options: ReaderTransportOptions = {}): ReaderTransport {
  const calls: ReaderCall[] = [];
  const docs = new Map((options.docs ?? []).map((doc) => [doc.frontmatter.id, doc]));
  const threads = new Map((options.threads ?? []).map((thread) => [thread.id, thread]));
  let locks = options.locks ?? [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });

    const failure = options.failing?.[`${request.method} ${url.pathname}`];
    if (failure !== undefined) {
      return json({ code: "conflict", message: "the server refused" }, failure);
    }

    if (url.pathname === "/api/locks") return json({ locks });
    if (url.pathname === "/api/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/tree") return json({ folders: [] });

    if (url.pathname === "/api/docs" && request.method === "GET") {
      const items = options.rows?.[url.search] ?? [];
      return json({ items, page: { total: items.length, limit: 50, offset: 0 } });
    }

    if (url.pathname.startsWith("/api/docs/")) {
      const id = url.pathname.slice("/api/docs/".length);
      if (request.method === "DELETE") {
        docs.delete(id);
        return json({ deletedId: id, orphanedThreadIds: [], warnings: [] });
      }
      const doc = docs.get(id);
      if (doc === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
      if (request.method === "PUT") {
        return json({ doc, anchors: { remapped: [], orphaned: [] }, warnings: [] });
      }
      return json(doc);
    }

    if (url.pathname.startsWith("/api/threads/")) {
      const rest = url.pathname.slice("/api/threads/".length);
      const [id = "", verb] = rest.split("/");
      if (verb === "seen") {
        return json({ threadId: id, lastSeenTs: "2026-07-02T09:00:00.000Z", unread: false });
      }
      if (verb === "resolve" || verb === "reopen") {
        return json({ thread: threadSummary(id, verb === "resolve"), warnings: [] });
      }
      const thread = threads.get(id);
      if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
      return json(thread);
    }

    if (url.pathname.endsWith("/break")) {
      return json({ docId: url.pathname.split("/")[3] ?? "", released: true, holder: "agent" });
    }

    return json({});
  };

  return {
    fetch,
    calls,
    of: (method, path) =>
      calls.filter((call) => call.method === method && (path === undefined || call.path === path)),
    put: (doc) => {
      docs.set(doc.frontmatter.id, doc);
    },
    setLocks: (next) => {
      locks = next;
    },
  };
}

function threadSummary(id: string, resolved: boolean): unknown {
  return {
    id,
    title: "Fixture thread",
    status: resolved ? "resolved" : "open",
    parent: null,
    anchor: null,
    agent: "none",
    created: "2026-07-01T09:00:00.000Z",
    updated: "2026-07-01T09:05:00.000Z",
    turnCount: 1,
    lastAuthor: "user",
    lastTs: "2026-07-01T09:05:00.000Z",
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The two collection searches a reader always issues, for keying `rows`. */
export function threadsSearch(docId: string): string {
  return `?parent=${docId}&type=thread`;
}

export function backlinksSearch(docId: string): string {
  return `?references=${docId}`;
}
