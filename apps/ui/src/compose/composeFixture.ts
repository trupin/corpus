import type { AgentLane, AgentRoster } from "@corpus/contract";
import { unknownRecipientBody } from "../testing/serverRefusals";
/**
 * A recording transport for the composer's suites.
 *
 * Both of the composer's submits are multipart-capable, and one of them
 * (`POST /api/capture`) is multipart *always* — so unlike the board's fixture
 * this one never assumes a JSON body. It records the parsed form parts, which is
 * what the assertions are actually about: which field carried the text, whether
 * `requestsAgent` was the string `"true"`, and how many `files` parts there were.
 */

const ORCHESTRATOR_ROW: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: false,
  since: null,
  summary: null,
  origin: null,
};

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  /** Parsed JSON body, or `undefined` for a multipart or empty one. */
  readonly json: Record<string, unknown> | undefined;
  /** Text parts of a multipart body, or `undefined` for a JSON one. */
  readonly form: Record<string, string> | undefined;
  readonly files: readonly string[];
}

export interface ComposeTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: RecordedRequest[];
  readonly to: (path: string) => RecordedRequest[];
  /**
   * **The other tab** (SPEC.md §7): releases a lane behind this page's back, so
   * `GET /api/agents` stops naming it while this page's cache still does. The
   * next post naming it is refused `422`, exactly as the server refuses it.
   */
  readonly releaseLane: (lane: string) => void;
}

export interface ComposeTransportOptions {
  /** Paths that answer with an error status instead of a result. */
  readonly failing?: Readonly<Record<string, number>>;
  /** `eventId` the thread/capture results carry; `null` means nothing was enqueued. */
  readonly eventId?: string | null;
  readonly warnings?: readonly { readonly code: string; readonly detail: string }[];
  /** Rows for `GET /api/docs`, so the autocompletes have something to list. */
  readonly rows?: readonly unknown[];
  /**
   * Documents `GET /api/docs/{id}` answers with, keyed by id.
   *
   * The composer reads one: the orchestrate skill, for the weight levels it may
   * offer (SPEC.md §11's rider). With no entry the read answers `404`, the level
   * set is empty, and the composer offers no control at all — which is exactly
   * what a workspace on an older template gets, and is why every suite written
   * before this feature still describes the composer correctly.
   */
  readonly docs?: Readonly<Record<string, unknown>>;
  /**
   * Designated lanes `GET /api/agents` answers with, beside the orchestrator's
   * unconditional row (SPEC.md §7's roster, UI-108). With one lane the composer
   * offers no recipient control at all, which is what every suite written before
   * this feature expects.
   */
  readonly lanes?: readonly AgentLane[];
}

/** JSON bodies reach `fetch` as a string; anything else is not a body this fixture reads. */
function bodyText(body: BodyInit): string {
  return typeof body === "string" ? body : "";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function composeTransport(options: ComposeTransportOptions = {}): ComposeTransport {
  const calls: RecordedRequest[] = [];
  const eventId = options.eventId === undefined ? "evt_1" : options.eventId;
  const warnings = options.warnings ?? [];
  /**
   * Lanes released **behind this page's back** — the other tab (SPEC.md §7).
   * `GET /api/agents` stops naming them while whatever this page has cached
   * still does, which is the disagreement UI-118 is about and the only way to
   * make the server's `422` reachable from a composer.
   */
  const released = new Set<string>();
  const isLane = (lane: string): boolean =>
    lane === "orchestrator" ||
    (options.lanes ?? []).some((row) => row.lane === lane && !released.has(row.lane));

  /**
   * The multipart body is read off `init` rather than through `new Request(…)`:
   * jsdom's `Request` stringifies a `FormData` to `"[object FormData]"`, so a
   * fixture that round-trips through it would test the wrong bytes and blame the
   * client for it.
   */
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(raw.url);
    const sent = init?.body ?? null;

    let body: Record<string, unknown> | undefined;
    let form: Record<string, string> | undefined;
    const files: string[] = [];

    if (sent instanceof FormData) {
      form = {};
      for (const [name, value] of sent) {
        if (typeof value === "string") form[name] = value;
        else files.push(value.name);
      }
    } else {
      const text = sent === null ? await raw.clone().text() : bodyText(sent);
      body = text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>);
    }

    calls.push({
      method: init?.method ?? raw.method,
      path: url.pathname,
      json: body,
      form,
      files,
    });

    const failure = options.failing?.[url.pathname];
    if (failure !== undefined) {
      return json({ code: "bad_request", message: "the server said no", issues: [] }, failure);
    }

    if (url.pathname === "/api/agents") {
      const lanes = (options.lanes ?? []).filter((row) => !released.has(row.lane));
      return json({ agents: [ORCHESTRATOR_ROW, ...lanes] } satisfies AgentRoster);
    }

    /*
     * The server's `assertRecipientResolvable` (SPEC.md §7): a `recipient` that
     * names no lane is a `422` and nothing is written. Modelled rather than
     * accepted, because a fixture that took a stale pick would let a suite
     * assert a routing the server would have refused (UI-118).
     *
     * The body comes from `serverRefusals.ts` rather than being written out here
     * (UI-120): this copy was a sentence of its own invention, and no assertion
     * noticed because they all match on `names no lane`.
     */
    const stated = (form ?? body) as { recipient?: unknown } | undefined;
    const lane = stated?.recipient;
    if (typeof lane === "string" && !isLane(lane)) {
      return json(unknownRecipientBody(lane), 422);
    }
    if (url.pathname === "/api/docs") {
      const items = options.rows ?? [];
      return json({ items, page: { total: items.length, limit: 50, offset: 0 } });
    }
    if (url.pathname.startsWith("/api/docs/")) {
      const id = url.pathname.slice("/api/docs/".length);
      const doc = options.docs?.[id];
      if (doc === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
      return json(doc);
    }
    if (url.pathname === "/api/capture") {
      return json({ docId: "doc_cap", threadId: "th_cap", eventId, warnings }, 201);
    }
    if (url.pathname === "/api/threads") {
      return json(
        {
          thread: {
            id: "th_new",
            title: "A question",
            parent: null,
            anchor: null,
            status: "open",
            tags: [],
            agent: "requested",
            turns: [],
            created: "2026-07-28T10:00:00Z",
            updated: "2026-07-28T10:00:00Z",
          },
          anchorId: null,
          eventId,
          warnings,
        },
        201,
      );
    }
    return json({});
  };

  return {
    fetch,
    calls,
    to: (path) => calls.filter((call) => call.path === path),
    releaseLane: (lane) => {
      released.add(lane);
    },
  };
}
