import type { DocRow } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";

/**
 * A recording transport for the board's suites.
 *
 * The board reads four collections and writes two, so every one of its tests
 * would otherwise repeat the same forty lines of `fetch` stub. Stubbing happens
 * at the **transport** boundary rather than at the kit hooks: a test that mocks
 * `useDocs` proves the component calls a function, while this one proves it
 * issues the request the server actually answers — which is what the request
 * assertions (one bounded query, N writes, no `DELETE`) are about.
 */

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

export interface BoardTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedCall[];
  /** Calls matching a method and an exact path — the write assertions. */
  readonly writes: (method: string) => RecordedCall[];
}

export interface BoardTransportOptions {
  /** Rows returned for the pinned-view query (`pinned=true`). */
  readonly views?: readonly DocRow[];
  /** Rows returned for any other `/api/docs` query, keyed by the search string. */
  readonly rows?: Readonly<Record<string, readonly DocRow[]>>;
  /** Rows returned for a query with no entry in `rows`. */
  readonly defaultRows?: readonly DocRow[];
  readonly tree?: unknown;
  /** Paths that answer with an error, mapped to the status to answer with. */
  readonly failing?: Readonly<Record<string, number>>;
}

/** A pinned `type: view` document, as the collection returns one. */
export function viewRow(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    type: "view",
    pinned: true,
    evergreen: true,
    path: "data/docs/views/a.md",
    ...overrides,
  });
}

function collection(items: readonly DocRow[]): unknown {
  return { items, page: { total: items.length, limit: 50, offset: 0 } };
}

export function boardTransport(options: BoardTransportOptions = {}): BoardTransport {
  const calls: RecordedCall[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const raw = await request.text();
    const call: RecordedCall = {
      method: request.method,
      path: url.pathname,
      search: url.search,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    };
    calls.push(call);

    const failure = options.failing?.[url.pathname + url.search];
    if (failure !== undefined) {
      return new Response(JSON.stringify({ code: "bad_request", message: "no such filter" }), {
        status: failure,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/docs" && request.method === "GET") {
      const isViews = url.searchParams.get("pinned") === "true";
      if (isViews) return json(collection(options.views ?? []));
      const keyed = options.rows?.[url.search];
      return json(collection(keyed ?? options.defaultRows ?? []));
    }
    if (url.pathname === "/api/tree") return json(options.tree ?? { folders: [] });
    if (url.pathname === "/api/locks") return json({ locks: [] });
    if (url.pathname === "/api/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/docs" && request.method === "POST") {
      return json({ doc: created("doc_created"), warnings: [] }, 201);
    }
    if (url.pathname.startsWith("/api/docs/") && request.method === "PUT") {
      return json({
        doc: created(url.pathname.slice("/api/docs/".length)),
        anchors: { remapped: [], orphaned: [] },
        warnings: [],
      });
    }
    /*
     * `POST …/archive` and `POST …/unarchive` — SPEC.md §7's reversible act, and
     * the only routes that move a skill's folder. Answered with the mutation
     * shape rather than falling through to the document read below, so a test
     * asserting the wire is asserting a request the server would recognise
     * (UI-020).
     */
    if (/^\/api\/docs\/[^/]+\/(?:un)?archive$/.test(url.pathname)) {
      return json({ doc: created(url.pathname.split("/")[3] ?? ""), warnings: [] });
    }
    /*
     * `DELETE /api/docs/{id}` answers with the deletion *result*, not a
     * document (`DeleteDocResultSchema`). Falling through to the read below
     * gave the caller a doc, and reading `orphanedThreadIds` off it threw
     * inside the mutation's own `then` — which surfaced as a refused delete
     * and, in focus mode, as an excursion that never emptied (UI-031).
     */
    if (url.pathname.startsWith("/api/docs/") && request.method === "DELETE") {
      return json({
        deletedId: url.pathname.slice("/api/docs/".length),
        orphanedThreadIds: [],
        warnings: [],
      });
    }
    if (url.pathname.startsWith("/api/docs/")) return json(created(url.pathname));
    return json({});
  };

  return {
    fetch,
    calls,
    writes: (method) => calls.filter((call) => call.method === method),
  };
}

function created(id: string): unknown {
  return {
    frontmatter: { ...docRowFixture({ id }), anchors: {} },
    body: "",
    path: `data/docs/inbox/${id}.md`,
    anchors: [],
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
