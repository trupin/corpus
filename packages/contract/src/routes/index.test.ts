import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { CONTRACT_VERSION } from "../openapi.js";
import { ALL_CONTRACT_ROUTES, contractRoutes } from "./index.js";
import { ENDPOINT_INVENTORY, endpointSignature } from "./inventory.js";

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
};

const doc = { frontmatter, body: "Body.", path: "data/docs/mortgage.md", anchors: [] };

const row = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  path: "data/docs/mortgage.md",
  status: "open" as const,
  tags: ["finance"],
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  due: null,
  reviewed: null,
  evergreen: false,
  excerpt: "Body.",
  attention: ["unread-reply" as const, "due" as const],
  snippets: [
    {
      field: "title" as const,
      segments: [
        { text: "Mortgage ", match: false },
        { text: "options", match: true },
      ],
    },
  ],
};

const turn = { author: "user" as const, ts: "2026-07-19T10:05:00Z", body: "hi" };

const thread = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  status: "open" as const,
  tags: [],
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged" as const,
  turns: [turn],
};

const threadSummary = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  status: "open" as const,
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged" as const,
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  turnCount: 1,
  lastAuthor: "user" as const,
  lastTs: "2026-07-19T10:05:00Z",
};

const queueEvent = {
  id: "evt_7c1d",
  type: "comment.created",
  created: "2026-07-19T10:05:01Z",
  source: "ui",
  payload: {},
};

