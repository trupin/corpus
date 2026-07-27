import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { contractRoutes } from "../routes/index.js";
import { createCorpusClient } from "./index.js";
import type { paths } from "./schema.generated.js";

/**
 * `openapi-typescript` promotes any property carrying a JSON Schema `default`
 * to a **required** member of the emitted TypeScript type, regardless of the
 * schema's `required` array. On a request body that inverts the meaning of a
 * server-applied default: the caller is forced to send exactly the fields the
 * server exists to fill in.
 *
 * These are compile-time probes. They fail under `tsc --noEmit`, not at
 * runtime, so they guard the client surface the CLI and the UI actually write
 * against — see the optional-in/defaulted-out convention in `../schemas/index.ts`.
 */

type JsonBody<Body> = Body extends { content: { "application/json": infer Shape } } ? Shape : never;

type CreateDocBody = JsonBody<NonNullable<paths["/api/docs"]["post"]["requestBody"]>>;
type CreateThreadBody = JsonBody<NonNullable<paths["/api/threads"]["post"]["requestBody"]>>;

/** The zero-form create from SPEC.md §11: a type and a title, nothing else. */
const minimalCreateDoc: CreateDocBody = { type: "note", title: "Mortgage options" };

/** Every server-defaulted field is still *accepted*; it is only never demanded. */
const fullCreateDoc: CreateDocBody = {
  type: "note",
  title: "Mortgage options",
  body: "Rates.",
  folder: "finance",
  tags: ["finance"],
  status: "open",
  due: null,
  evergreen: false,
};

/** A standalone thread: no parent, no selector, no title. */
const minimalCreateThread: CreateThreadBody = { body: "First turn." };

/** A selector needs only its quote; prefix and suffix are context, not payload. */
const anchoredCreateThread: CreateThreadBody = {
  parent: "doc_a1b2c3",
  selector: { exact: "fixed rate" },
  body: "First turn.",
};

const BASE_URL = "http://127.0.0.1:8765";

/**
 * The real route definitions, so the minimal bodies travel the same
 * `@hono/zod-openapi` validation the server will run them through — a body the
 * types accept but validation rejects would be a contract that lies.
 */
function createTestClient() {
  const app = new OpenAPIHono();

  app.openapi(contractRoutes.createDoc, (c) => {
    const request = c.req.valid("json");
    return c.json(
      {
        frontmatter: {
          id: "doc_a1b2c3",
          type: request.type,
          title: request.title,
          created: "2026-07-19T10:00:00Z",
          updated: "2026-07-19T10:00:00Z",
          tags: request.tags ?? [],
          status: request.status ?? ("open" as const),
          anchors: {},
          due: request.due ?? null,
          reviewed: null,
          evergreen: request.evergreen ?? false,
        },
        body: request.body ?? "",
        path: `data/docs/${request.folder ?? "inbox"}/mortgage-options.md`,
        anchors: [],
      },
      201,
    );
  });

  app.openapi(contractRoutes.createThread, (c) => {
    const request = c.req.valid("json");
    return c.json(
      {
        thread: {
          id: "th_x9y8",
          title: request.title ?? "Untitled",
          created: "2026-07-19T10:05:00Z",
          updated: "2026-07-19T10:05:00Z",
          status: "open" as const,
          tags: [],
          parent: request.parent ?? null,
          anchor: request.selector ? "anc_k4f7" : null,
          agent: "none" as const,
          turns: [{ author: "user" as const, ts: "2026-07-19T10:05:00Z", body: request.body }],
        },
        anchorId: request.selector ? "anc_k4f7" : null,
        eventId: null,
      },
      201,
    );
  });

  return createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
}

describe("request bodies never demand a server-defaulted field", () => {
  it("accepts the minimal create-doc body the types allow", async () => {
    const { data, error } = await createTestClient().api.POST("/api/docs", {
      body: minimalCreateDoc,
    });

    expect(error).toBeUndefined();
    expect(data?.frontmatter).toMatchObject({ status: "open", tags: [], due: null });
    expect(data?.path).toBe("data/docs/inbox/mortgage-options.md");
  });

  it("still accepts a body that names every optional field", async () => {
    const { data } = await createTestClient().api.POST("/api/docs", { body: fullCreateDoc });

    expect(data?.path).toBe("data/docs/finance/mortgage-options.md");
    expect(data?.frontmatter.tags).toEqual(["finance"]);
  });

  it("accepts a standalone thread with neither parent nor selector", async () => {
    const { data, error } = await createTestClient().api.POST("/api/threads", {
      body: minimalCreateThread,
    });

    expect(error).toBeUndefined();
    expect(data?.thread.parent).toBeNull();
    expect(data?.anchorId).toBeNull();
  });

  it("accepts a selector carrying only its quote", async () => {
    const { data, error } = await createTestClient().api.POST("/api/threads", {
      body: anchoredCreateThread,
    });

    expect(error).toBeUndefined();
    expect(data?.anchorId).toBe("anc_k4f7");
  });
});
