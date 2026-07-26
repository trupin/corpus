import { describe, expect, it } from "vitest";
import { BEARER_SECURITY_SCHEME, buildOpenApiDocument, CONTRACT_VERSION } from "./openapi.js";
import { ALL_CONTRACT_ROUTES } from "./routes/index.js";

const document = buildOpenApiDocument();

/** Every endpoint CONTRACT-001 declares. Growing the surface must be a deliberate edit here. */
const EXPECTED_OPERATIONS = [
  "get /api/docs",
  "post /api/docs",
  "get /api/docs/{id}",
  "put /api/docs/{id}",
  "get /api/health",
  "post /api/queue/claim-all",
  "get /api/queue/status",
  "post /api/queue/{id}/complete",
  "post /api/queue/{id}/fail",
  "post /api/threads",
  "get /api/threads/{id}",
  "post /api/threads/{id}/turns",
  "get /events",
];

function operations(): string[] {
  const found: string[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      if (item && method in item) found.push(`${method} ${path}`);
    }
  }
  return found.sort();
}

describe("generated OpenAPI document", () => {
  it("is an OpenAPI 3.1 document stamped with the contract version", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe(CONTRACT_VERSION);
  });

  it("declares exactly the endpoints the contract defines", () => {
    expect(operations()).toEqual([...EXPECTED_OPERATIONS].sort());
  });

  it("documents one operation per route definition", () => {
    expect(operations()).toHaveLength(ALL_CONTRACT_ROUTES.length);
  });

  it("requires the workspace bearer token by default", () => {
    expect(document.components?.securitySchemes?.[BEARER_SECURITY_SCHEME]).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(document.security).toEqual([{ [BEARER_SECURITY_SCHEME]: [] }]);
  });

  it.each([
    ["/api/health", "get"],
    ["/events", "get"],
  ])("exempts %s %s from auth, as SPEC.md §2.1 allows", (path, method) => {
    const operation = document.paths?.[path]?.[method as "get"];
    expect(operation?.security).toEqual([]);
  });

  it("declares 401 on every authenticated operation", () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item?.[method];
        if (!operation || operation.security?.length === 0) continue;
        if (!operation.responses?.["401"]) missing.push(`${method} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * `@hono/zod-openapi` validates every declared path parameter, query
   * parameter, header and body before the handler runs and answers `400` when
   * validation fails. An operation that takes validated input but does not
   * declare `400` therefore publishes an error union that cannot represent one
   * of its own real responses, and the generated client silently loses the
   * ability to narrow it.
   */
  it("declares 400 on every operation that validates request input", () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item?.[method];
        if (!operation) continue;
        const validatesInput =
          (operation.parameters?.length ?? 0) > 0 || operation.requestBody !== undefined;
        if (!validatesInput) continue;
        if (!operation.responses?.["400"]) missing.push(`${method} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("does not declare 400 on operations that take no request input", () => {
    const spurious: string[] = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item?.[method];
        if (!operation) continue;
        const validatesInput =
          (operation.parameters?.length ?? 0) > 0 || operation.requestBody !== undefined;
        if (!validatesInput && operation.responses?.["400"]) spurious.push(`${method} ${path}`);
      }
    }
    expect(spurious).toEqual([]);
  });

  it("documents the SSE stream as an event stream, not as JSON", () => {
    // openapi3-ts types the status-code map with an `any`-valued index
    // signature, so the 200 entry is re-read through a minimal structural view.
    const ok = document.paths?.["/events"]?.get?.responses?.["200"] as
      { content?: Record<string, unknown> } | undefined;
    expect(Object.keys(ok?.content ?? {})).toEqual(["text/event-stream"]);
  });

  /**
   * zod-to-openapi propagates a schema's registered name onto anything derived
   * from it, so `Named.nullable()` or `Named.default(x)` silently rewrites the
   * component definition. Resource components are always plain objects, so this
   * invariant catches that class of corruption before it reaches a client.
   */
  it("keeps every named component a plain, non-nullable, undefaulted object", () => {
    const corrupted = Object.entries(document.components?.schemas ?? {}).filter(
      ([, schema]) =>
        typeof schema !== "object" ||
        schema === null ||
        "$ref" in schema ||
        schema.type !== "object" ||
        schema.default !== undefined,
    );
    expect(corrupted.map(([name]) => name)).toEqual([]);
  });
});
