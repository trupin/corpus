import { describe, expect, it } from "vitest";
import * as contract from "./index.js";

/**
 * `apps/server` and `apps/cli` reach the contract only through this entry point,
 * so the barrel is part of the public surface: schemas, route definitions, and
 * the document builder must all be reachable without deep imports.
 */
describe("@corpus/contract entry point", () => {
  it.each([
    "DocSchema",
    "DocFrontmatterSchema",
    "ExtraFrontmatterSchema",
    "ViewQuerySchema",
    "ThreadSchema",
    "TurnSchema",
    "QueueEventSchema",
    "DocumentKeySchema",
    "JobSchema",
    "SearchResultsSchema",
    "RelatedDocsSchema",
    "ApiErrorSchema",
    "InvalidatePayloadSchema",
    "WarningSchema",
    "DocMutationResponseSchema",
  ])("exports the %s resource schema", (name) => {
    expect(contract).toHaveProperty(name);
  });

  it("exports the route registry and the document builder", () => {
    expect(Object.keys(contract.contractRoutes).length).toBeGreaterThan(0);
    expect(contract.buildOpenApiDocument().openapi).toBe("3.1.0");
  });

  it("exports the actor header constant both sides of a mutation agree on", () => {
    expect(contract.ACTOR_HEADER).toBe("x-corpus-author");
    expect(contract.DEFAULT_ACTOR).toBe("user");
  });

  it("exports the query-key vocabulary the server emitter builds from", () => {
    expect(contract.DOCS_KEY).toEqual(["docs"]);
    expect(contract.jobKey("evt_7c1d")).toEqual(["jobs", "evt_7c1d"]);
    expect(Object.keys(contract.QUERY_KEY_VOCABULARY)).toEqual([...contract.QUERY_KEY_NAMES]);
  });

  it("exports the turn-append mounting helper the dual-media route needs", () => {
    expect(typeof contract.mountAppendTurn).toBe("function");
  });
});
