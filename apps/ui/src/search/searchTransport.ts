import type { SearchHit } from "@corpus/contract";
import {
  boardTransport,
  type BoardTransportOptions,
  type RecordedCall,
} from "../testing/boardFixture";

/**
 * A recording transport that also answers `GET /api/search`.
 *
 * The overlay reads two collections and writes two: its ranking comes from
 * `/api/search`, while "save as view" and the create row still go through
 * `/api/docs`, and the reader's `docKey` read resolves a hit's home column. So
 * the fixture is `boardTransport` with the one endpoint it does not know about
 * answered in front of it, rather than a second stub of everything.
 *
 * It lives beside the overlay rather than in `../testing/` on purpose:
 * `boardFixture.ts` is shared with the board's and the reader's suites, and a
 * search-only branch in a shared single-function handler is how two suites end
 * up disagreeing about one file.
 */

export interface SearchTransportOptions extends BoardTransportOptions {
  /** The ranking any query answers with; store order, as a stub honestly can. */
  readonly hits?: readonly SearchHit[];
  /** The envelope's `semanticIndex`; omitted means the server makes no claim. */
  readonly semanticIndex?: string;
  /** Status to answer `/api/search` with instead of a ranking. */
  readonly searchFails?: number;
  /**
   * Documents `GET /api/docs/{id}` answers with, by id — where a hit *lives*.
   *
   * The overlay reads one to resolve a hit's home column, and a hit carries no
   * placement of its own, so the placement has to come from somewhere real.
   */
  readonly docs?: Readonly<Record<string, { readonly path: string; readonly type?: string }>>;
}

export interface SearchTransport {
  readonly fetch: typeof globalThis.fetch;
  /** Every call, `/api/search` included, in order. */
  readonly calls: RecordedCall[];
  /** The ranked-retrieval requests only — what the request-count assertions read. */
  readonly searches: () => RecordedCall[];
  readonly writes: (method: string) => RecordedCall[];
}

export function searchTransport(options: SearchTransportOptions = {}): SearchTransport {
  const board = boardTransport(options);
  const calls: RecordedCall[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    /*
     * Read the URL *without* constructing a `Request`: doing so from a `Request`
     * marks the original's body used, and the delegate below would then be
     * handed a spent one.
     */
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input),
    );
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");

    const byId = /^\/api\/docs\/([^/]+)$/.exec(url.pathname);
    const placed = byId === undefined || byId === null ? undefined : options.docs?.[byId[1] ?? ""];
    if (placed !== undefined && method === "GET" && options.failing?.[url.pathname] === undefined) {
      calls.push({ method, path: url.pathname, search: url.search, body: undefined });
      return new Response(
        JSON.stringify({
          frontmatter: { id: byId?.[1], type: placed.type ?? "note", status: "open" },
          body: "",
          path: placed.path,
          anchors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname !== "/api/search") return board.fetch(input, init);
    calls.push({ method, path: url.pathname, search: url.search, body: undefined });
    if (options.searchFails !== undefined) {
      return new Response(JSON.stringify({ code: "bad_request", message: "no such filter" }), {
        status: options.searchFails,
        headers: { "content-type": "application/json" },
      });
    }
    // `q` is required and an empty one is a `400`, exactly as the contract says
    // — a fixture that answered an empty query would hide the very behaviour
    // the hook's `enabled` guard exists to produce.
    if ((url.searchParams.get("q") ?? "") === "") {
      return new Response(JSON.stringify({ code: "bad_request", message: "q is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        hits: options.hits ?? [],
        ...(options.semanticIndex === undefined ? {} : { semanticIndex: options.semanticIndex }),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  return {
    fetch,
    get calls() {
      return [...board.calls, ...calls];
    },
    searches: () => calls.filter((call) => call.path === "/api/search"),
    writes: (method) => board.calls.filter((call) => call.method === method),
  };
}

/** A ranked hit, as `GET /api/search` returns one. */
export function hitFixture(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: "doc_a1b2c3",
    title: "Fixture document",
    headingPath: "Fixture document",
    snippet: "a line of context from the passage that matched",
    ...overrides,
  };
}
