import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createCorpusClient } from "../client/index.js";
import { DocEditedPayloadSchema, type DocEditedPayload } from "../schemas/edit.js";
import { contractRoutes } from "./index.js";

/**
 * `POST /api/docs/{id}/edit-session/flush` (CONTRACT-031) exercised through the
 * real route definition and the generated typed client.
 *
 * The handler is canned, but the session bookkeeping behind it is not: the stub
 * below reproduces `EditSessionTracker`'s one structural rule — a session is
 * removed from the map before it is emitted, so whichever end path reaches it
 * first is the only one that can — because every property this route promises
 * (idempotence, one event per `sessionId`, the two paths converging) is a
 * consequence of that rule rather than of anything the handler does. A stub that
 * merely returned `204` would prove the status code and nothing else.
 */

const BASE_URL = "http://127.0.0.1:8765";

const OPEN = "doc_a1b2c3";
/** A document the workspace has, with nobody editing it. */
const IDLE_DOC = "doc_quiet1";
/** A document that does not exist — the only thing a `404` on this route means. */
const MISSING = "doc_gone99";

const KNOWN_DOCUMENTS = new Set([OPEN, IDLE_DOC]);

const BASE_SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const HEAD_SHA = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456";

interface OpenSession {
  readonly id: string;
  readonly docId: string;
}

/**
 * The half of SERVER-052's tracker this route depends on. `end` deletes before
 * it emits, which is the whole mechanism: a second trigger — a duplicated
 * unload, or the inactivity timer arriving behind the flush — finds no session
 * and therefore cannot produce a second event.
 */
function createTracker() {
  const sessions = new Map<string, OpenSession>();
  const emitted: DocEditedPayload[] = [];
  let counter = 0;

  const end = (session: OpenSession, endedBy: "close" | "idle"): void => {
    sessions.delete(session.id);
    emitted.push(
      DocEditedPayloadSchema.parse({
        docId: session.docId,
        sessionId: session.id,
        actor: "user",
        endedBy,
        from: BASE_SHA,
        to: HEAD_SHA,
        stats: { commits: 1, insertions: 12, deletions: 3 },
      }),
    );
  };

  const endEvery = (docId: string, endedBy: "close" | "idle"): void => {
    for (const session of [...sessions.values()]) {
      if (session.docId === docId) end(session, endedBy);
    }
  };

  return {
    emitted,
    open(docId: string): string {
      counter += 1;
      const session = { id: `es_${String(counter).padStart(4, "0")}`, docId };
      sessions.set(session.id, session);
      return session.id;
    },
    flush: (docId: string) => endEvery(docId, "close"),
    sweepIdle: (docId: string) => endEvery(docId, "idle"),
    isOpen: (docId: string) => [...sessions.values()].some((s) => s.docId === docId),
  };
}

type Tracker = ReturnType<typeof createTracker>;

/** Mirrors the server's own `defaultHook`, so a rejection renders as `ValidationError`. */
function createApp(tracker: Tracker): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) =>
      result.success
        ? undefined
        : c.json(
            {
              code: "bad_request" as const,
              message: "request failed validation",
              issues: result.error.issues.map((issue) => ({
                path: [result.target, ...issue.path.map(String)].join("."),
                message: issue.message,
              })),
            },
            400,
          ),
  });

  app.openapi(contractRoutes.flushEditSession, (c) => {
    const { id } = c.req.valid("param");
    if (!KNOWN_DOCUMENTS.has(id)) {
      return c.json({ code: "not_found" as const, message: `No document \`${id}\`.` }, 404);
    }
    // Unconditional: the handler never asks whether a session was open, because
    // the answer is not the caller's business and the route publishes only the
    // postcondition.
    tracker.flush(id);
    return c.body(null, 204);
  });

  return app;
}

function createHarness(options: { readonly fetchSpy?: (request: Request) => void } = {}) {
  const tracker = createTracker();
  const app = createApp(tracker);
  const client = createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      options.fetchSpy?.(request);
      return app.fetch(request);
    },
  });
  // Exactly what `openapi-fetch` forwards to `fetch`, which is the surface
  // UI-044 needs: a `keepalive` the client passes straight through.
  const flush = (id: string, init: Omit<RequestInit, "body" | "headers"> = {}) =>
    client.api.POST("/api/docs/{id}/edit-session/flush", {
      params: { path: { id } },
      ...init,
    });
  return { tracker, app, client, flush };
}

