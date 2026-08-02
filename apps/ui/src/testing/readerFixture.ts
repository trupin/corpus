import type { Doc, DocRow, Lock, RelatedDoc, Thread, Warning } from "@corpus/contract";
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
  /** The parsed JSON body, or the raw text when it is not JSON. */
  readonly body: unknown;
  /** Multipart parts by field name; `files` collects every repeated file part. */
  readonly parts?: Readonly<Record<string, string>> | undefined;
  readonly files?: readonly string[] | undefined;
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
  /**
   * The ranked answer `GET /api/docs/{id}/related` gives, keyed by document id
   * (UI-025). A document with no entry gets an empty ranking — an empty list,
   * never an error, which is what the route returns for a document nothing
   * relates to.
   */
  readonly related?: Readonly<Record<string, readonly RelatedDoc[]>>;
  readonly locks?: readonly Lock[];
  /** `"<METHOD> <pathname>"` → status, for the failure paths. */
  readonly failing?: Readonly<Record<string, number>>;
  /**
   * Every non-`GET` request waits on this before it is answered.
   *
   * The teardown suites need a write that is genuinely in flight while the
   * surface that started it unmounts (UI-012's `holdWrites` gate, UI-015's
   * second application of it): resolve the promise after `cleanup()` and the
   * response lands on a component that is already gone.
   */
  readonly holdWrites?: Promise<void>;
  /**
   * Warnings `POST /api/threads` answers with (SPEC.md §14). A created thread
   * can succeed and still carry them — an unresolved `[[ref]]`, a skipped
   * commit — and they are the half of the outcome the user has to be told
   * about.
   */
  readonly threadWarnings?: readonly Warning[];
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
    // The body is deliberately withheld from `new Request`. These suites run in
    // jsdom, so a multipart body is jsdom's `FormData` while `Request` is
    // Node's undici — a foreign realm, which Node 22 (what CI runs) refuses to
    // construct a `Request` around even though Node 25 tolerates it. A caller
    // that built its own `Request` (`openapi-fetch` does) is used as-is; a
    // caller that passed a URL plus an `init` is read off the `init`.
    const request =
      input instanceof Request
        ? input
        : new Request(String(input), {
            method: init?.method ?? "GET",
            ...(init?.headers === undefined ? {} : { headers: init.headers }),
          });
    const url = new URL(request.url);
    const call = await recordCall(request, url, init);
    calls.push(call);

    // Recorded first, answered after: a held write has to be observable on the
    // wire while it is still outstanding, which is what the teardown suites
    // wait for before they unmount.
    if (options.holdWrites !== undefined && request.method !== "GET") await options.holdWrites;

    const failure = options.failing?.[`${request.method} ${url.pathname}`];
    if (failure !== undefined) {
      return json(
        failure === 413
          ? { code: "payload_too_large", message: "the upload is over the per-file limit" }
          : { code: "conflict", message: "the server refused" },
        failure,
      );
    }

    if (url.pathname.startsWith("/attachments/")) {
      return new Response("bytes", { status: 200, headers: { "content-type": "image/png" } });
    }

    if (url.pathname === "/api/locks") return json({ locks });
    if (url.pathname === "/api/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/tree") return json({ folders: [] });

    if (url.pathname === "/api/docs" && request.method === "GET") {
      const items = options.rows?.[url.search] ?? [];
      return json({ items, page: { total: items.length, limit: 50, offset: 0 } });
    }

    if (url.pathname.startsWith("/api/docs/")) {
      const rest = url.pathname.slice("/api/docs/".length);
      /*
       * `POST …/archive` and `POST …/unarchive` (SPEC.md §7): the routes that own
       * the transition, answered here as the server answers them — the document
       * back with its new `status`, so a reader that refetches sees the flip.
       */
      const [docId = "", verb] = rest.split("/");
      /*
       * `GET …/related` (SPEC.md §9.2), matched before the by-id read below —
       * otherwise `id` is `"doc_m/related"`, misses the map and 404s.
       */
      if (verb === "related") {
        return json({ related: options.related?.[docId] ?? [], semanticIndex: "current" });
      }
      if (verb === "archive" || verb === "unarchive") {
        const subject = docs.get(docId);
        if (subject === undefined) return json({ code: "not_found", message: `no ${docId}` }, 404);
        const flipped: Doc = {
          ...subject,
          frontmatter: {
            ...subject.frontmatter,
            status: verb === "archive" ? "archived" : "open",
          },
        };
        docs.set(docId, flipped);
        return json({ doc: flipped, warnings: [] });
      }
      const id = rest;
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
      const [rawId = "", verb, rawTs, subverb] = rest.split("/");
      const id = decodeURIComponent(rawId);
      if (verb === "seen") {
        return json({ threadId: id, lastSeenTs: "2026-07-02T09:00:00.000Z", unread: false });
      }
      if (verb === "resolve" || verb === "reopen") {
        return json({ thread: threadSummary(id, verb === "resolve"), warnings: [] });
      }
      const thread = threads.get(id);
      if (verb === "turns" && rawTs !== undefined && subverb === "form") {
        if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        const answer = call.body as { option: string; note?: string };
        const turn = {
          author: "user" as const,
          ts: nextTs(thread),
          body: `**Answered:** ${answer.option}`,
        };
        threads.set(id, { ...thread, turns: [...thread.turns, turn] });
        return json(
          {
            thread: threadSummary(id, thread.status === "resolved"),
            turn,
            eventId: "evt_form",
            warnings: [],
          },
          201,
        );
      }
      if (verb === "turns" && rawTs !== undefined && request.method === "DELETE") {
        if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        const ts = decodeURIComponent(rawTs);
        const remaining = thread.turns.filter((turn) => turn.ts !== ts);
        const deletedThread = remaining.length === 0;
        if (deletedThread) threads.delete(id);
        else threads.set(id, { ...thread, turns: remaining });
        return json({
          deletedTurn: true,
          deletedThread,
          removedAnchor: deletedThread ? thread.anchor : null,
          parentId: thread.parent,
          warnings: [],
        });
      }
      if (verb === "turns" && rawTs === undefined) {
        if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
        const text =
          call.parts?.["text"] ?? (call.body as { body?: string } | undefined)?.body ?? "";
        const references = (call.files ?? []).map(
          (name) => `[${name}](attachments/${id}/t/${name})`,
        );
        const turn = {
          author: "user" as const,
          ts: nextTs(thread),
          body: [text, references.join("\n")].filter((part) => part !== "").join("\n\n"),
        };
        threads.set(id, { ...thread, turns: [...thread.turns, turn] });
        return json(
          {
            thread: threadSummary(id, thread.status === "resolved"),
            turn,
            eventId: null,
            warnings: [],
          },
          201,
        );
      }
      if (thread === undefined) return json({ code: "not_found", message: `no ${id}` }, 404);
      return json(thread);
    }

    if (url.pathname === "/api/threads" && request.method === "POST") {
      const created = threadFixture({ id: `th_child_${String(threads.size)}` });
      threads.set(created.id, created);
      return json(
        {
          thread: created,
          anchorId: "a_1",
          eventId: null,
          warnings: options.threadWarnings ?? [],
        },
        201,
      );
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

/**
 * Reads a request's body without assuming JSON: the multipart turn/thread routes
 * send `FormData`, and a fixture that blindly `JSON.parse`d would throw on
 * exactly the attachment paths it exists to exercise.
 */
async function recordCall(request: Request, url: URL, init?: RequestInit): Promise<ReaderCall> {
  const base = { method: request.method, path: url.pathname, search: url.search };
  const contentType = request.headers.get("content-type") ?? "";
  // The `init` is read first because jsdom's `FormData` and Node's `Request`
  // are different realms: a multipart body survives on the init but its
  // content-type header does not survive the `Request` construction. The same
  // environment defect `canForwardAbortSignal` documents in the kit's client.
  const form =
    init?.body instanceof FormData
      ? init.body
      : contentType.startsWith("multipart/form-data")
        ? await request.formData()
        : undefined;
  if (form !== undefined) {
    const parts: Record<string, string> = {};
    const files: string[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") parts[key] = value;
      else files.push(value.name);
    }
    return { ...base, body: undefined, parts, files };
  }
  // A string body only ever reaches the fixture on the `init`; a `Request` the
  // caller built is the only thing this may read a body off (see the realm note
  // in `readerTransport`).
  const raw = typeof init?.body === "string" ? init.body : await request.text().catch(() => "");
  if (raw === "") return { ...base, body: undefined };
  try {
    return { ...base, body: JSON.parse(raw) as unknown };
  } catch {
    return { ...base, body: raw };
  }
}

/** A timestamp strictly after every turn the thread already holds (SPEC.md §6). */
function nextTs(thread: Thread): string {
  const last = thread.turns.at(-1)?.ts;
  const at = last === undefined ? Date.now() : new Date(last).getTime() + 60_000;
  return new Date(at).toISOString();
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

/** The related read a reader issues for the document it has open. */
export function relatedPath(docId: string): string {
  return `/api/docs/${docId}/related`;
}

/** A related row, for the ranking the panel renders (SPEC.md §11). */
export function relatedFixture(overrides: Partial<RelatedDoc> = {}): RelatedDoc {
  return {
    id: "doc_related",
    title: "A related document",
    excerpt: "One line, never a body.",
    relation: "linked",
    ...overrides,
  };
}
