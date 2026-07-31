import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { contractRoutes, mountAppendTurn } from "../routes/index.js";
import * as client from "./index.js";
import { createCorpusClient, isApiError, type FetchPaths, type paths } from "./index.js";

const BASE_URL = "http://127.0.0.1:8765";
const TOKEN = "workspace-token";

const frontmatter = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  tags: ["finance"],
  status: "open" as const,
  anchors: {},
  due: null,
  reviewed: null,
  evergreen: false,
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
};

/**
 * A Hono app mounting the real contract definitions. The client is exercised
 * against it over `app.fetch`, so requests travel the same validation path the
 * server will use — no hand-rolled fetch double.
 */
function createServer() {
  const app = new OpenAPIHono();

  app.openapi(contractRoutes.getDoc, (c) => {
    const { id } = c.req.valid("param");
    if (id !== frontmatter.id) {
      return c.json({ code: "not_found" as const, message: `No document ${id}.` }, 404);
    }
    return c.json(
      {
        frontmatter,
        // The handler echoes the credentials so the test can assert what the
        // client actually put on the wire.
        body: `auth=${c.req.header("authorization") ?? ""} actor=${c.req.header(ACTOR_HEADER) ?? ""}`,
        path: "data/docs/mortgage.md",
        anchors: [],
      },
      200,
    );
  });

  app.openapi(contractRoutes.updateDoc, (c) => {
    const actor = c.req.valid("header")[ACTOR_HEADER];
    return c.json(
      {
        doc: {
          frontmatter,
          body: `saved by ${actor}`,
          path: "data/docs/mortgage.md",
          anchors: [],
        },
        anchors: { remapped: [], orphaned: [] },
        warnings: [],
      },
      200,
    );
  });

  app.openapi(contractRoutes.listDocs, (c) => {
    const { limit, offset, q } = c.req.valid("query");
    return c.json(
      {
        items: [
          {
            id: frontmatter.id,
            type: frontmatter.type,
            title: frontmatter.title,
            path: "data/docs/mortgage.md",
            status: frontmatter.status,
            tags: frontmatter.tags,
            created: frontmatter.created,
            updated: frontmatter.updated,
            due: null,
            reviewed: null,
            evergreen: false,
            excerpt: "Body.",
            pinned: false,
            order: null,
            query: null,
            column: null,
            extra: {},
            stale: "aging" as const,
            parent: null,
            parentTitle: null,
            agent: null,
            anchorQuote: null,
            turnCount: null,
            lastAuthor: null,
            lastTurn: null,
            unread: null,
            awaitingAgent: null,
            unreadThreads: 0,
            attention: ["unread-reply" as const, "stale" as const],
            snippets:
              q === undefined
                ? []
                : [{ field: "title" as const, segments: [{ text: q, match: true }] }],
          },
        ],
        page: { total: 1, limit, offset },
      },
      200,
    );
  });

  /** The long-poll timeout: a declared `204`, which must not read as a failure. */
  app.openapi(contractRoutes.idleQueue, (c) => c.body(null, 204));

  app.openapi(contractRoutes.rebuildDb, (c) =>
    c.json(
      {
        path: "/w/.corpus/cache.db",
        documents: 1,
        threads: 0,
        turns: 0,
        anchors: 0,
        links: 0,
        events: 0,
        jobs: 0,
        locks: 0,
        seen: 0,
        durationMs: 12,
        skipped: [],
      },
      200,
    ),
  );

  app.openapi(contractRoutes.doctorDb, (c) =>
    c.json(
      {
        ok: false,
        drift: [
          {
            kind: "count_mismatch" as const,
            path: null,
            detail:
              ".corpus/queue holds 2 evt_*.json file(s) but the projection has 1 event row(s)",
          },
        ],
        stats: { files: 1, documents: 1, hashed: 0, parsed: 0, durationMs: 3 },
      },
      200,
    ),
  );

  app.openapi(contractRoutes.haltQueue, (c) => {
    // The halt body is optional in full, so validation yields `{}` for a bare
    // POST. `pending` carries the reason's length back out — the status shape
    // has nowhere to echo a string, and the length is enough to prove the exact
    // text survived the wire.
    const { reason } = c.req.valid("json");
    return c.json(
      {
        halted: true,
        pending: reason?.length ?? 0,
        inProgress: 0,
        deferred: 0,
        processed: 0,
        failed: 0,
        abandoned: 0,
      },
      200,
    );
  });

  mountAppendTurn(app, (c) => {
    const validated = c.req.valid("form");
    const attached = "files" in validated ? validated.files.length : 0;
    return c.json(
      {
        thread: {
          id: "th_x9y8",
          title: "Re: rates",
          status: "open" as const,
          parent: frontmatter.id,
          anchor: null,
          agent: "engaged" as const,
          created: "2026-07-19T10:05:00Z",
          updated: "2026-07-19T10:09:00Z",
          turnCount: 2,
          lastAuthor: "user" as const,
          lastTs: "2026-07-19T10:09:00Z",
        },
        turn: {
          author: "user" as const,
          ts: "2026-07-19T10:09:00Z",
          body: `files=${String(attached)} actor=${c.req.header(ACTOR_HEADER) ?? ""}`,
        },
        eventId: null,
        warnings: [],
      },
      201,
    );
  });

  app.openapi(contractRoutes.capture, (c) =>
    c.json(
      {
        docId: "doc_a1b2c3",
        threadId: "th_x9y8",
        eventId: c.req.valid("form").requestsAgent === false ? null : "evt_7c1d",
        // A capture writes a document, a thread and the parent's frontmatter, so
        // §14's warnings ride back with it like any other mutation.
        warnings: [{ code: "commit_skipped" as const, detail: "no `git` on PATH" }],
      },
      201,
    ),
  );

  app.openapi(contractRoutes.searchCorpus, (c) => {
    const { q, limit, type, includeArchived } = c.req.valid("query");
    return c.json(
      {
        hits: [
          {
            id: frontmatter.id,
            title: frontmatter.title,
            headingPath: `${frontmatter.title} › Rates`,
            // The handler echoes the parsed query so the test can assert what
            // the typed client actually put on the wire.
            snippet: `${q}|limit=${String(limit)}|type=${type ?? "any"}|archived=${String(
              includeArchived ?? false,
            )}`,
          },
        ],
      },
      200,
    );
  });

  app.openapi(contractRoutes.relatedDocs, (c) => {
    const { id } = c.req.valid("param");
    if (id !== frontmatter.id) {
      return c.json({ code: "not_found" as const, message: `No document ${id}.` }, 404);
    }
    const { limit, includeArchived } = c.req.valid("query");
    return c.json(
      {
        related: [
          {
            id: "doc_b2c3d4",
            title: "Lender comparison",
            excerpt: `limit=${String(limit)}|archived=${String(includeArchived ?? false)}`,
            relation: "linked" as const,
          },
        ],
        semanticIndex: "current" as const,
      },
      200,
    );
  });

  return app;
}

