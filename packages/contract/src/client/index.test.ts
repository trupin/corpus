import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { contractRoutes } from "../routes/index.js";
import { createCorpusClient, isApiError } from "./index.js";

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