describe("the edit-session flush route (CONTRACT-031)", () => {
  it("is the call SPEC.md §4's close path needs: it ends the session and answers 204", async () => {
    const { tracker, flush } = createHarness();
    const sessionId = tracker.open(OPEN);

    const { response, error } = await flush(OPEN);

    expect(error).toBeUndefined();
    expect(response.status).toBe(204);
    expect(tracker.isOpen(OPEN)).toBe(false);
    expect(tracker.emitted.map((event) => event.sessionId)).toEqual([sessionId]);
  });

  it("names the flush as the trigger that ended the session", async () => {
    const { tracker, flush } = createHarness();
    tracker.open(OPEN);

    await flush(OPEN);

    expect(tracker.emitted[0]?.endedBy).toBe("close");
    expect(tracker.emitted[0]?.actor).toBe("user");
    expect(tracker.emitted[0]?.docId).toBe(OPEN);
  });

  it("carries no request body — the document id is the whole of the request", async () => {
    const requests: Request[] = [];
    const { tracker, flush } = createHarness({ fetchSpy: (request) => requests.push(request) });
    tracker.open(OPEN);

    await flush(OPEN);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("content-type")).toBeNull();
    expect(await requests[0]?.text()).toBe("");
  });

  it("answers with no body at all, so there is nothing to branch on", async () => {
    const { tracker, app } = createHarness();
    tracker.open(OPEN);

    const response = await app.request(`/api/docs/${OPEN}/edit-session/flush`, { method: "POST" });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});

/**
 * The property UI-044 depends on. A reader-close path fires on `pagehide` and on
 * `visibilitychange`, and a duplicate is far likelier than a miss — so every one
 * of these has to be a legal, quiet call.
 */
describe("idempotence", () => {
  it("answers 204 to a repeated flush and emits no second event", async () => {
    const { tracker, flush } = createHarness();
    const sessionId = tracker.open(OPEN);

    const first = await flush(OPEN);
    const second = await flush(OPEN);
    const third = await flush(OPEN);

    expect([first.response.status, second.response.status, third.response.status]).toEqual([
      204, 204, 204,
    ]);
    // CONTRACT-028's published invariant: at most one `doc.edited` per session id.
    expect(tracker.emitted.map((event) => event.sessionId)).toEqual([sessionId]);
  });

  it("answers 204 for a document that never had a session — a no-op, not a 404", async () => {
    const { tracker, flush } = createHarness();

    const { response, error } = await flush(IDLE_DOC);

    expect(error).toBeUndefined();
    expect(response.status).toBe(204);
    expect(tracker.emitted).toEqual([]);
  });

  /**
   * The convergence the contract promises: both of §4's ends reach one session
   * object, and whichever gets there first removes it. A flush arriving after
   * the inactivity window has already elapsed is therefore not a duplicate event
   * — it is nothing at all.
   */
  it("emits nothing when the inactivity window already ended the session", async () => {
    const { tracker, flush } = createHarness();
    const sessionId = tracker.open(OPEN);
    tracker.sweepIdle(OPEN);

    const { response } = await flush(OPEN);

    expect(response.status).toBe(204);
    expect(tracker.emitted).toHaveLength(1);
    expect(tracker.emitted[0]).toMatchObject({ sessionId, endedBy: "idle" });
  });

  /** A later sitting at the same document is a *different* session, and does emit. */
  it("still ends a session opened after an earlier flush", async () => {
    const { tracker, flush } = createHarness();
    const first = tracker.open(OPEN);
    await flush(OPEN);
    const second = tracker.open(OPEN);
    await flush(OPEN);

    expect(tracker.emitted.map((event) => event.sessionId)).toEqual([first, second]);
    expect(new Set(tracker.emitted.map((event) => event.sessionId)).size).toBe(2);
  });
});

/**
 * The unload-path answer, decided here rather than left for UI-044 to discover.
 * `keepalive` is the supported spelling because it is the one that can carry the
 * bearer token; `sendBeacon` cannot set request headers at all.
 */
describe("reachability from a page-unload path", () => {
  it("accepts `keepalive` through the generated client and forwards it to fetch", async () => {
    const requests: Request[] = [];
    const { tracker, flush } = createHarness({ fetchSpy: (request) => requests.push(request) });
    tracker.open(OPEN);

    const { response, error } = await flush(OPEN, { keepalive: true });

    expect(error).toBeUndefined();
    expect(response.status).toBe(204);
    expect(requests[0]?.keepalive).toBe(true);
    expect(tracker.isOpen(OPEN)).toBe(false);
  });

  /**
   * Why `sendBeacon` is out, in the one term that decides it: the route is
   * authenticated, and a beacon sends no headers. The method and the empty body
   * would both have suited it.
   */
  it("is a bearer-guarded POST, which is what rules `sendBeacon` out", async () => {
    const requests: Request[] = [];
    const { tracker, flush } = createHarness({ fetchSpy: (request) => requests.push(request) });
    tracker.open(OPEN);

    await flush(OPEN);

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer workspace-token");
    expect(contractRoutes.flushEditSession.method).toBe("post");
    expect(contractRoutes.flushEditSession.responses[401]).toBeDefined();
  });
});

describe("the only 404 is a document the workspace does not have", () => {
  it("answers 404 in the shared envelope for an unknown document", async () => {
    const { flush } = createHarness();

    const { error, response } = await flush(MISSING);

    expect(response.status).toBe(404);
    expect(error).toEqual({ code: "not_found", message: `No document \`${MISSING}\`.` });
  });

  it("validates the document id in the path before any handler runs", async () => {
    const { app } = createHarness();

    const response = await app.request("/api/docs/not-an-id/edit-session/flush", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const rejection = (await response.json()) as { code: string; issues?: { path: string }[] };
    expect(rejection.code).toBe("bad_request");
    expect(rejection.issues?.[0]?.path).toBe("param.id");
  });

  /**
   * The static segment sits one below `/api/docs/{id}`, where `move`, `archive`
   * and `unarchive` already are, so nothing competes with the parameter — but
   * the failure mode of getting that wrong is silent misrouting, so it is
   * asserted with a real request rather than reasoned about.
   */
  it("routes to the flush rather than to a document named `edit-session`", async () => {
    const { tracker, app } = createHarness();
    tracker.open(OPEN);

    const response = await app.request(`/api/docs/${OPEN}/edit-session/flush`, { method: "POST" });

    expect(response.status).toBe(204);
    expect(tracker.emitted).toHaveLength(1);
  });
});
