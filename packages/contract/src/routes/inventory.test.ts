import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contractPackageRoot, OPENAPI_JSON_PATH } from "../generation/artifacts.js";
import { ENDPOINT_INVENTORY, endpointSignature } from "./inventory.js";

interface OpenApiDocument {
  readonly paths: Record<string, Record<string, unknown>>;
}

/**
 * Read from disk rather than rebuilt in memory: this is the surface-completeness
 * check, and what it must hold is that the **committed artifact** every consumer
 * generates its client from declares exactly the pinned inventory.
 * `generation/artifacts.test.ts` separately proves the committed file is current.
 */
const committed = JSON.parse(
  readFileSync(join(contractPackageRoot(), OPENAPI_JSON_PATH), "utf8"),
) as OpenApiDocument;

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;

function committedOperations(): string[] {
  const found: string[] = [];
  for (const [path, item] of Object.entries(committed.paths)) {
    for (const method of HTTP_METHODS) {
      if (method in item) found.push(endpointSignature(method, path));
    }
  }
  return found;
}

describe("endpoint inventory", () => {
  it("names each endpoint once", () => {
    expect(new Set(ENDPOINT_INVENTORY).size).toBe(ENDPOINT_INVENTORY.length);
  });

  it("spells every entry as `METHOD /path`", () => {
    for (const signature of ENDPOINT_INVENTORY) {
      expect(signature).toMatch(/^(GET|POST|PUT|DELETE|PATCH) \/[^ ]*$/);
    }
  });

  it("normalises a method to the inventory's spelling", () => {
    expect(endpointSignature("get", "/api/docs")).toBe("GET /api/docs");
  });
});

/**
 * The test that fails when SPEC.md §9.2 grows and the contract does not — and,
 * from the other side, when a route is declared that nobody asked for.
 */
describe("the committed OpenAPI document matches the pinned inventory", () => {
  it("declares exactly the inventory's method+path set", () => {
    expect(committedOperations().sort()).toEqual([...ENDPOINT_INVENTORY].sort());
  });

  it.each(ENDPOINT_INVENTORY)("declares %s", (signature) => {
    expect(committedOperations()).toContain(signature);
  });

  /** The one adjudicated exemption: it exists at runtime but is deliberately not contract surface. */
  it("leaves /api/openapi.json out of the contract on purpose", () => {
    expect(Object.keys(committed.paths)).not.toContain("/api/openapi.json");
  });

  it("documents that exemption in the top-level description, so it does not read as a gap", () => {
    const description = (committed as unknown as { info: { description: string } }).info
      .description;
    expect(description).toContain("/api/openapi.json");
  });
});
