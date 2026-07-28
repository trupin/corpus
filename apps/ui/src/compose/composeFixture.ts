/**
 * A recording transport for the composer's suites.
 *
 * Both of the composer's submits are multipart-capable, and one of them
 * (`POST /api/capture`) is multipart *always* — so unlike the board's fixture
 * this one never assumes a JSON body. It records the parsed form parts, which is
 * what the assertions are actually about: which field carried the text, whether
 * `requestsAgent` was the string `"true"`, and how many `files` parts there were.
 */

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
}

export interface ComposeTransportOptions {
  /** Paths that answer with an error status instead of a result. */
  readonly failing?: Readonly<Record<string, number>>;
  /** `eventId` the thread/capture results carry; `null` means nothing was enqueued. */
  readonly eventId?: string | null;
  readonly warnings?: readonly { readonly code: string; readonly detail: string }[];
  /** Rows for `GET /api/docs`, so the autocompletes have something to list. */
  readonly rows?: readonly unknown[];
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

    if (url.pathname === "/api/docs") {
      const items = options.rows ?? [];
      return json({ items, page: { total: items.length, limit: 50, offset: 0 } });
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

  return { fetch, calls, to: (path) => calls.filter((call) => call.path === path) };
}
