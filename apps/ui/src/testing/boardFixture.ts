import type {
  AgentRoster,
  DocRow,
  QueueStatus,
  ReflectStatus,
  WorkspaceVocabulary,
} from "@corpus/contract";
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
  /** Rows returned for the view query (`type=view`) — the board's columns. */
  readonly views?: readonly DocRow[];
  /**
   * Rows returned for the board query (`type=board&sort=order`).
   *
   * Omitted, one board is synthesised listing every row in {@link views}, in the
   * order given — which is what almost every board test wants and what the seed
   * ships. Give it explicitly to test the bar itself, an empty board, or a board
   * naming a view that is not there.
   */
  readonly boards?: readonly DocRow[];
  /** Rows returned for any other `/api/docs` query, keyed by the search string. */
  readonly rows?: Readonly<Record<string, readonly DocRow[]>>;
  /** Rows returned for a query with no entry in `rows`. */
  readonly defaultRows?: readonly DocRow[];
  readonly tree?: unknown;
  /**
   * What `GET /api/workspace/reflect` answers — the clock, the pending
   * reflection, the corpus count and the quiet window (SPEC.md §7's rider 9).
   *
   * Answered rather than left to the catch-all for the reason UI-098 learned
   * here twice: the board bar always renders the Reflect control, so the first
   * surface to read a new field turns a silent `{}` into a component that reads
   * `pending` off nothing and reports *reflecting…* forever.
   *
   * The default is {@link QUIET_REFLECT_STATUS} — a corpus the agent looked at
   * after every fixture row was written — so nothing is marked unless a test
   * says so. That is the honest default and not merely the convenient one: these
   * fixtures seed documents dated 2026-07-01 and run no agent, and a clock
   * *before* them would light every row in every board suite.
   */
  readonly reflect?: Partial<ReflectStatus>;
  /** Paths that answer with an error, mapped to the status to answer with. */
  readonly failing?: Readonly<Record<string, number>>;
  /**
   * What `GET /api/vocabulary` answers (SPEC.md §9.2, CONTRACT-092).
   *
   * Omitted, it is derived from the seeded rows' tags, so a suite that seeds a
   * tag can complete on it without declaring the vocabulary twice. Give it
   * explicitly to test the `extra.` completions, which no `DocRow` carries.
   */
  readonly vocabulary?: WorkspaceVocabulary;
}

/** Tags across every seeded row, counted — the fixture's own vocabulary. */
function vocabularyFrom(options: BoardTransportOptions): WorkspaceVocabulary {
  const counts = new Map<string, number>();
  const seeded = [
    ...(options.views ?? []),
    ...(options.boards ?? []),
    ...(options.defaultRows ?? []),
    ...Object.values(options.rows ?? {}).flat(),
  ];
  for (const doc of seeded) {
    for (const tag of doc.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return {
    tags: [...counts.entries()]
      .sort(([a, ac], [b, bc]) => (ac === bc ? (a < b ? -1 : 1) : bc - ac))
      .map(([value, count]) => ({ value, count })),
    extraKeys: [],
  };
}

/**
 * A corpus reflected on after every fixture document was written — so
 * `isUnreflected` is false for all of them, and no board suite grows a mark it
 * did not ask for.
 */
export const QUIET_REFLECT_STATUS: ReflectStatus = {
  reflected: "2026-08-01T09:00:00.000Z",
  pending: null,
  changed: 0,
  lastDigest: null,
  quiet: 30,
};

/** The board a fixture synthesises when the test names none. */
export const DEFAULT_BOARD_ID = "doc_board_default";

/** A `type: view` document, as the collection returns one (no `pinned`, no `order`). */
export function viewRow(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    type: "view",
    evergreen: true,
    origin: null,
    path: "data/docs/views/a.md",
    ...overrides,
  });
}

/** A `type: board` document, as the collection returns one (CONTRACT-074). */
export function boardRow(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    id: DEFAULT_BOARD_ID,
    type: "board",
    title: "Board",
    path: `data/docs/boards/${DEFAULT_BOARD_ID}.md`,
    order: 1,
    columns: [],
    ...overrides,
  });
}

function collection(items: readonly DocRow[]): unknown {
  return { items, page: { total: items.length, limit: 50, offset: 0 } };
}

