import { describe, expect, it, vi } from "vitest";
import { fakeEventSourceFactory } from "../testing/index.js";
import { createCorpusClient, CorpusRequestError, toQueryParams } from "./createCorpusClient.js";

/**
 * These assert the wire, not a stub: every call goes through the generated
 * client and out to an injected `fetch`, so a wrong path, verb or parameter is
 * a failure here rather than a 404 in the browser.
 */

interface Recorder {
  readonly requests: Request[];
  readonly fetch: typeof globalThis.fetch;
}

function recording(body: unknown = {}, status = 200): Recorder {
  const requests: Request[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { requests, fetch: fetch };
}

function client(recorder: Recorder) {
  return createCorpusClient({
    baseUrl: "http://127.0.0.1:8905",
    token: "s3cret",
    fetch: recorder.fetch,
  });
}

const urlOf = (recorder: Recorder): URL => new URL(recorder.requests[0]?.url ?? "");

describe("the operations map onto the contract's routes", () => {
  // TEST-39.
  it("reads the document collection from GET /api/docs", async () => {
    const recorder = recording({ items: [], page: {} });
    await client(recorder).listDocs({ q: "budget", type: "note", sort: "relevance" });
    const url = urlOf(recorder);
    expect(recorder.requests[0]?.method).toBe("GET");
    expect(url.pathname).toBe("/api/docs");
    expect(url.searchParams.get("q")).toBe("budget");
    expect(url.searchParams.get("type")).toBe("note");
    expect(url.searchParams.get("sort")).toBe("relevance");
  });

  it("joins array filters with the comma the query grammar uses", async () => {
    const recorder = recording({ items: [], page: {} });
    await client(recorder).listDocs({ tag: ["finance", "q3"], type: ["note", "view"] });
    const url = urlOf(recorder);
    expect(url.searchParams.get("tag")).toBe("finance,q3");
    expect(url.searchParams.get("type")).toBe("note,view");
  });

  it("forwards a filter the kit does not know about", async () => {
    const recorder = recording({ items: [], page: {} });
    // The contract may grow a parameter without a kit release; a kit that
    // allowlisted the grammar would silently drop it.
    await client(recorder).listDocs({ somethingNew: "yes" } as never);
    expect(urlOf(recorder).searchParams.get("somethingNew")).toBe("yes");
  });

  it("reads one document from GET /api/docs/{id}", async () => {
    const recorder = recording({ id: "doc_a" });
    await client(recorder).getDoc("doc_a");
    expect(urlOf(recorder).pathname).toBe("/api/docs/doc_a");
  });

  it("reads one thread from GET /api/threads/{id}", async () => {
    const recorder = recording({ id: "th_a", turns: [] });
    await client(recorder).getThread("th_a");
    expect(urlOf(recorder).pathname).toBe("/api/threads/th_a");
  });

  it("reads the folder tree from GET /api/tree", async () => {
    const recorder = recording({ folders: [] });
    await client(recorder).getTree();
    expect(urlOf(recorder).pathname).toBe("/api/tree");
  });

  it("reads job rows from GET /api/jobs", async () => {
    const recorder = recording({ jobs: [] });
    await client(recorder).listJobs({ recent: 25 });
    expect(urlOf(recorder).pathname).toBe("/api/jobs");
    expect(urlOf(recorder).searchParams.get("recent")).toBe("25");
  });

  it("reads locks from GET /api/locks", async () => {
    const recorder = recording({ locks: [] });
    await client(recorder).listLocks();
    expect(urlOf(recorder).pathname).toBe("/api/locks");
  });

  it("reads the probe from GET /api/health", async () => {
    const recorder = recording({ status: "ok", version: "0.0.0" });
    await client(recorder).getHealth();
    expect(urlOf(recorder).pathname).toBe("/api/health");
  });

  it("appends a turn with POST /api/threads/{id}/turns", async () => {
    const recorder = recording({ thread: {}, turn: {}, eventId: null, warnings: [] }, 201);
    await client(recorder).appendTurn("th_a", { body: "hello", requestsAgent: true });
    const request = recorder.requests[0];
    expect(request?.method).toBe("POST");
    expect(new URL(request?.url ?? "").pathname).toBe("/api/threads/th_a/turns");
    expect(await request?.json()).toEqual({ body: "hello", requestsAgent: true });
  });

  it("omits requestsAgent entirely when the caller said nothing", async () => {
    const recorder = recording({ thread: {}, turn: {}, eventId: null, warnings: [] }, 201);
    await client(recorder).appendTurn("th_a", { body: "hello" });
    expect(await recorder.requests[0]?.json()).toEqual({ body: "hello" });
  });

  /**
   * UI-020. Archiving is a route, not a `PUT {status}`: only the route runs the
   * server's folder move, and the inverse `PUT` is refused outright
   * (SERVER-039). Asserted on the wire because "which request went out" is the
   * entire content of the fix.
   */
  it.each([
    ["archiveDoc" as const, "/api/docs/doc_a/archive"],
    ["unarchiveDoc" as const, "/api/docs/doc_a/unarchive"],
  ])("%s POSTs to %s with the id in the path and no body", async (method, path) => {
    const recorder = recording({ doc: {}, warnings: [] });
    await client(recorder)[method]("doc_a");
    const request = recorder.requests[0];
    expect(request?.method).toBe("POST");
    expect(new URL(request?.url ?? "").pathname).toBe(path);
    expect(await request?.text()).toBe("");
  });

  it("authenticates every call with the configured bearer token", async () => {
    const recorder = recording({ folders: [] });
    await client(recorder).getTree();
    expect(recorder.requests[0]?.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("passes an abort signal through, so TanStack can cancel a query", async () => {
    const recorder = recording({ folders: [] });
    const controller = new AbortController();
    await client(recorder).getTree({ signal: controller.signal });
    expect(recorder.requests[0]?.signal).toBeDefined();
  });
});

describe("errors", () => {
  it("throws a typed error carrying the status and the contract's code", async () => {
    const recorder = recording({ code: "not_found", message: "no such document" }, 404);
    await expect(client(recorder).getDoc("doc_missing")).rejects.toBeInstanceOf(CorpusRequestError);
    await expect(client(recorder).getDoc("doc_missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      name: "CorpusRequestError",
    });
  });

  it("keeps validation issues so a caller can point at the offending field", async () => {
    const recorder = recording(
      { code: "bad_request", message: "bad", issues: [{ path: "query.sort", message: "nope" }] },
      400,
    );
    await expect(client(recorder).listDocs({})).rejects.toMatchObject({
      issues: [{ path: "query.sort", message: "nope" }],
    });
  });

  it("treats an empty success body as a failure rather than as data", async () => {
    const recorder = recording(null, 204);
    await expect(client(recorder).getHealth()).rejects.toThrow(/204/);
  });

  it("names the operation in the message", async () => {
    const recorder = recording({ code: "unauthorized", message: "no token" }, 401);
    await expect(client(recorder).listLocks()).rejects.toThrow(/GET \/api\/locks/);
  });
});

describe("the event stream", () => {
  it("targets /events on the configured origin with the token as a query parameter", () => {
    const recorder = recording();
    const factory = fakeEventSourceFactory();
    const stream = client(recorder).connectEvents({
      onInvalidate: () => undefined,
      onError: () => undefined,
      eventSourceFactory: factory,
    });
    expect(stream.url).toBe("http://127.0.0.1:8905/events?token=s3cret");
    expect(factory.sources).toHaveLength(1);
  });
});

describe("toQueryParams", () => {
  it("leaves scalars alone and joins arrays", () => {
    expect(toQueryParams({ q: "x", limit: 10, unread: true, tag: ["a", "b"] })).toEqual({
      q: "x",
      limit: 10,
      unread: true,
      tag: "a,b",
    });
  });

  it("is empty for an empty filter", () => {
    expect(toQueryParams({})).toEqual({});
  });
});
