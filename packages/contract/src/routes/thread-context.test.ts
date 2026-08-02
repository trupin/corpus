import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { ContextPackSchema } from "../schemas/context.js";
import { contractRoutes } from "./index.js";
import { ENDPOINT_INVENTORY } from "./inventory.js";
import { getThread, getThreadContext } from "./threads.js";

/**
 * `createRoute` returns its own argument object, so these assertions read the
 * definition directly. `../openapi.test.ts` covers what the *generated document*
 * says; what is checked here is the declaration — chiefly its absences, which no
 * positive assertion elsewhere would catch: no acting party, no request body,
 * and no query surface at all.
 */

describe("GET /api/threads/{id}/context (CONTRACT-024)", () => {
  it("is spelled as §9.2 spells it, and is in the pinned inventory", () => {
    expect([getThreadContext.method, getThreadContext.path]).toEqual([
      "get",
      "/api/threads/{id}/context",
    ]);
    expect(ENDPOINT_INVENTORY).toContain("GET /api/threads/{id}/context");
  });

  it("sits directly after the thread read, where §9.2's bullet order puts it", () => {
    const entries = [...ENDPOINT_INVENTORY];
    expect(entries[entries.indexOf("GET /api/threads/{id}") + 1]).toBe(
      "GET /api/threads/{id}/context",
    );
  });

  it("registers in the route registry the server mounts handlers against", () => {
    expect(contractRoutes.getThreadContext).toBe(getThreadContext);
  });

  it("groups under the thread tag, since the pack is a property of a conversation", () => {
    expect(getThreadContext.tags).toEqual(["threads"]);
  });

  /**
   * TEST-952. SPEC.md's §9.2 bullet ends "Read-only; no acting party", and the
   * definition says it too: the only `request` member is the path parameter.
   * `ActorHeaderSchema` is how a route names an acting party, and there is no
   * `headers` key to hold one.
   */
  it("declares no acting party and no request body", () => {
    expect(Object.keys(getThreadContext.request)).toEqual(["params"]);
    expect(JSON.stringify(getThreadContext.request)).not.toContain(ACTOR_HEADER);
    expect(getThreadContext.description).toContain("Read-only; no acting party");
  });

  /**
   * TEST-955. CLI-021 promises "no flags beyond `--json` in v1 — the bounds live
   * in the contract", and a query parameter here would make that false. The
   * parameter list is the path id and nothing else.
   */
  it("takes the thread id in the path and nothing else — no limit, no includeArchived", () => {
    expect(Object.keys(getThreadContext.request.params.shape)).toEqual(["id"]);
    expect(Object.keys(getThreadContext.request)).not.toContain("query");
    expect(getThreadContext.description).toContain("**No query parameters**");
  });

  it("answers with the context pack union, and declares the codes a read can produce", () => {
    expect(Object.keys(getThreadContext.responses)).toEqual(["200", "400", "401", "404"]);
    expect(getThreadContext.responses[200].content["application/json"].schema).toBe(
      ContextPackSchema,
    );
  });

  /**
   * TEST-952's second half: the 404 and 401 bodies are the shipped shared
   * envelopes `getThread` already uses, not a second pair invented for a new
   * read.
   */
  it("reuses the shared not-found and unauthorized envelopes the thread read uses", () => {
    expect(getThreadContext.responses[404]).toBe(getThread.responses[404]);
    expect(getThreadContext.responses[401]).toBe(getThread.responses[401]);
    expect(getThreadContext.responses[400]).toBe(getThread.responses[400]);
  });

  /**
   * TEST-953. `GET /api/threads/{id}` already rules that a document which exists
   * but is not a thread is a 404 on *this* surface rather than a 400. One
   * doctrine, not two — so the pack route states the same rule rather than
   * leaving a caller to discover it.
   */
  it("documents the non-thread id as a 404, matching the thread read's shipped rule", () => {
    expect(getThreadContext.description).toContain(
      "A document that exists but is not a thread is a `404` on this surface rather than a `400`",
    );
  });

  /**
   * Open Conflict 9. The deleted-parent case is the one a naive implementation
   * gets wrong — `loadDocument` on a deleted parent throws the contract's 404,
   * which must not become the *thread's* answer. The route says so where a
   * server author reads it.
   */
  it("states that a deleted parent is a 200 about a thread that exists, never a 404", () => {
    expect(getThreadContext.description).toContain("parent-deleted");
    expect(getThreadContext.description).toContain("still a `200`");
  });

  /** Open Conflict 1: the cut is stated, never silent. */
  it("states the truncation contract, so an agent knows when to escalate", () => {
    expect(getThreadContext.description).toContain("truncated around the anchor");
    expect(getThreadContext.description).toContain("`GET /api/docs/{id}`");
  });

  /** Open Conflict 3 / C6: one workspace, one staleness word across all three surfaces. */
  it("points the degrade word at the same word the other two ranked surfaces report", () => {
    expect(getThreadContext.description).toContain("semanticIndex");
    expect(getThreadContext.description).toContain("/api/search");
    expect(getThreadContext.description).toContain("/api/docs/{id}/related");
  });

  it("states the bound in the route's own prose, since that is the endpoint's reason to exist", () => {
    expect(getThreadContext.description).toContain(
      "reading a pack costs roughly the same however large the corpus grows",
    );
  });
});