const queueStatus = {
  halted: false,
  pending: 0,
  inProgress: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

const lock = {
  docId: "doc_a1b2c3",
  holder: "user" as const,
  acquired: "2026-07-19T10:05:00Z",
  ttl: 300,
};

const job = {
  eventId: "evt_7c1d",
  status: "in-progress" as const,
  started: "2026-07-19T10:05:02Z",
  updated: "2026-07-19T10:05:40Z",
  lastLine: null,
  originId: "th_x9y8",
};

/**
 * Registers **every** contract route against a real handler, exactly the way
 * `apps/server` will (SPEC.md §9.3). The handlers are canned, but the
 * registration is the assertion: a response shape the contract does not declare
 * is a compile error here, and the route table's ordering is exercised by real
 * requests rather than asserted in a comment.
 */
function createStubApp() {
  const app = new OpenAPIHono();

  app.openapi(contractRoutes.getHealth, (c) =>
    c.json(
      { status: "ok" as const, version: CONTRACT_VERSION, uptimeSeconds: 1, workspace: "/w" },
      200,
    ),
  );

  app.openapi(contractRoutes.listDocs, (c) => {
    const { limit, offset, sort } = c.req.valid("query");
    return c.json({ items: [{ ...row, excerpt: sort }], page: { total: 1, limit, offset } }, 200);
  });
  app.openapi(contractRoutes.createDoc, (c) => {
    const body = c.req.valid("json");
    const author = c.req.valid("header")[ACTOR_HEADER];
    return c.json(
      { ...doc, frontmatter: { ...frontmatter, title: `${body.title} by ${author}` } },
      201,
    );
  });
  app.openapi(contractRoutes.getDoc, (c) => c.json(doc, 200));
  app.openapi(contractRoutes.updateDoc, (c) =>
    c.json({ doc, anchors: { remapped: [], orphaned: [] } }, 200),
  );
  app.openapi(contractRoutes.deleteDoc, (c) =>
    c.json({ deletedId: c.req.valid("param").id, orphanedThreadIds: ["th_x9y8"] }, 200),
  );
  app.openapi(contractRoutes.moveDoc, (c) =>
    c.json({ ...doc, path: `data/docs/${c.req.valid("json").folder}/mortgage.md` }, 200),
  );
  app.openapi(contractRoutes.archiveDoc, (c) =>
    c.json({ ...doc, frontmatter: { ...frontmatter, status: "archived" as const } }, 200),
  );
  app.openapi(contractRoutes.unarchiveDoc, (c) => c.json(doc, 200));

  app.openapi(contractRoutes.getTree, (c) =>
    c.json(
      {
        folders: [
          {
            path: "finance",
            name: "finance",
            count: 1,
            totalCount: 2,
            children: [
              { path: "finance/loans", name: "loans", count: 1, totalCount: 1, children: [] },
            ],
          },
        ],
      },
      200,
    ),
  );
  app.openapi(contractRoutes.capture, (c) => {
    const body = c.req.valid("form");
    return c.json(
      {
        docId: "doc_a1b2c3",
        threadId: "th_x9y8",
        eventId: body.requestsAgent === false ? null : "evt_7c1d",
      },
      201,
    );
  });

  app.openapi(contractRoutes.createThread, (c) =>
    c.json({ thread, anchorId: "anc_k4f7", eventId: null }, 201),
  );
  app.openapi(contractRoutes.getThread, (c) => c.json(thread, 200));
  app.openapi(contractRoutes.appendTurn, (c) =>
    c.json({ thread: threadSummary, turn, eventId: null }, 201),
  );
  app.openapi(contractRoutes.deleteTurn, (c) =>
    c.json(
      {
        deletedTurn: true as const,
        deletedThread: false,
        removedAnchor: null,
        parentId: c.req.valid("param").ts === turn.ts ? "doc_a1b2c3" : null,
      },
      200,
    ),
  );
  app.openapi(contractRoutes.resolveThread, (c) =>
    c.json({ ...threadSummary, status: "resolved" as const }, 200),
  );
  app.openapi(contractRoutes.reopenThread, (c) => c.json(threadSummary, 200));
  app.openapi(contractRoutes.markThreadSeen, (c) =>
    c.json(
      {
        threadId: c.req.valid("param").id,
        lastSeenTs: c.req.valid("json").lastSeenTs ?? turn.ts,
        unread: false as const,
      },
      200,
    ),
  );

  app.openapi(contractRoutes.getQueueStatus, (c) => c.json(queueStatus, 200));
  app.openapi(contractRoutes.idleQueue, (c) =>
    c.req.valid("query").timeout === 1 ? c.body(null, 204) : c.json({ events: [queueEvent] }, 200),
  );
  app.openapi(contractRoutes.claimAll, (c) => c.json({ events: [queueEvent] }, 200));
  app.openapi(contractRoutes.reapStale, (c) => c.json({ reaped: ["evt_7c1d"] }, 200));
  app.openapi(contractRoutes.haltQueue, (c) =>
    // `pending` doubles as the echo of the optional reason's length: the status
    // shape carries no string field, and the length proves the annotation
    // reached the handler intact.
    c.json({ ...queueStatus, halted: true, pending: c.req.valid("json").reason?.length ?? 0 }, 200),
  );
  app.openapi(contractRoutes.resumeQueue, (c) => c.json(queueStatus, 200));
  app.openapi(contractRoutes.completeEvent, (c) => c.json(queueEvent, 200));
  app.openapi(contractRoutes.failEvent, (c) => c.json(queueEvent, 200));
  app.openapi(contractRoutes.abandonEvent, (c) => c.json(queueEvent, 200));

  app.openapi(contractRoutes.listLocks, (c) => c.json({ locks: [lock] }, 200));
  app.openapi(contractRoutes.reapLocks, (c) => c.json({ reaped: ["doc_a1b2c3"] }, 200));
  app.openapi(contractRoutes.acquireLock, (c) =>
    c.json({ ...lock, docId: c.req.valid("param").docId }, 201),
  );
  app.openapi(contractRoutes.releaseLock, (c) =>
    c.json(
      { docId: c.req.valid("param").docId, released: true as const, holder: "user" as const },
      200,
    ),
  );
  app.openapi(contractRoutes.breakLock, (c) =>
    c.json(
      { docId: c.req.valid("param").docId, released: true as const, holder: "agent" as const },
      200,
    ),
  );

  app.openapi(contractRoutes.listJobs, (c) => c.json({ jobs: [job] }, 200));
  app.openapi(contractRoutes.getJobLog, (c) =>
    c.json({ lines: [{ ts: job.updated, line: "step" }], nextCursor: 1 }, 200),
  );
  app.openapi(contractRoutes.appendJobLog, (c) =>
    c.json({ eventId: c.req.valid("param").id, appended: true as const }, 201),
  );
  app.openapi(contractRoutes.retryJob, (c) => c.json({ ...job, status: "pending" as const }, 200));
  app.openapi(contractRoutes.abandonJob, (c) =>
    c.json({ ...job, status: "abandoned" as const }, 200),
  );

  app.openapi(contractRoutes.streamEvents, (c) =>
    c.newResponse("event: invalidate\ndata: {}\n\n", 200, {
      "content-type": "text/event-stream",
    }),
  );
  app.openapi(contractRoutes.getAttachment, (c) =>
    c.newResponse(c.req.valid("param").path, 200, {
      "content-type": "application/octet-stream",
    }),
  );

  return app;
}

describe("contract route registry", () => {
  it("exposes every declared route in the flat list", () => {
    expect(ALL_CONTRACT_ROUTES).toHaveLength(Object.keys(contractRoutes).length);
  });

  it("gives each route a distinct method and path", () => {
    const signatures = ALL_CONTRACT_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("declares exactly the pinned endpoint inventory", () => {
    const declared = ALL_CONTRACT_ROUTES.map((route) =>
      endpointSignature(route.method, route.path),
    );
    expect([...declared].sort()).toEqual([...ENDPOINT_INVENTORY].sort());
  });

  /**
   * Static-before-parameter is load-bearing: `/api/locks/reap` and
   * `/api/locks/{docId}` compete for the same position, and a `docId` of `reap`
   * would otherwise be indistinguishable. The failure mode is silent misrouting,
   * so the order is held by a test rather than by a comment.
   */
  it.each([
    ["/api/locks/reap", "/api/locks/{docId}"],
    ["/api/queue/reap-stale", "/api/queue/{id}/complete"],
    ["/api/queue/claim-all", "/api/queue/{id}/complete"],
    ["/api/queue/halt", "/api/queue/{id}"],
    ["/api/queue/resume", "/api/queue/{id}"],
  ])("registers %s before its parameterised peer %s", (staticPath, parameterisedPath) => {
    const paths: string[] = ALL_CONTRACT_ROUTES.map((route) => route.path);
    expect(paths.indexOf(staticPath)).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf(staticPath)).toBeLessThan(paths.indexOf(parameterisedPath));
  });
});

describe("routes mounted on a Hono app", () => {
  it("serves the OpenAPI document from the mounted definitions", async () => {
    const app = createStubApp();
    app.doc31("/doc", {
      openapi: "3.1.0",
      info: { title: "Corpus API", version: CONTRACT_VERSION },
    });

    const response = await app.request("/doc");
    expect(response.status).toBe(200);

    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    expect(document.openapi).toBe("3.1.0");

    const mounted: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ["get", "post", "put", "delete"]) {
        if (method in item) mounted.push(endpointSignature(method, path));
      }
    }
    expect(mounted.sort()).toEqual([...ENDPOINT_INVENTORY].sort());
  });

  it("answers the unauthenticated health probe", async () => {
    const response = await createStubApp().request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("applies the declared pagination and sort defaults to a bare list request", async () => {
    const response = await createStubApp().request("/api/docs");
    const list = (await response.json()) as {
      items: { excerpt: string }[];
      page: { limit: number; offset: number };
    };
    expect(list.page).toEqual({ total: 1, limit: 50, offset: 0 });
    expect(list.items[0]?.excerpt).toBe("-updated");
  });

  it("rejects sort=relevance without a query, rather than falling back", async () => {
    const app = createStubApp();
    expect((await app.request("/api/docs?sort=relevance")).status).toBe(400);
    expect((await app.request("/api/docs?sort=relevance&q=rates")).status).toBe(200);
  });

  it("validates path parameters against the id pattern", async () => {
    const app = createStubApp();
    expect((await app.request("/api/docs/doc_a1b2c3")).status).toBe(200);
    expect((await app.request("/api/docs/not-an-id")).status).toBe(400);
  });

  it("defaults the acting party to the user when the header is absent", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "New" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { frontmatter: { title: string } };
    expect(created.frontmatter.title).toBe("New by user");
  });

  it("carries an explicit agent attribution through to the handler", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json", [ACTOR_HEADER]: "agent" },
      body: JSON.stringify({ type: "note", title: "New" }),
    });
    const created = (await response.json()) as { frontmatter: { title: string } };
    expect(created.frontmatter.title).toBe("New by agent");
  });

  it("rejects an actor outside the two parties", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json", [ACTOR_HEADER]: "robot" },
      body: JSON.stringify({ type: "note", title: "New" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a request body the contract does not accept", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "" }),
    });
    expect(response.status).toBe(400);
  });

  /** A `docId` literally named `reap` must not swallow the reap verb, and vice versa. */
  it.each([
    ["/api/locks/reap", '{"reaped":["doc_a1b2c3"]}'],
    ["/api/queue/reap-stale", '{"reaped":["evt_7c1d"]}'],
  ])("routes %s to its own handler, not to the parameterised peer", async (path, expected) => {
    const response = await createStubApp().request(path, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
  });

  it("still reaches the parameterised lock route for a real document id", async () => {
    const response = await createStubApp().request("/api/locks/doc_a1b2c3", { method: "POST" });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ docId: "doc_a1b2c3" });
  });

  /** The turn timestamp is an ISO instant, so it carries `:` and must arrive percent-encoded. */
  it("matches a URL-encoded ISO timestamp in the turn-deletion path", async () => {
    const encoded = encodeURIComponent(turn.ts);
    expect(encoded).toBe("2026-07-19T10%3A05%3A00Z");
    const response = await createStubApp().request(`/api/threads/th_x9y8/turns/${encoded}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedTurn: true,
      deletedThread: false,
      removedAnchor: null,
      parentId: "doc_a1b2c3",
    });
  });

  it("rejects a turn timestamp that is not an instant", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/turns/yesterday", {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
  });

  it("accepts a multipart turn with a file and no text", async () => {
    const form = new FormData();
    form.append("files", new File(["bytes"], "shot.png", { type: "image/png" }));
    const response = await createStubApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(201);
  });

  it("rejects a multipart turn carrying neither text nor files", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      body: new FormData(),
    });
    expect(response.status).toBe(400);
  });

  it("still accepts the JSON form of the same turn-append route", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "hi" }),
    });
    expect(response.status).toBe(201);
  });

  it('preserves an explicit "note only" through the multipart capture body', async () => {
    const form = new FormData();
    form.append("text", "a thought");
    form.append("requestsAgent", "false");
    const response = await createStubApp().request("/api/capture", { method: "POST", body: form });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ eventId: null });
  });

  it("enqueues by default when the capture leaves the signal unset", async () => {
    const form = new FormData();
    form.append("text", "a thought");
    const response = await createStubApp().request("/api/capture", { method: "POST", body: form });
    await expect(response.json()).resolves.toMatchObject({ eventId: "evt_7c1d" });
  });

  it("answers the long-poll timeout with a bodiless 204", async () => {
    const response = await createStubApp().request("/api/queue/idle?timeout=1");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("answers a live long-poll with the pending events", async () => {
    const response = await createStubApp().request("/api/queue/idle");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ events: [{ id: "evt_7c1d" }] });
  });

  /**
   * The kill switch must stay reachable with nothing but a verb and a URL, so
   * the annotation had to be added without making the body mandatory.
   */
  it("halts on a bare POST that sends no body and no content type", async () => {
    const response = await createStubApp().request("/api/queue/halt", { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ halted: true, pending: 0 });
  });

  it("halts on an explicitly empty JSON body", async () => {
    const response = await createStubApp().request("/api/queue/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ halted: true, pending: 0 });
  });

  it("carries an optional halt reason through to the handler", async () => {
    const response = await createStubApp().request("/api/queue/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "deploying" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ halted: true, pending: 9 });
  });

  it("rejects a blank halt reason", async () => {
    const response = await createStubApp().request("/api/queue/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(response.status).toBe(400);
  });

  it("serves the SSE route as an event stream, not as JSON", async () => {
    const response = await createStubApp().request("/events?token=t");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("serves attachment bytes as an opaque stream", async () => {
    const response = await createStubApp().request("/attachments/shot.png");
    expect(response.headers.get("content-type")).toContain("application/octet-stream");
    expect(await response.text()).toBe("shot.png");
  });
});
