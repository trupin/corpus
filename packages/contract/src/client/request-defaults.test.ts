import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { contractRoutes } from "../routes/index.js";
import { isMultipartThreadCreate, mountCreateThread } from "../routes/thread-create.js";
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

/** The zero-form create from SPEC.md §10: a type and a title, nothing else. */
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
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: { source: "import" },
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
        doc: {
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
            origin: null,
            pinned: request.pinned ?? false,
            order: request.order ?? null,
            query: request.query ?? null,
            column: request.column ?? null,
            extra: request.extra ?? {},
          },
          body: request.body ?? "",
          path: `data/docs/${request.folder ?? "inbox"}/mortgage-options.md`,
          anchors: [],
          // A creation answers with a whole document, so it answers with a key
          // (SPEC.md §7) — the one the caller presents on its first body write.
          key: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde",
          userEditing: false,
        },
        warnings: [],
      },
      201,
    );
  });

  // `mountCreateThread`, not `app.openapi`: the body has two media types, and a
  // `required: true` dual-media body pushes both validators into the chain, so a
  // JSON request would have to satisfy the multipart schema too and 400s.
  mountCreateThread(app, (c) => {
    const request = c.req.valid("json");
    // The validated body is now the union of the two media types, so the first
    // turn's prose is `body` on the JSON half and `text` on the multipart one.
    // These cases send JSON; the narrowing is what makes that explicit.
    const firstTurn = isMultipartThreadCreate(request) ? (request.text ?? "") : request.body;
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
          resident: null,
          turns: [
            { author: "user" as const, ts: "2026-07-19T10:05:00Z", body: firstTurn, model: null },
          ],
        },
        anchorId: request.selector ? "anc_k4f7" : null,
        eventId: null,
        warnings: [],
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
    expect(data?.doc.frontmatter).toMatchObject({ status: "open", tags: [], due: null });
    expect(data?.doc.path).toBe("data/docs/inbox/mortgage-options.md");
    expect(data?.warnings).toEqual([]);
  });

  it("still accepts a body that names every optional field", async () => {
    const { data } = await createTestClient().api.POST("/api/docs", { body: fullCreateDoc });

    expect(data?.doc.path).toBe("data/docs/finance/mortgage-options.md");
    expect(data?.doc.frontmatter.tags).toEqual(["finance"]);
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
