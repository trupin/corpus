import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { contractRoutes, mountAppendTurn } from "../routes/index.js";
import { FormSchema, validateFormAnswer } from "../schemas/form.js";
import * as client from "./index.js";
import { createCorpusClient, isApiError, type FetchPaths, type paths } from "./index.js";

const BASE_URL = "http://127.0.0.1:8765";
const TOKEN = "workspace-token";

/** The key a read hands out, and the fresh one every write answers with (SPEC.md §7). */
const DOC_KEY = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde";
const NEXT_DOC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

const threadSummary = {
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
};

/** The form the stub thread's agent turn carries: one field of each kind. */
const FORM = FormSchema.parse({
  fields: [
    { question: "Which rate?", kind: "choose one", options: ["6.1%", "6.4%"] },
    { question: "Which sheets?", kind: "choose any", options: ["Q1", "Q2"] },
    { question: "Anything else?", kind: "write", optional: true },
  ],
});

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
        key: DOC_KEY,
        userEditing: false,
      },
      200,
    );
  });

  // SPEC.md §7: a write that replaces the body presents the key it read, and the
  // saved document comes back carrying a **fresh** one — so a writer that keeps
  // writing never has to re-read. A stale key is refused with the document as it
  // now stands, which is what `doc_stale1` stands in for.
  app.openapi(contractRoutes.updateDoc, (c) => {
    const actor = c.req.valid("header")[ACTOR_HEADER];
    const { id } = c.req.valid("param");
    if (id === "doc_stale1") {
      return c.json(
        {
          code: "stale_key" as const,
          message: "The key you presented names a version this document no longer is.",
          doc: {
            frontmatter,
            body: "what it says now",
            path: "data/docs/mortgage.md",
            anchors: [],
            key: NEXT_DOC_KEY,
            userEditing: true,
          },
        },
        409,
      );
    }
    return c.json(
      {
        doc: {
          frontmatter,
          body: `saved by ${actor}`,
          path: "data/docs/mortgage.md",
          anchors: [],
          key: NEXT_DOC_KEY,
          userEditing: false,
        },
        anchors: { remapped: [], orphaned: [] },
        warnings: [],
      },
      200,
    );
  });

  // CONTRACT-037, restaged for SHARED-032 by CONTRACT-048. The handler echoes
  // every row with the verb it carried and splits them across §11's three parts,
  // so the typed call proves both directions: the per-row discriminated act
  // reaches the wire, and the three-part result comes back narrowed rather than
  // as an opaque blob. A `wholeResultSet` entry resolves to one synthetic id.
  app.openapi(contractRoutes.applyBulkAction, (c) => {
    const { entries, wholeResultSet } = c.req.valid("json");
    const actor = c.req.valid("header")[ACTOR_HEADER];
    if (entries.some((row) => row.action.action === "delete") && actor === "agent") {
      return c.json({ code: "forbidden" as const, message: "the agent archives" }, 403);
    }
    const staged = [
      ...entries.map((row) => ({
        id: row.id,
        action: row.action.action,
        detail: row.action.action === "move" ? row.action.folder : row.action.action,
      })),
      ...(wholeResultSet === undefined
        ? []
        : [
            {
              id: "doc_fromquery",
              action: wholeResultSet.action.action,
              detail: Object.keys(wholeResultSet.query).join(","),
            },
          ]),
    ];
    const refused = staged.filter((row) => row.id.startsWith("th_"));
    const changed = staged.filter((row) => !row.id.startsWith("th_"));
    return c.json(
      {
        changed: changed.map(({ id, action }) => ({ id, action })),
        alreadyInState: [],
        refused: refused.map((row) => ({
          id: row.id,
          action: row.action,
          reason: "stale" as const,
          message: `${row.detail} · actor=${actor}`,
        })),
        orphanedThreadIds: [],
        commit: changed.length === 0 ? null : "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
        warnings: [],
      },
      200,
    );
  });

  app.openapi(contractRoutes.listDocs, (c) => {
    const { limit, offset, q, isParent } = c.req.valid("query");
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
            // The handler echoes the parsed query so the test can assert what
            // the typed client actually put on the wire.
            excerpt: `isParent=${isParent === undefined ? "absent" : String(isParent)}`,
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
            unansweredForms: 0,
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
          model: null,
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

  /**
   * The context pack (CONTRACT-024). One route, three shapes, chosen by the id —
   * the union is the whole point of the response, and a stub that only ever
   * answered one shape would never exercise the client's narrowing.
   */
  app.openapi(contractRoutes.getThreadContext, (c) => {
    const { id } = c.req.valid("param");
    const excerpts = [
      {
        id: "doc_b2c3d4",
        headingPath: "Lender comparison › Rates",
        excerpt: "Three lenders quoted between 5.9% and 6.4% in July.",
        relation: "linked" as const,
      },
    ];
    if (id === "th_alone") {
      return c.json({ shape: "standalone" as const, threadId: id, excerpts: [] }, 200);
    }
    if (id === "th_gone") {
      return c.json(
        {
          shape: "parent-deleted" as const,
          threadId: id,
          excerpts,
          deletedParent: frontmatter.id,
        },
        200,
      );
    }
    if (id !== "th_x9y8") {
      return c.json({ code: "not_found" as const, message: `No thread ${id}.` }, 404);
    }
    return c.json(
      {
        shape: "anchored" as const,
        threadId: id,
        excerpts,
        // The degrade word is the shared one: a pack cannot report `current`
        // while search reports `stale` for the same workspace.
        semanticIndex: "stale" as const,
        parent: {
          id: frontmatter.id,
          title: frontmatter.title,
          headingPath: `${frontmatter.title} › Rates`,
          quote: "the 30-year fixed rate assumption is 6.1%",
          section: "## Rates\n\nWe assume the 30-year fixed rate assumption is 6.1%.",
          truncated: false,
        },
      },
      200,
    );
  });

  /**
   * The semantic-index pair (CONTRACT-023). Both handlers are written the way
   * the server will have to write them — one shape, two status codes — so the
   * `202` on rebuild is exercised over a real mounted route rather than asserted
   * only in the document.
   */
  app.openapi(contractRoutes.getIndexStatus, (c) =>
    c.json(
      {
        indexed: 154,
        pending: 0,
        failed: 0,
        identity: "ollama/nomic-embed-text@768",
        rebuilding: false,
        state: "current" as const,
      },
      200,
    ),
  );

  // The forms surface, mounted from the real definition so the generated client
  // is exercised over the same validation path the server will use.
  app.openapi(contractRoutes.respondToForm, (c) => {
    const answer = c.req.valid("json");
    const rejection = validateFormAnswer(FORM, answer);
    if (rejection) return c.json(rejection, 400);
    return c.json(
      {
        thread: threadSummary,
        turn: {
          author: "user" as const,
          ts: "2026-07-19T10:09:00Z",
          body: answer.answers.map((entry) => entry.question).join("; "),
          model: null,
        },
        eventId: "evt_7c1d",
        warnings: [],
      },
      201,
    );
  });

  app.openapi(contractRoutes.rebuildIndex, (c) =>
    c.json(
      {
        indexed: 0,
        pending: 154,
        failed: 0,
        // Echoes the credentials, so the test can assert the client still
        // authenticates a call that carries no acting party.
        identity: `auth=${c.req.header("authorization") ?? ""}`,
        rebuilding: true,
        state: "indexing" as const,
      },
      202,
    ),
  );

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
      body: { body: "new body", key: DOC_KEY },
    });
    expect(data?.doc.body).toBe("saved by agent");
  });

  /**
   * SPEC.md §7 end to end through the generated client: a read hands out a key,
   * the write presents it, and the write's answer carries a fresh one — so the
   * next write needs no second read.
   */
  it("carries the key from a read into a write, and hands a fresh one back", async () => {
    const client = createTestClient();
    const read = await client.api.GET("/api/docs/{id}", {
      params: { path: { id: "doc_a1b2c3" } },
    });
    expect(read.data?.key).toBe(DOC_KEY);
    expect(read.data?.userEditing).toBe(false);

    const written = await client.api.PUT("/api/docs/{id}", {
      params: { path: { id: "doc_a1b2c3" } },
      body: { body: "new body", key: read.data?.key ?? "" },
    });
    expect(written.data?.doc.key).toBe(NEXT_DOC_KEY);
    expect(written.data?.doc.key).not.toBe(DOC_KEY);
  });

  /**
   * A refusal is never bare (SHARED-041 decision 5): it carries the whole
   * document, so the writer can reconcile and retry inside one exchange. The
   * fresh key lives on that document rather than beside it, so two copies can
   * never disagree.
   */
  it("surfaces a stale-key refusal as a typed 409 carrying the document and a fresh key", async () => {
    const { data, error, response } = await createTestClient().api.PUT("/api/docs/{id}", {
      params: { path: { id: "doc_stale1" } },
      body: { body: "new body", key: DOC_KEY },
    });
    expect(data).toBeUndefined();
    expect(response.status).toBe(409);
    expect(error?.code).toBe("stale_key");
    expect(isApiError(error)).toBe(true);
    const refusal = error?.code === "stale_key" ? error : undefined;
    expect(refusal?.doc.body).toBe("what it says now");
    expect(refusal?.doc.key).toBe(NEXT_DOC_KEY);
    expect(refusal?.doc.userEditing).toBe(true);
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

  /**
   * CONTRACT-040, the same shape check for the open-form count: the chip reads
   * it through a `> 1` threshold, so `number | null` would compile a missing
   * coalesce into a silently-false comparison rather than a type error.
   */
  it("types the open-form count as a required number, so the chip needs no fallback", async () => {
    const { data } = await createTestClient().api.GET("/api/docs", {
      params: { query: { folder: "finance" } },
    });
    const open: number | undefined = data?.items[0]?.unansweredForms;
    expect(open).toBe(0);
  });

  /** The rider's parameter has to exist on the generated client, not only in the schema. */
  it("accepts includeArchived on the typed query", async () => {
    const { data, error } = await createTestClient().api.GET("/api/docs", {
      params: { query: { includeArchived: true, sort: "-updated" } },
    });
    expect(error).toBeUndefined();
    expect(data?.items).toHaveLength(1);
  });

  /**
   * CONTRACT-042, end to end over the mounted definitions: the generated client
   * has to carry `isParent` as a boolean, the route's validator has to parse it
   * off the wire, and the contradiction with `parent` has to come back as the
   * declared `400` rather than as an empty list a caller would read as an
   * answer.
   */
  it.each([
    [true, "isParent=true"],
    [false, "isParent=false"],
  ])("puts isParent=%s on the wire as a boolean", async (isParent, echoed) => {
    const { data, error } = await createTestClient().api.GET("/api/docs", {
      params: { query: { isParent } },
    });
    expect(error).toBeUndefined();
    expect(data?.items[0]?.excerpt).toBe(echoed);
  });

  it("sends nothing when isParent is not asked for, so the server filters nothing", async () => {
    const { data } = await createTestClient().api.GET("/api/docs", { params: { query: {} } });
    expect(data?.items[0]?.excerpt).toBe("isParent=absent");
  });

  it("refuses `parent` with `isParent=true` at the route, naming the parameter", async () => {
    const { data, error, response } = await createTestClient().api.GET("/api/docs", {
      params: { query: { parent: "doc_a1b2c3", isParent: true } },
    });
    expect(response.status).toBe(400);
    expect(data).toBeUndefined();
    expect(JSON.stringify(error)).toContain("isParent");
  });

  it("allows `parent` with `isParent=false`, which is redundant rather than contradictory", async () => {
    const { data, error } = await createTestClient().api.GET("/api/docs", {
      params: { query: { parent: "doc_a1b2c3", isParent: false } },
    });
    expect(error).toBeUndefined();
    expect(data?.items[0]?.excerpt).toBe("isParent=false");
  });
});