/** One board listing every seeded view, in the order the test gave them. */
function synthesisedBoard(options: BoardTransportOptions): DocRow {
  return boardRow({ columns: (options.views ?? []).map((view) => view.id) });
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
      const type = url.searchParams.get("type");
      /*
       * The two structural queries the board issues (UI-148): the bar's boards,
       * and every view document the showing board resolves its `columns`
       * against. Matched ahead of `rows` so a test that seeds a column's
       * contents cannot accidentally answer the board's own query.
       */
      if (type === "board") return json(collection(options.boards ?? [synthesisedBoard(options)]));
      if (type === "view" && url.searchParams.get("sort") === null) {
        return json(collection(options.views ?? []));
      }
      const keyed = options.rows?.[url.search];
      return json(collection(keyed ?? options.defaultRows ?? []));
    }
    if (url.pathname === "/api/tree") return json(options.tree ?? { folders: [] });
    /*
     * `GET /api/vocabulary` — the tags and invented frontmatter keys the query
     * editor completes from (CONTRACT-092). Answered rather than left to the
     * `{}` catch-all for the reason this file has learned twice: the first
     * surface to read a new field turns a silent stub gap into a component
     * reading `tags` off nothing.
     *
     * **Derived from the seeded rows** rather than canned, so a suite that
     * seeds a tag can complete on it without also declaring a vocabulary — and
     * so the fixture cannot offer a tag no document in it carries.
     */
    if (url.pathname === "/api/vocabulary") {
      return json(options.vocabulary ?? vocabularyFrom(options));
    }
    if (url.pathname === "/api/jobs") return json({ jobs: [] });
    /*
     * The console strip is mounted by every shell these fixtures render, so its
     * one read gets a real answer rather than the `{}` the catch-all gave it.
     * That `{}` type-checked as nothing (the catch-all is `unknown`) and was
     * wrong in the way UI-102 named for `stubCorpus`: a body missing a required
     * field, invisible until something read it. UI-098 read it, and the whole
     * `Shell` suite threw on `agent.live`.
     *
     * `agent` says nobody is parked, which is true of every spec here — none
     * starts an agent — and is the honest fixture rather than the convenient
     * one.
     */
    if (url.pathname === "/api/queue/status") {
      return json({
        agent: { live: false, since: null },
        halted: false,
        pending: 0,
        inProgress: 0,
        deferred: 0,
        processed: 0,
        failed: 0,
        abandoned: 0,
      } satisfies QueueStatus);
    }
    /*
     * `GET /api/agents` — §7's roster (UI-108). Answered rather than left to the
     * `{}` fallback for the reason UI-098 learned the hard way here: the first
     * surface to read a new field turns a silent stub gap into a crash in a
     * component that always renders.
     */
    if (url.pathname === "/api/agents") {
      return json({
        agents: [
          {
            lane: "orchestrator",
            resident: null,
            live: false,
            since: null,
            pending: 0,
            working: false,
            summary: null,
            origin: null,
          },
        ],
      } satisfies AgentRoster);
    }
    /*
     * `GET /api/workspace/reflect` — the board bar's Reflect control (UI-153).
     * `POST` is the ask, and it answers `202` always: §7 says an ask while one
     * is pending is answered with the pending one, never refused, so a fixture
     * that raised a `409` here would let a test assert a refusal the server
     * cannot produce.
     */
    if (url.pathname === "/api/workspace/reflect") {
      const status: ReflectStatus = { ...QUIET_REFLECT_STATUS, ...options.reflect };
      if (request.method === "POST") {
        return json(
          {
            eventId: "evt_reflect",
            since: status.reflected,
            pending: status.pending !== null,
          },
          202,
        );
      }
      return json(status);
    }
    /*
     * `PUT /api/workspace/reflect/quiet` — the switch (UI-172). It **echoes the
     * value it was given** back on the whole status, because that is what the
     * real route does and it is what makes the control's optimism-free
     * behaviour testable: the switch flips because the server said so.
     */
    if (url.pathname === "/api/workspace/reflect/quiet" && request.method === "PUT") {
      const status: ReflectStatus = { ...QUIET_REFLECT_STATUS, ...options.reflect };
      return request.text().then((raw) => {
        const { quiet } = JSON.parse(raw) as { quiet: number };
        return json({ ...status, quiet });
      });
    }
    /*
     * `POST /api/boards/order` — the bar's order, written as one act and one
     * commit (SPEC.md §10, rider 2; CONTRACT-080). Answered rather than left to
     * the `{}` catch-all: the provider reads `boards` off the result to say how
     * many documents moved, and a `{}` would have it read `filter` off nothing.
     * It renumbers what it was sent, as the server does, so a spec asserting the
     * count is asserting the rule rather than a canned number.
     */
    if (url.pathname === "/api/boards/order" && request.method === "POST") {
      const ids = ((call.body as { boards?: string[] } | undefined)?.boards ?? []).map(
        (id, index) => ({ id, order: index + 1, changed: true }),
      );
      return json({ boards: ids, commit: "c0mm1t", warnings: [] });
    }

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