function createTestClient(actor?: "user" | "agent") {
  const app = createServer();
  return createCorpusClient({
    baseUrl: BASE_URL,
    token: TOKEN,
    ...(actor ? { actor } : {}),
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
}

describe("createCorpusClient", () => {
  it("exposes the base URL it was configured with", () => {
    expect(createTestClient().baseUrl).toBe(BASE_URL);
  });

  it("injects the workspace bearer token on every call", async () => {
    const client = createTestClient();
    const { data } = await client.api.GET("/api/docs/{id}", {
      params: { path: { id: "doc_a1b2c3" } },
    });
    expect(data?.body).toContain(`auth=Bearer ${TOKEN}`);
  });

  it("attributes requests to the user by default", async () => {
    const { data } = await createTestClient().api.GET("/api/docs/{id}", {
      params: { path: { id: "doc_a1b2c3" } },
    });
    expect(data?.body).toContain("actor=user");
  });

  it("attributes requests to the configured acting party", async () => {
    const { data } = await createTestClient("agent").api.GET("/api/docs/{id}", {
      params: { path: { id: "doc_a1b2c3" } },
    });
    expect(data?.body).toContain("actor=agent");
  });

  it("lets a single call override the acting party", async () => {
    const { data } = await createTestClient("user").api.PUT("/api/docs/{id}", {
      params: { path: { id: "doc_a1b2c3" }, header: { [ACTOR_HEADER]: "agent" } },
      body: { body: "new body" },
    });
    expect(data?.doc.body).toBe("saved by agent");
  });

  it("surfaces a declared error response as typed data, not a thrown exception", async () => {
    const { data, error, response } = await createTestClient().api.GET("/api/docs/{id}", {
      params: { path: { id: "doc_missing1" } },
    });
    expect(data).toBeUndefined();
    expect(response.status).toBe(404);
    expect(error?.code).toBe("not_found");
    expect(isApiError(error)).toBe(true);
  });

  it("builds the SSE stream against the same base URL and token", () => {
    const stream = createTestClient().connectEvents({
      onInvalidate: () => undefined,
      eventSourceFactory: () => ({ addEventListener: () => undefined, close: () => undefined }),
    });
    expect(stream.url).toBe(`${BASE_URL}/events?token=${TOKEN}`);
  });

  it("falls back to the runtime's fetch when none is injected", () => {
    expect(() => createCorpusClient({ baseUrl: BASE_URL, token: TOKEN })).not.toThrow();
  });
});

describe("the typed collection query", () => {
  it("returns rows whose attention reasons and snippets are typed", async () => {
    const { data } = await createTestClient().api.GET("/api/docs", {
      params: { query: { needs: "me", stale: "stale", sort: "-updated", q: "mortgage" } },
    });
    const row = data?.items[0];
    expect(row?.attention).toEqual(["unread-reply", "stale"]);
    expect(row?.snippets[0]?.segments[0]).toEqual({ text: "mortgage", match: true });
  });

  it("returns no snippets when the query carried no full-text term", async () => {
    const { data } = await createTestClient().api.GET("/api/docs", {
      params: { query: { folder: "finance" } },
    });
    expect(data?.items[0]?.snippets).toEqual([]);
  });

  /**
   * CONTRACT-012. `unreadThreads` is a plain `number` on the generated type —
   * not `number | null` and not optional — so a consumer renders the pill from
   * the row it already has, with no per-row thread query and no null check.
   */
  it("types the unread aggregate as a required number, so the pill needs no fallback", async () => {
    const { data } = await createTestClient().api.GET("/api/docs", {
      params: { query: { folder: "finance" } },
    });
    const count: number | undefined = data?.items[0]?.unreadThreads;
    expect(count).toBe(0);
  });

  /** The rider's parameter has to exist on the generated client, not only in the schema. */
  it("accepts includeArchived on the typed query", async () => {
    const { data, error } = await createTestClient().api.GET("/api/docs", {
      params: { query: { includeArchived: true, sort: "-updated" } },
    });
    expect(error).toBeUndefined();
    expect(data?.items).toHaveLength(1);
  });
});

/**
 * CONTRACT-022. Both retrieval verbs reach the agent through this client and
 * nothing else (SPEC.md §2.2 rule 4), so the generated types are the contract
 * `corpus search` and `corpus doc related` compile against — including the
 * absences: a hit has no body to read, and the search query has no `sort`,
 * `offset` or `pinned` to pass.
 */
describe("the typed retrieval calls", () => {
  it("searches with the query and the shared filters, and gets frugal hits back", async () => {
    const { data, error } = await createTestClient().api.GET("/api/search", {
      params: { query: { q: "rates", limit: 3, type: "note", includeArchived: true } },
    });
    expect(error).toBeUndefined();
    const hit = data?.hits[0];
    expect(hit?.snippet).toBe("rates|limit=3|type=note|archived=true");
    expect(hit?.headingPath).toBe("Mortgage options › Rates");
    expect(Object.keys(hit ?? {})).toEqual(["id", "title", "headingPath", "snippet"]);
  });

  it("defaults the cap when the call passes only a query", async () => {
    const { data } = await createTestClient().api.GET("/api/search", {
      params: { query: { q: "rates" } },
    });
    expect(data?.hits[0]?.snippet).toBe("rates|limit=10|type=any|archived=false");
    expect(data?.semanticIndex).toBeUndefined();
  });

  it("expands from a known document through the path parameter", async () => {
    const { data, error } = await createTestClient().api.GET("/api/docs/{id}/related", {
      params: { path: { id: "doc_a1b2c3" }, query: { includeArchived: true } },
    });
    expect(error).toBeUndefined();
    expect(data?.related[0]).toEqual({
      id: "doc_b2c3d4",
      title: "Lender comparison",
      excerpt: "limit=10|archived=true",
      relation: "linked",
    });
    expect(data?.semanticIndex).toBe("current");
  });

  it("surfaces an unknown document as the shipped typed 404", async () => {
    const { data, error } = await createTestClient().api.GET("/api/docs/{id}/related", {
      params: { path: { id: "doc_nope" }, query: {} },
    });
    expect(data).toBeUndefined();
    expect(isApiError(error)).toBe(true);
    expect(error?.code).toBe("not_found");
  });
});

/**
 * The long-poll timeout is a normal outcome, not a failure: the skill loop
 * re-invokes on it. A client that surfaced it as an error would turn parking
 * into an error storm.
 */
describe("the long-poll idle endpoint", () => {
  it("surfaces a 204 as no data and no error, without throwing", async () => {
    const { data, error, response } = await createTestClient().api.GET("/api/queue/idle", {
      params: { query: {} },
    });
    expect(response.status).toBe(204);
    expect(data).toBeUndefined();
    expect(error).toBeUndefined();
  });
});

/**
 * The projection-maintenance pair behind `corpus db rebuild` / `corpus db
 * doctor` (SPEC.md §2.2, §14). Rebuild is the one `POST` in the surface that
 * takes no body at all, so the typed client must be able to call it with nothing
 * but a path — a generated `requestBody` would be a contract bug here.
 */
describe("the projection maintenance calls", () => {
  // Compile-time assertion: giving rebuild a body would break this, not a run.
  type RebuildOperation = paths["/api/db/rebuild"]["post"];
  type RebuildTakesNoBody = RebuildOperation extends { requestBody?: undefined } ? true : never;

  it("types the rebuild call as taking no request body", () => {
    const bodiless: RebuildTakesNoBody = true;
    expect(bodiless).toBe(true);
  });

  it("rebuilds on a bare call and returns the typed per-table counts", async () => {
    const { data, error } = await createTestClient("agent").api.POST("/api/db/rebuild");

    expect(error).toBeUndefined();
    expect(data?.documents).toBe(1);
    expect(data?.durationMs).toBe(12);
    expect(data?.skipped).toEqual([]);
  });

  it("returns a drifted doctor report as typed data rather than an error", async () => {
    const { data, error, response } = await createTestClient().api.GET("/api/db/doctor");

    expect(response.status).toBe(200);
    expect(error).toBeUndefined();
    expect(data?.ok).toBe(false);
    expect(data?.drift[0]?.kind).toBe("count_mismatch");
    expect(data?.drift[0]?.path).toBeNull();
    expect(data?.stats.hashed).toBe(0);
  });
});

/**
 * Halting is a kill switch first and an annotation second: `corpus queue halt`
 * with no argument, and the console strip's HALT toggle, both send a bare POST.
 * So the typed client must accept the call with no `body` at all — an optional
 * request body that the generated types made mandatory would break the primary
 * caller to serve the secondary one.
 */
describe("the optional halt body", () => {
  // Compile-time assertion: were the body to become required, `undefined` would
  // stop being assignable and this would fail `tsc --noEmit`, not a test run.
  type HaltRequestBody = paths["/api/queue/halt"]["post"]["requestBody"];
  type HaltBodyIsOmittable = undefined extends HaltRequestBody ? true : never;

  it("types the request body as omittable", () => {
    const omittable: HaltBodyIsOmittable = true;
    expect(omittable).toBe(true);
  });

  it("halts on a bare call that passes no body", async () => {
    const { data, error } = await createTestClient().api.POST("/api/queue/halt");

    expect(error).toBeUndefined();
    expect(data).toMatchObject({ halted: true, pending: 0 });
  });

  it("halts on a call that passes an empty body object", async () => {
    const { data, error } = await createTestClient().api.POST("/api/queue/halt", { body: {} });

    expect(error).toBeUndefined();
    expect(data?.halted).toBe(true);
  });

  it("carries a halt reason through to the handler", async () => {
    const { data, error } = await createTestClient("agent").api.POST("/api/queue/halt", {
      body: { reason: "deploying" },
    });

    expect(error).toBeUndefined();
    expect(data?.pending).toBe("deploying".length);
  });

  /**
   * The 400 body is the server's to shape (`apps/server` installs the
   * `defaultHook` that renders a `ValidationError`); what the contract owns, and
   * what this asserts, is that validation rejects the call at all.
   */
  it("rejects a blank reason rather than recording an empty annotation", async () => {
    const { data, response } = await createTestClient().api.POST("/api/queue/halt", {
      body: { reason: "" },
    });

    expect(response.status).toBe(400);
    expect(data).toBeUndefined();
  });
});

describe("the multipart helpers on the client", () => {
  it("posts a turn's attachments through the configured credentials", async () => {
    const response = await createTestClient("agent").uploadTurn({
      threadId: "th_x9y8",
      text: "look",
      files: [new File(["bytes"], "shot.png", { type: "image/png" })],
    });
    expect(response.turn.body).toBe("files=1 actor=agent");
  });

  it("captures text as an inbox document plus its filing thread", async () => {
    const result = await createTestClient().capture({ text: "a thought" });
    expect(result).toEqual({
      docId: "doc_a1b2c3",
      threadId: "th_x9y8",
      eventId: "evt_7c1d",
      warnings: [{ code: "commit_skipped", detail: "no `git` on PATH" }],
    });
  });

  it('carries an explicit "note only" capture through to a null event', async () => {
    const result = await createTestClient().capture({ text: "a thought", requestsAgent: false });
    expect(result.eventId).toBeNull();
  });
});

/**
 * `@corpus/contract`'s `exports` map publishes exactly two entry points — `.`
 * and `./client` — so anything a consumer cannot reach through this barrel it
 * cannot reach at all. All three multipart endpoints are therefore pinned here,
 * including `uploadCreateThread`, which the kit needs to attach a file to a
 * *new* thread and which the barrel silently omitted (CONTRACT-013).
 */
describe("the client barrel", () => {
  it.each([
    "uploadTurn",
    "uploadCreateThread",
    "uploadCapture",
    "buildTurnFormData",
    "buildThreadFormData",
    "buildCaptureFormData",
    "UploadError",
    "FILES_FIELD",
    "createCorpusClient",
    "createEventStream",
    "eventStreamUrl",
    "isApiError",
  ])("exports %s", (name) => {
    expect(client).toHaveProperty(name);
  });

  /**
   * Compile-time: the upload payload types travel with their functions, so a
   * consumer can name the argument it builds. Dropping one from the barrel is a
   * typecheck failure here rather than a deep import at the call site.
   */
  it("exports the upload payload types beside their functions", () => {
    const thread: client.ThreadUpload = { title: "New thread", text: "look at this" };
    const turn: client.TurnUpload = { threadId: "th_x9y8", text: "look" };
    const capture: client.CaptureUpload = { text: "a thought" };
    const options: client.UploadOptions = { baseUrl: BASE_URL, token: TOKEN };
    expect([thread.title, turn.threadId, capture.text, options.baseUrl]).toEqual([
      "New thread",
      "th_x9y8",
      "a thought",
      BASE_URL,
    ]);
  });

  it("builds the multipart body of a thread creation with attachments", () => {
    const form = client.buildThreadFormData({
      title: "New thread",
      text: "look at this",
      files: [new File(["bytes"], "shot.png", { type: "image/png" })],
    });
    expect(form.get("title")).toBe("New thread");
    expect(form.getAll(client.FILES_FIELD)).toHaveLength(1);
  });
});

/**
 * `/events` is documented in the contract and present in the generated types,
 * but excluded from the fetch surface on purpose: `openapi-typescript` can only
 * describe an SSE body as a string, so a `GET("/events")` method would hand
 * callers a response they must not read that way.
 */
describe("the SSE stream is not part of the fetch surface", () => {
  // Compile-time assertions: reintroducing `/events` into the fetch surface, or
  // dropping it from the generated types, is a typecheck failure here rather
  // than a runtime surprise for a consumer.
  type EventsDocumented = "/events" extends keyof paths ? true : never;
  type EventsNotFetchable = "/events" extends keyof FetchPaths ? never : true;

  it("keeps /events in the generated document but out of the fetch client", () => {
    const documented: EventsDocumented = true;
    const notFetchable: EventsNotFetchable = true;
    expect([documented, notFetchable]).toEqual([true, true]);
  });

  it("reaches the stream through connectEvents instead", () => {
    const stream = createTestClient().connectEvents({
      onInvalidate: () => undefined,
      eventSourceFactory: () => ({ addEventListener: () => undefined, close: () => undefined }),
    });
    expect(stream.url).toContain("/events?token=");
  });
});

/**
 * Attachment bytes are the second non-fetch surface: the route answers
 * `application/octet-stream`, which `openapi-fetch` would run through
 * `JSON.parse` for every image and download. The URL belongs in `<img src>` and
 * download links instead.
 */
describe("attachment bytes are not part of the fetch surface", () => {
  type AttachmentsDocumented = "/attachments/{path}" extends keyof paths ? true : never;
  type AttachmentsNotFetchable = "/attachments/{path}" extends keyof FetchPaths ? never : true;

  it("keeps /attachments/{path} in the generated document but out of the fetch client", () => {
    const documented: AttachmentsDocumented = true;
    const notFetchable: AttachmentsNotFetchable = true;
    expect([documented, notFetchable]).toEqual([true, true]);
  });
});