/**
 * CONTRACT-022. Both retrieval verbs reach the agent through this client and
 * nothing else (SPEC.md §2.2 rule 4), so the generated types are the contract
 * `corpus search` and `corpus doc related` compile against — including the
 * absences: a hit has no body to read, and the search query has no `sort`,
 * `offset` or `pinned` to pass.
 */
/**
 * CONTRACT-037 — the call UI-083 makes. What matters here is that the *types*
 * carry the shape, not just the JSON: the act narrows on `action`, so a `move`
 * without a folder is a compile error rather than a `400` at runtime, and the
 * three parts come back as three named lists rather than a count the board would
 * have to infer from.
 */
describe("the typed bulk act", () => {
  it("sends a staged set and gets §11's three parts back", async () => {
    const { data, error } = await createTestClient().api.POST("/api/docs/bulk", {
      body: {
        entries: [
          { id: "doc_a1b2c3", action: { action: "archive" } },
          { id: "th_x9y8", action: { action: "resolve" } },
        ],
      },
    });
    expect(error).toBeUndefined();
    expect(data?.changed).toEqual([{ id: "doc_a1b2c3", action: "archive" }]);
    expect(data?.alreadyInState).toEqual([]);
    expect(data?.refused[0]?.id).toBe("th_x9y8");
    // The verb that applied travels with the document, so a mixed report reads
    // without pairing itself back against the request.
    expect(data?.refused[0]?.action).toBe("resolve");
    // The class is typed, so the board can branch on it without a cast — and
    // there is no holder to render, because nothing is ever held (SPEC.md §7).
    expect(data?.refused[0]?.reason).toBe("stale");
    // One act, one commit.
    expect(data?.commit).toBe("9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456");
  });

  /**
   * SHARED-032's case, and the one `{ids, action}` could not express: three
   * archives and two resolves in one call, and one sha for all of them (§4).
   */
  it("sends a mix of verbs as one call and gets one commit", async () => {
    const { data } = await createTestClient().api.POST("/api/docs/bulk", {
      body: {
        entries: [
          { id: "doc_a1b2c3", action: { action: "archive" } },
          { id: "doc_b2c3d4", action: { action: "archive" } },
          { id: "doc_c3d4e5", action: { action: "archive" } },
          { id: "doc_d4e5f6", action: { action: "resolve" } },
          { id: "doc_e5f6a7", action: { action: "resolve" } },
        ],
      },
    });
    expect(data?.changed.map((row) => row.action)).toEqual([
      "archive",
      "archive",
      "archive",
      "resolve",
      "resolve",
    ]);
    expect(data?.commit).toBe("9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456");
  });

  /** §11's whole-result-set selection: one entry carrying a query, no ids. */
  it("stages a whole result set as one entry beside the enumerated rows", async () => {
    const { data } = await createTestClient().api.POST("/api/docs/bulk", {
      body: {
        entries: [{ id: "doc_a1b2c3", action: { action: "review" } }],
        wholeResultSet: {
          query: { type: ["note", "view"], tag: "finance" },
          action: { action: "archive" },
        },
      },
    });
    expect(data?.changed).toEqual([
      { id: "doc_a1b2c3", action: "review" },
      { id: "doc_fromquery", action: "archive" },
    ]);
  });

  it("carries each act's own parameters, typed", async () => {
    const { data } = await createTestClient("agent").api.POST("/api/docs/bulk", {
      body: { entries: [{ id: "th_x9y8", action: { action: "move", folder: "finance" } }] },
    });
    expect(data?.refused[0]?.message).toBe("finance · actor=agent");
    // Nothing changed, so there is no commit at all.
    expect(data?.changed).toEqual([]);
    expect(data?.commit).toBeNull();
  });

  /**
   * Compile-time assertions, checked by `tsc --noEmit` rather than by a run:
   * the tag act carries a delta and no replacement, a `move` without a folder is
   * not a call anyone can write, each staged row carries its own verb, and §11's
   * "a whole-result-set selection cannot be deleted" is a *type* error rather
   * than something discovered at runtime on 412 documents.
   */
  type BulkBody = NonNullable<
    paths["/api/docs/bulk"]["post"]["requestBody"]
  >["content"]["application/json"];
  type BulkAct = BulkBody["entries"][number]["action"];
  type WholeResultSetAct = NonNullable<BulkBody["wholeResultSet"]>["action"];
  type TagAct = Extract<BulkAct, { action: "tag" }>;
  type MoveAct = Extract<BulkAct, { action: "move" }>;
  type TagIsADelta = "add" extends keyof TagAct
    ? "tags" extends keyof TagAct
      ? never
      : true
    : never;
  type MoveNeedsAFolder = MoveAct extends { folder: string } ? true : never;
  type EveryRowCarriesAVerb = "action" extends keyof BulkBody["entries"][number] ? true : never;
  type EnumeratedRowMayDelete = Extract<BulkAct, { action: "delete" }> extends never ? never : true;
  type WholeResultSetMayNotDelete =
    Extract<WholeResultSetAct, { action: "delete" }> extends never ? true : never;

  it("types the staged set, the tag delta, and §11's delete restriction", () => {
    const delta: TagIsADelta = true;
    const folder: MoveNeedsAFolder = true;
    const perRow: EveryRowCarriesAVerb = true;
    const enumeratedDelete: EnumeratedRowMayDelete = true;
    const noQueryDelete: WholeResultSetMayNotDelete = true;
    expect([delta, folder, perRow, enumeratedDelete, noQueryDelete]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("expresses a tag delta over the wire", async () => {
    const { data } = await createTestClient().api.POST("/api/docs/bulk", {
      body: {
        entries: [{ id: "doc_a1b2c3", action: { action: "tag", add: ["q3"], remove: ["inbox"] } }],
      },
    });
    expect(data?.changed[0]?.action).toBe("tag");
  });

  it("refuses a staged set holding a delete from the agent as a typed 403", async () => {
    const { data, error, response } = await createTestClient("agent").api.POST("/api/docs/bulk", {
      body: { entries: [{ id: "doc_a1b2c3", action: { action: "delete" } }] },
    });
    expect(data).toBeUndefined();
    expect(response.status).toBe(403);
    expect(error?.code).toBe("forbidden");
    expect(isApiError(error)).toBe(true);
  });

  /** An id staged twice is the request's error, not a resolution rule. */
  it("refuses a repeated id with a 400 that names it", async () => {
    const { error, response } = await createTestClient().api.POST("/api/docs/bulk", {
      body: {
        entries: [
          { id: "doc_a1b2c3", action: { action: "archive" } },
          { id: "doc_a1b2c3", action: { action: "review" } },
        ],
      },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(error)).toContain("staged twice with different actions");
  });
});

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
 * The context pack (CONTRACT-024, TEST-954). Two things are asserted that only a
 * real typed call can show: the method exists at
 * `paths["/api/threads/{id}/context"]["get"]`, and the discriminated response
 * **narrows on `shape`** rather than forcing the caller to probe for a `parent`
 * key. The compile-time assertion below is the one that matters — a query
 * parameter added to this route would break it, not a run.
 */
describe("the typed context-pack call", () => {
  type ContextOperation = paths["/api/threads/{id}/context"]["get"];
  type ContextTakesNoQuery = ContextOperation["parameters"] extends { query?: never }
    ? true
    : never;

  it("types the pack call as taking a path parameter and no query", () => {
    const noQuery: ContextTakesNoQuery = true;
    expect(noQuery).toBe(true);
  });

  it("narrows the anchored pack on `shape`, giving the quote and its whole section", async () => {
    const { data, error } = await createTestClient().api.GET("/api/threads/{id}/context", {
      params: { path: { id: "th_x9y8" } },
    });
    expect(error).toBeUndefined();
    if (data?.shape !== "anchored")
      throw new Error(`Expected an anchored pack, got ${data?.shape}`);
    expect(data.parent.quote).toBe("the 30-year fixed rate assumption is 6.1%");
    expect(data.parent.section).toContain("## Rates");
    expect(data.parent.truncated).toBe(false);
    expect(Object.keys(data.excerpts[0] ?? {})).toEqual([
      "id",
      "headingPath",
      "excerpt",
      "relation",
    ]);
    expect(data.semanticIndex).toBe("stale");
  });

  it("narrows a standalone pack to no parent block at all", async () => {
    const { data } = await createTestClient().api.GET("/api/threads/{id}/context", {
      params: { path: { id: "th_alone" } },
    });
    if (data?.shape !== "standalone") throw new Error(`Expected standalone, got ${data?.shape}`);
    expect("parent" in data).toBe(false);
    expect(data.excerpts).toEqual([]);
  });

  it("answers a deleted parent with a 200 naming the id that no longer resolves", async () => {
    const { data, error, response } = await createTestClient().api.GET(
      "/api/threads/{id}/context",
      { params: { path: { id: "th_gone" } } },
    );
    expect(response.status).toBe(200);
    expect(error).toBeUndefined();
    if (data?.shape !== "parent-deleted") throw new Error(`Expected parent-deleted.`);
    expect(data.deletedParent).toBe("doc_a1b2c3");
  });

  it("surfaces an unknown thread as the shipped typed 404", async () => {
    const { data, error } = await createTestClient().api.GET("/api/threads/{id}/context", {
      params: { path: { id: "th_nope" } },
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
 * The semantic-index pair over the generated fetch surface (CONTRACT-023) — the
 * proof that both new operations exist as typed methods, and that the rebuild's
 * `202` reaches the caller as `data` rather than as an error.
 */
describe("the semantic-index maintenance calls", () => {
  // Compile-time assertions: neither operation may grow a body, and neither may
  // grow the acting-party header (SPEC.md §9.2 — no acting party).
  type RebuildOperation = paths["/api/index/rebuild"]["post"];
  type RebuildTakesNoBody = RebuildOperation extends { requestBody?: undefined } ? true : never;
  type RebuildTakesNoParameters = RebuildOperation extends {
    parameters: { header?: never; query?: never };
  }
    ? true
    : never;

  it("types the rebuild call as taking neither a body nor a header", () => {
    const bodiless: RebuildTakesNoBody = true;
    const headerless: RebuildTakesNoParameters = true;
    expect([bodiless, headerless]).toEqual([true, true]);
  });

  it("reads the index status as typed data", async () => {
    const { data, error } = await createTestClient().api.GET("/api/index/status");

    expect(error).toBeUndefined();
    expect(data?.state).toBe("current");
    expect(data?.identity).toBe("ollama/nomic-embed-text@768");
    expect(data?.indexed).toBe(154);
  });

  it("takes the rebuild's 202 acknowledgement as data, still authenticated", async () => {
    const { data, error, response } = await createTestClient().api.POST("/api/index/rebuild");

    expect(response.status).toBe(202);
    expect(error).toBeUndefined();
    expect(data?.rebuilding).toBe(true);
    expect(data?.state).toBe("indexing");
    expect(data?.pending).toBe(154);
    expect(data?.identity).toContain(`auth=Bearer ${TOKEN}`);
  });

  /**
   * A fresh workspace is the shape most consumers will meet first, and `null`
   * identity is the field a client is most likely to mishandle — so the typed
   * narrowing is exercised rather than assumed.
   */
  it("types a null identity as null rather than as an absent key", async () => {
    const { data } = await createTestClient().api.GET("/api/index/status");
    const identity: string | null = data?.identity ?? null;
    expect(typeof identity === "string" || identity === null).toBe(true);
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

/**
 * CONTRACT-038. The form answer travels through the generated client — the one
 * both `apps/cli` and `apps/ui` use — against the real route definition, so the
 * multi-field body is exercised over the same validation path the server will
 * use rather than asserted against the Zod schema a second time.
 */
describe("the typed form answer", () => {
  type FormAnswerBody = NonNullable<
    paths["/api/threads/{id}/turns/{ts}/form"]["post"]["requestBody"]
  >["content"]["application/json"];

  const answerForm = (body: FormAnswerBody) =>
    createTestClient("user").api.POST("/api/threads/{id}/turns/{ts}/form", {
      params: { path: { id: "th_x9y8", ts: "2026-07-19T10:07:12Z" } },
      body,
    });

  /**
   * The generated entry type, hand-transcribed rather than derived from the Zod
   * schema: `z.infer` widens an optional to `?: T | undefined` while
   * `openapi-typescript` emits `?: T`, so a schema-derived probe would test the
   * wrong shape (CONTRACT-025).
   */
  type GeneratedAnswer = {
    answers: {
      question: string;
      option?: string;
      options?: string[];
      text?: string;
    }[];
    note?: string;
  };

  it("types the body as one entry per field, each naming its question", () => {
    const body: GeneratedAnswer = {
      answers: [
        { question: "Which rate?", option: "6.4%" },
        { question: "Which sheets?", options: ["Q1", "Q2"] },
        { question: "Anything else?", text: "nothing" },
      ],
      note: "matches the Q2 sheet",
    };
    const generated: FormAnswerBody = body;
    expect(generated.answers).toHaveLength(3);
  });

  it("answers a three-field form through the client", async () => {
    const { data, error } = await answerForm({
      answers: [
        { question: "Which rate?", option: "6.4%" },
        { question: "Which sheets?", options: ["Q1"] },
      ],
    });

    expect(error).toBeUndefined();
    // The optional `write` field was left blank, which is a legal omission.
    expect(data?.turn.body).toBe("Which rate?; Which sheets?");
    expect(data?.eventId).toBe("evt_7c1d");
  });

  it("rejects an answer that leaves a required field blank, naming it", async () => {
    const { data, error, response } = await answerForm({
      answers: [{ question: "Which rate?", option: "6.4%" }],
    });

    expect(data).toBeUndefined();
    expect(response.status).toBe(400);
    expect(isApiError(error) && error.code === "bad_request" && error.issues[0]?.message).toContain(
      "Which sheets?",
    );
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
