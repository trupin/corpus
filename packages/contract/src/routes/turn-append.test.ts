import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";
import type { paths } from "../client/schema.generated.js";
import {
  MISSING_TURN_BODY_ERROR,
  TURN_APPEND_MEDIA_TYPES,
  appendTurn,
  isMultipartTurn,
  isSupportedTurnContentType,
  mountAppendTurn,
} from "./turn-append.js";

const threadSummary = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  status: "open" as const,
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged" as const,
  resident: null,
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  turnCount: 2,
  lastAuthor: "user" as const,
  lastTs: "2026-07-19T10:07:12Z",
};

interface AppendedTurn {
  readonly turn: { readonly body: string };
}

interface Rejection {
  readonly code: string;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * The route mounted the way a server will mount it. The handler echoes what the
 * validator produced, so every assertion below is about what the contract's own
 * validation saw — not about a double.
 */
function createApp(): OpenAPIHono {
  // Mirrors the server's own `defaultHook`, so a validation failure here renders
  // as the contract's `ValidationError` rather than the library's raw shape.
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

  mountAppendTurn(app, (c) => {
    const validated = c.req.valid("form");
    const body = isMultipartTurn(validated)
      ? `multipart text=${validated.text ?? ""} files=${validated.files
          .map((file) => file.name)
          .join("|")} requestsAgent=${String(validated.requestsAgent)}`
      : `json body=${validated.body} requestsAgent=${String(validated.requestsAgent)}`;

    return c.json(
      {
        thread: threadSummary,
        turn: { author: "user" as const, ts: threadSummary.lastTs, body, model: null },
        eventId: null,
        warnings: [],
      },
      201,
    );
  });

  return app;
}

const post = async (init: RequestInit): Promise<Response> =>
  createApp().request("/api/threads/th_x9y8/turns", { method: "POST", ...init });

const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const multipart = (form: FormData): RequestInit => ({ body: form });

/**
 * The whole point of the helper. `@hono/zod-openapi@1.5.1` mounts every media
 * type's validator unconditionally when `required` is truthy, so a bare
 * `app.openapi(appendTurn, …)` would reject both of the route's own forms. The
 * document keeps `required: true`; the helper does the dispatching.
 */
describe("the dual-media turn-append body", () => {
  it("declares `required: true` with both media types in the generated document", () => {
    const body = buildOpenApiDocument().paths?.["/api/threads/{id}/turns"]?.post?.requestBody;
    const declared = body && "content" in body ? body : undefined;

    expect(declared?.required).toBe(true);
    expect(Object.keys(declared?.content ?? {})).toEqual([...TURN_APPEND_MEDIA_TYPES]);
  });

  it("accepts the JSON form", async () => {
    const response = await post(json({ body: "A plain reply.", requestsAgent: true }));

    expect(response.status).toBe(201);
    expect(((await response.json()) as AppendedTurn).turn.body).toBe(
      "json body=A plain reply. requestsAgent=true",
    );
  });

  it("accepts the multipart form", async () => {
    const form = new FormData();
    form.set("text", "See the rate sheet.");
    form.set("requestsAgent", "false");
    form.append("files", new File(["bytes"], "rates.pdf", { type: "application/pdf" }));

    const response = await post(multipart(form));

    expect(response.status).toBe(201);
    expect(((await response.json()) as AppendedTurn).turn.body).toBe(
      "multipart text=See the rate sheet. files=rates.pdf requestsAgent=false",
    );
  });

  it("accepts an attachment-only multipart turn, which has no `text` at all", async () => {
    const form = new FormData();
    form.append("files", new File(["bytes"], "rates.pdf", { type: "application/pdf" }));

    const response = await post(multipart(form));

    expect(response.status).toBe(201);
    expect(((await response.json()) as AppendedTurn).turn.body).toContain("files=rates.pdf");
  });

  it("rejects a JSON body missing its required field", async () => {
    const response = await post(json({ requestsAgent: true }));
    const rejection = (await response.json()) as Rejection;

    expect(response.status).toBe(400);
    expect(rejection.issues?.length ?? 0).toBeGreaterThan(0);
  });

  it("rejects a multipart body carrying neither text nor files", async () => {
    const form = new FormData();
    form.set("requestsAgent", "true");

    const response = await post(multipart(form));
    const rejection = (await response.json()) as Rejection;

    expect(response.status).toBe(400);
    expect(rejection.issues?.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * The half `required: false` used to give away: with no validator to fire, the
   * library let a bodiless request reach the handler with `{}`. The guard puts
   * the mandatoriness back.
   */
  it("rejects a request with no body and no content-type", async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(MISSING_TURN_BODY_ERROR);
  });

  it("rejects a body sent under a media type the route does not declare", async () => {
    const response = await post({
      headers: { "content-type": "text/plain" },
      body: "A plain reply.",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(MISSING_TURN_BODY_ERROR);
  });

  it("tolerates a charset parameter and odd casing on the content-type", async () => {
    const response = await createApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      headers: { "content-type": "Application/JSON; charset=utf-8" },
      body: JSON.stringify({ body: "A plain reply." }),
    });

    expect(response.status).toBe(201);
  });

  it("still validates the path parameter, so a malformed thread id is a 400", async () => {
    const response = await createApp().request("/api/threads/doc_a1b2c3/turns", {
      method: "POST",
      ...json({ body: "A plain reply." }),
    });

    expect(response.status).toBe(400);
  });

  it("routes a validator rejection through the app's defaultHook, like any mounted route", async () => {
    const app = new OpenAPIHono({
      defaultHook: (result, c) =>
        result.success ? undefined : c.json({ code: "custom", issues: [] }, 400),
    });
    mountAppendTurn(app, (c) =>
      c.json(
        {
          thread: threadSummary,
          turn: { author: "user" as const, ts: "2026-07-19T10:09:00Z", body: "", model: null },
          eventId: null,
          warnings: [],
        },
        201,
      ),
    );

    // A malformed JSON body reaches a real validator, so the hook formats it.
    const response = await app.request("/api/threads/th_x9y8/turns", {
      method: "POST",
      ...json({}),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).code).toBe("custom");
  });
});

describe("the generated client's view of the turn-append body", () => {
  /**
   * Compile-time assertion, and the loss CONTRACT-004 escalated. Were the body
   * to go back to optional, `undefined` would become assignable, `TurnBodyIsMandatory`
   * would resolve to `never`, and this would fail `tsc --noEmit` rather than a
   * test run — which is the point: `client.api.POST("/api/threads/{id}/turns")`
   * with no body must not compile.
   */
  type TurnRequestBody = paths["/api/threads/{id}/turns"]["post"]["requestBody"];
  type TurnBodyIsMandatory = undefined extends TurnRequestBody ? never : true;

  it("types the request body as mandatory", () => {
    const mandatory: TurnBodyIsMandatory = true;
    expect(mandatory).toBe(true);
  });
});

describe("the turn-append content-type helpers", () => {
  it.each([
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["APPLICATION/JSON", true],
    ["application/vnd.corpus+json", true],
    ["multipart/form-data", true],
    ["multipart/form-data; boundary=abc", true],
    ["text/plain", false],
    ["application/x-www-form-urlencoded", false],
    ["", false],
  ])("reads %s as supported=%s", (contentType, supported) => {
    expect(isSupportedTurnContentType(contentType)).toBe(supported);
  });

  it("treats an absent content-type as unsupported", () => {
    expect(isSupportedTurnContentType(undefined)).toBe(false);
  });

  it("discriminates the two validated forms on `files`", () => {
    expect(isMultipartTurn({ body: "text" })).toBe(false);
    expect(isMultipartTurn({ files: [] })).toBe(true);
  });

  it("publishes the media types in the order the document declares them", () => {
    expect(TURN_APPEND_MEDIA_TYPES).toEqual(["application/json", "multipart/form-data"]);
  });

  it("names the route path the server mounts", () => {
    expect(appendTurn.path).toBe("/api/threads/{id}/turns");
    expect(appendTurn.method).toBe("post");
  });
});
