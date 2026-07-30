import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createCorpusClient } from "../client/index.js";
import type { paths } from "../client/schema.generated.js";
import { CHECK_CODES, CHECK_REQUEST_XOR_MESSAGE } from "../schemas/check.js";
import { contractRoutes } from "./index.js";

/**
 * `POST /api/check` exercised through the real route definition and the
 * generated typed client. The handler is canned, but everything asserted below
 * is the contract's own work: the XOR, the closed code vocabulary and the
 * severity split all belong to the schema, and SERVER-019 inherits them rather
 * than re-deciding them.
 */

const BASE_URL = "http://127.0.0.1:8765";

interface Rejection {
  readonly code: string;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/** Mirrors the server's own `defaultHook`, so a rejection renders as `ValidationError`. */
function createApp(): OpenAPIHono {
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

  // The report is derived from what the validator handed the handler, so every
  // assertion below is about the request the contract actually parsed.
  app.openapi(contractRoutes.checkDocuments, (c) => {
    const body = c.req.valid("json");
    if ("ids" in body) {
      return c.json(
        {
          ok: true,
          errors: [],
          warnings: body.ids.map((id) => ({
            code: "ref-unresolved" as const,
            severity: "warning" as const,
            docId: id,
            path: `data/docs/${id}.md`,
            detail: "reference `[[doc_zzz]]` does not resolve to a document in the corpus",
          })),
        },
        200,
      );
    }
    return c.json(
      {
        ok: false,
        errors: body.documents.map((entry) => ({
          code: "frontmatter-unparseable" as const,
          severity: "error" as const,
          docId: null,
          path: entry.path,
          detail: `staged bytes: ${String(entry.content.length)}`,
        })),
        warnings: [],
      },
      200,
    );
  });

  return app;
}

function createTestClient() {
  return createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => createApp().fetch(new Request(input, init)),
  });
}

describe("the check route's request validation", () => {
  it("accepts the ids form and hands the ids to the handler", async () => {
    const { data, error } = await createTestClient().api.POST("/api/check", {
      body: { ids: ["doc_a1b2c3", "th_x9y8"] },
    });

    expect(error).toBeUndefined();
    expect(data?.ok).toBe(true);
    expect(data?.warnings.map((finding) => finding.docId)).toEqual(["doc_a1b2c3", "th_x9y8"]);
  });

  it("accepts the staged-content form and hands the bytes to the handler", async () => {
    const { data, error } = await createTestClient().api.POST("/api/check", {
      body: { documents: [{ path: "data/docs/mortgage.md", content: "12345" }] },
    });

    expect(error).toBeUndefined();
    expect(data?.ok).toBe(false);
    expect(data?.errors[0]).toMatchObject({
      code: "frontmatter-unparseable",
      severity: "error",
      docId: null,
      path: "data/docs/mortgage.md",
      detail: "staged bytes: 5",
    });
  });

  it.each([
    ["an empty id list", { ids: [] }],
    ["an empty document list", { documents: [] }],
  ])("returns an empty report for %s", async (_label, body) => {
    const response = await createApp().request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    const report = (await response.json()) as { errors: unknown[]; warnings: unknown[] };
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  /**
   * The XOR is the route's own validator refusing, not a handler branching: the
   * rejection is the standard `400` + `issues[]`, and no handler ran.
   */
  it.each([
    ["both forms", { ids: ["doc_a1b2c3"], documents: [] }],
    ["neither form", {}],
    ["an unknown key", { ids: [], scope: "workspace" }],
    ["a malformed id", { ids: ["anc_k4f7"] }],
    ["a pair missing its content", { documents: [{ path: "data/docs/x.md" }] }],
  ])("rejects %s with a 400 naming the offending body", async (_label, body) => {
    const response = await createApp().request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    const rejection = (await response.json()) as Rejection;
    expect(rejection.code).toBe("bad_request");
    expect(rejection.issues?.length).toBeGreaterThan(0);
    expect(rejection.issues?.every((issue) => issue.path.startsWith("json"))).toBe(true);
  });

  /**
   * The XOR rejection has to say which rule was broken. Zod reports a failed
   * union as one top-level issue, so without the schema's own message the
   * caller would receive "Invalid input" and nothing else.
   */
  it.each([
    ["both forms", { ids: ["doc_a1b2c3"], documents: [] }],
    ["neither form", {}],
  ])("explains the XOR when the request names %s", async (_label, body) => {
    const response = await createApp().request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const rejection = (await response.json()) as Rejection;
    expect(rejection.issues?.[0]).toEqual({ path: "json", message: CHECK_REQUEST_XOR_MESSAGE });
  });

  it("rejects a bodiless call, since there is no implicit everything form", async () => {
    expect((await createApp().request("/api/check", { method: "POST" })).status).toBe(400);
  });
});

/**
 * Compile-time probes over the generated `paths`. They fail under `tsc --noEmit`
 * rather than at runtime, which is the surface the CLI and the UI write against.
 */
describe("the generated client types describe the check surface", () => {
  type JsonBody<Body> = Body extends { content: { "application/json": infer Shape } }
    ? Shape
    : never;
  type CheckBody = JsonBody<NonNullable<paths["/api/check"]["post"]["requestBody"]>>;
  type CheckOk = JsonBody<paths["/api/check"]["post"]["responses"][200]>;

  const idsForm: CheckBody = { ids: ["doc_a1b2c3"] };
  const stagedForm: CheckBody = {
    documents: [{ path: "data/docs/mortgage.md", content: "---\n---\n" }],
  };

  it("types both branches of the request union", () => {
    expect(idsForm).toEqual({ ids: ["doc_a1b2c3"] });
    expect(stagedForm.documents).toHaveLength(1);
  });

  it("rejects a wrong-shaped body at compile time", () => {
    // @ts-expect-error `ids` is a list of document ids, not a count. The
    // `@ts-expect-error` *is* the assertion: it fails to compile if the
    // generated types ever stop catching this.
    const wrongType: CheckBody = { ids: 3 };
    // @ts-expect-error a staged pair without its content is not a pair.
    const missingField: CheckBody = { documents: [{ path: "data/docs/x.md" }] };

    expect([wrongType, missingField]).toHaveLength(2);
  });

  it("types the report's closed code vocabulary", () => {
    const codes: CheckOk["errors"][number]["code"][] = [...CHECK_CODES];
    expect(codes).toHaveLength(13);

    // @ts-expect-error the code enum is closed; an unlisted code is not one.
    const unknownCode: CheckOk["errors"][number]["code"] = "vibes-off";
    expect(unknownCode).toBe("vibes-off");
  });
});
