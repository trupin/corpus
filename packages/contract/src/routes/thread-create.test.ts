import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { paths } from "../client/schema.generated.js";
import { buildOpenApiDocument } from "../openapi.js";
import {
  createThread,
  isMultipartThreadCreate,
  isSupportedThreadCreateContentType,
  MISSING_THREAD_BODY_ERROR,
  mountCreateThread,
  THREAD_CREATE_MEDIA_TYPES,
} from "./thread-create.js";

interface CreatedThread {
  readonly thread: { readonly title: string; readonly parent: string | null };
  readonly anchorId: string | null;
}

interface Rejection {
  readonly code: string;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * The route mounted the way a server must mount it. The handler echoes what the
 * validator produced, so every assertion below is about what the contract's own
 * validation saw — not about a double.
 */
function createApp() {
  const app = new OpenAPIHono();
  mountCreateThread(app, (c) => {
    const body = c.req.valid("json");
    const title = isMultipartThreadCreate(body)
      ? `multipart text=${body.text ?? ""} files=${body.files.map((file) => file.name).join("|")} selector=${body.selector?.exact ?? ""}`
      : `json body=${body.body} selector=${body.selector?.exact ?? ""}`;
    return c.json(
      {
        thread: {
          id: "th_x9y8",
          title,
          created: "2026-07-19T10:05:00Z",
          updated: "2026-07-19T10:05:00Z",
          status: "open" as const,
          tags: [],
          parent: body.parent ?? null,
          anchor: body.selector ? "anc_k4f7" : null,
          agent: "none" as const,
          resident: null,
          turns: [],
        },
        anchorId: body.selector ? "anc_k4f7" : null,
        eventId: null,
        warnings: [],
      },
      201,
    );
  });
  return app;
}

const post = (init: RequestInit) =>
  createApp().request("/api/threads", { method: "POST", ...init });

const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const multipart = (form: FormData): RequestInit => ({ body: form });

const png = (name = "shot.png") => new File(["bytes"], name, { type: "image/png" });

/**
 * CONTRACT-009. `POST /api/threads` was JSON-only, so the composer's *Ask* had
 * no way to send an attachment at all — only Capture could. The library builds
 * every declared media type's validator unconditionally when `required` is
 * truthy, so a bare `app.openapi(createThread, …)` would reject both of the
 * route's own forms. The document keeps `required: true`; the helper dispatches.
 */
describe("the dual-media thread-create body", () => {
  it("declares `required: true` with both media types in the generated document", () => {
    const body = buildOpenApiDocument().paths?.["/api/threads"]?.post?.requestBody;
    const declared = body && "content" in body ? body : undefined;

    expect(declared?.required).toBe(true);
    expect(Object.keys(declared?.content ?? {})).toEqual([...THREAD_CREATE_MEDIA_TYPES]);
  });

  it("accepts the JSON form unchanged", async () => {
    const response = await post(json({ body: "Why 6.1%?" }));

    expect(response.status).toBe(201);
    expect(((await response.json()) as CreatedThread).thread.title).toBe(
      "json body=Why 6.1%? selector=",
    );
  });

  it("keeps the JSON form's anchored creation working", async () => {
    const response = await post(
      json({
        body: "Why this figure?",
        parent: "doc_a1b2c3",
        selector: { exact: "a 30-year fixed at 6.1%" },
      }),
    );

    expect(response.status).toBe(201);
    const created = (await response.json()) as CreatedThread;
    expect(created.thread.parent).toBe("doc_a1b2c3");
    expect(created.anchorId).toBe("anc_k4f7");
  });

  it("accepts the multipart form", async () => {
    const form = new FormData();
    form.set("text", "See this.");
    form.append("files", png());

    const response = await post(multipart(form));

    expect(response.status).toBe(201);
    expect(((await response.json()) as CreatedThread).thread.title).toBe(
      "multipart text=See this. files=shot.png selector=",
    );
  });

  it("accepts an attachment-only first turn, which has no `text` at all", async () => {
    const form = new FormData();
    form.append("files", png());

    const response = await post(multipart(form));

    expect(response.status).toBe(201);
    expect(((await response.json()) as CreatedThread).thread.title).toBe(
      "multipart text= files=shot.png selector=",
    );
  });

  it("takes the same repeated files part as capture does", async () => {
    const form = new FormData();
    form.set("text", "two shots");
    form.append("files", png("a.png"));
    form.append("files", png("b.png"));

    const response = await post(multipart(form));

    expect(((await response.json()) as CreatedThread).thread.title).toContain("files=a.png|b.png");
  });

  it("decodes the JSON-encoded selector part into the same shape the JSON body carries", async () => {
    const form = new FormData();
    form.set("text", "why?");
    form.set("parent", "doc_a1b2c3");
    form.set("selector", JSON.stringify({ exact: "a 30-year fixed at 6.1%", prefix: "we " }));

    const response = await post(multipart(form));

    expect(response.status).toBe(201);
    const created = (await response.json()) as CreatedThread;
    expect(created.thread.title).toContain("selector=a 30-year fixed at 6.1%");
    expect(created.anchorId).toBe("anc_k4f7");
  });

  it("rejects a JSON body missing its required field", async () => {
    const response = await post(json({ title: "No first turn" }));
    expect(response.status).toBe(400);
  });

  /**
   * CONTRACT-017, and the eval that filed it: `anchor: {quote: …}` instead of
   * the declared `selector: {exact: …}` used to yield a 200 with a silently
   * unanchored thread. A typoed key is a 400, not a different mutation.
   */
  it("rejects an unknown top-level key on the JSON form instead of silently dropping it", async () => {
    const response = await post(
      json({ body: "Why 6.1%?", parent: "doc_a1b2c3", anchor: { quote: "6.1%" } }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown part on the multipart form", async () => {
    const form = new FormData();
    form.set("text", "See this.");
    form.set("anchor", JSON.stringify({ quote: "6.1%" }));

    expect((await post(multipart(form))).status).toBe(400);
  });

  it("rejects a multipart body carrying neither text nor files", async () => {
    const response = await post(multipart(new FormData()));
    expect(response.status).toBe(400);
  });

  it.each([
    ["a part that is not JSON at all", "{not json"],
    ["JSON that is not an object", '"a string"'],
    ["a selector with no quote", JSON.stringify({ prefix: "we " })],
    ["a selector whose quote is empty", JSON.stringify({ exact: "" })],
  ])("rejects %s in the selector part", async (_name, selector) => {
    const form = new FormData();
    form.set("text", "why?");
    form.set("selector", selector);

    expect((await post(multipart(form))).status).toBe(400);
  });

  it("rejects a request with no body and no content-type", async () => {
    const response = await post({});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(MISSING_THREAD_BODY_ERROR);
  });

  it("rejects a body sent under a media type the route does not declare", async () => {
    const response = await post({
      headers: { "content-type": "text/plain" },
      body: "Why 6.1%?",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(MISSING_THREAD_BODY_ERROR);
  });

  it("tolerates a charset parameter and odd casing on the content-type", async () => {
    const response = await post({
      headers: { "content-type": "APPLICATION/JSON; charset=utf-8" },
      body: JSON.stringify({ body: "Why 6.1%?" }),
    });
    expect(response.status).toBe(201);
  });

  it("routes a validator rejection through the app's own shape", async () => {
    const form = new FormData();
    const response = await post(multipart(form));
    expect((await response.json()) as Rejection).toBeDefined();
  });
});

describe("the generated client's view of the thread-create body", () => {
  /**
   * Compile-time assertion. Were the body to go optional to satisfy the library,
   * `undefined` would become assignable, `ThreadBodyIsMandatory` would resolve to
   * `never`, and this would fail `tsc --noEmit` rather than a test run — which is
   * the point: `client.api.POST("/api/threads")` with no body must not compile.
   */
  type ThreadRequestBody = paths["/api/threads"]["post"]["requestBody"];
  type ThreadBodyIsMandatory = undefined extends ThreadRequestBody ? never : true;

  it("types the request body as mandatory", () => {
    const mandatory: ThreadBodyIsMandatory = true;
    expect(mandatory).toBe(true);
  });

  it("declares 413 on the route the client can now upload through", () => {
    const responses = buildOpenApiDocument().paths?.["/api/threads"]?.post?.responses ?? {};
    // `422` joined with CONTRACT-050: a `job` naming no event (SPEC.md §9.2).
    expect(Object.keys(responses).sort()).toEqual(["201", "400", "401", "404", "413", "422"]);
  });
});

describe("the thread-create content-type helpers", () => {
  it.each([
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["multipart/form-data; boundary=abc", true],
    ["text/plain", false],
    ["", false],
  ])("reads %s as supported=%s", (contentType, supported) => {
    expect(isSupportedThreadCreateContentType(contentType)).toBe(supported);
  });

  it("treats an absent content-type as unsupported", () => {
    expect(isSupportedThreadCreateContentType(undefined)).toBe(false);
  });

  it("discriminates the two validated forms on `files`", () => {
    expect(isMultipartThreadCreate({ body: "text" })).toBe(false);
    expect(isMultipartThreadCreate({ files: [] })).toBe(true);
  });

  it("publishes the media types in the order the document declares them", () => {
    expect(THREAD_CREATE_MEDIA_TYPES).toEqual(["application/json", "multipart/form-data"]);
  });

  it("names the route path the server mounts", () => {
    expect(createThread.path).toBe("/api/threads");
    expect(createThread.method).toBe("post");
  });
});
