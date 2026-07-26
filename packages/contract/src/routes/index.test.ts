import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { CONTRACT_VERSION } from "../openapi.js";
import { ALL_CONTRACT_ROUTES, contractRoutes } from "./index.js";

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

/**
 * Registers the contract's route definitions against real handlers, exactly the
 * way `apps/server` will (SPEC.md §9.3). The handlers are canned, but the
 * registration itself is the assertion: a response shape the contract does not
 * declare is a compile error here.
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
    const { limit, offset } = c.req.valid("query");
    return c.json({ items: [], page: { total: 0, limit, offset } }, 200);
  });

  app.openapi(contractRoutes.getDoc, (c) => c.json(doc, 200));

  app.openapi(contractRoutes.createDoc, (c) => {
    const body = c.req.valid("json");
    const author = c.req.valid("header")[ACTOR_HEADER];
    return c.json(
      { ...doc, frontmatter: { ...frontmatter, title: `${body.title} by ${author}` } },
      201,
    );
  });

  app.openapi(contractRoutes.updateDoc, (c) =>
    c.json({ doc, anchors: { remapped: [], orphaned: [] } }, 200),
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
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/api/docs",
      "/api/docs/{id}",
      "/api/health",
    ]);
  });

  it("answers the unauthenticated health probe", async () => {
    const response = await createStubApp().request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("applies the declared pagination defaults to a bare list request", async () => {
    const response = await createStubApp().request("/api/docs");
    await expect(response.json()).resolves.toEqual({
      items: [],
      page: { total: 0, limit: 50, offset: 0 },
    });
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

  it("rejects a request body the contract does not accept", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "" }),
    });
    expect(response.status).toBe(400);
  });
});
