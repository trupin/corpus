import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DoctorWarningKindSchema } from "../schemas/db.js";
import { IndexStatusSchema } from "../schemas/index-maintenance.js";
import { rebuildDb } from "./db.js";
import { getIndexStatus, rebuildIndex } from "./index-maintenance.js";
import { ENDPOINT_INVENTORY } from "./inventory.js";
import { contractRoutes } from "./index.js";

/**
 * `createRoute` returns its own argument object, so these assertions read the
 * definitions directly. `../openapi.test.ts` covers what the *generated
 * document* says; what is checked here is the shape of the declaration itself —
 * chiefly the two absences, which no positive assertion elsewhere would catch.
 */

describe("the semantic-index maintenance pair (CONTRACT-023)", () => {
  it("declares the two endpoints §9.2's index bullet names, spelled as it spells them", () => {
    expect([getIndexStatus.method, getIndexStatus.path]).toEqual(["get", "/api/index/status"]);
    expect([rebuildIndex.method, rebuildIndex.path]).toEqual(["post", "/api/index/rebuild"]);
    expect(ENDPOINT_INVENTORY).toContain("GET /api/index/status");
    expect(ENDPOINT_INVENTORY).toContain("POST /api/index/rebuild");
  });

  it("registers both in the route registry the server mounts handlers against", () => {
    expect(contractRoutes.getIndexStatus).toBe(getIndexStatus);
    expect(contractRoutes.rebuildIndex).toBe(rebuildIndex);
  });

  /**
   * SPEC.md §9.2's index bullet, verbatim: "Both touch only derived runtime
   * state — no workspace file changes, no git commit, **no acting party**."
   * `ActorHeaderSchema` is what a route uses to name one, so the assertion is
   * that neither route declares a `request` at all — no headers, no body, no
   * query. `POST /api/db/rebuild` next door does carry the header, and the
   * contrast is the point: it replaces a workspace-level file.
   *
   * Written as a key check rather than `route.request === undefined` because
   * there is no such property to read: `createRoute` infers the definition's
   * literal type, so a `request` added here would be a *type* change, and
   * `route.request` does not compile today. The runtime assertion is the part a
   * reader can see; the compiler is holding the other half.
   */
  it.each([
    ["GET /api/index/status", getIndexStatus],
    ["POST /api/index/rebuild", rebuildIndex],
  ])("names no acting party on %s", (_signature, route) => {
    expect(Object.keys(route)).not.toContain("request");
  });

  it("diverges from the projection rebuild, which does carry one", () => {
    expect(rebuildDb.request.headers).toBeDefined();
    expect(Object.keys(rebuildIndex)).not.toContain("request");
    expect(rebuildIndex.description).toContain("carries no acting party");
  });

  it("takes no request body, so the whole call is a bodiless POST", () => {
    expect(rebuildIndex.description).toContain("**Takes no request body at all**");
  });

  /**
   * OC8: the rebuild returns before the work finishes, so the only honest thing
   * it can report is what is already true. It answers with the `IndexStatus`
   * snapshot taken immediately after queueing — the same schema `status`
   * returns, so no second shape is invented for an acknowledgement — under
   * `202`, the status code that says accepted-not-completed.
   */
  it("acknowledges with the post-queue snapshot under 202, never a completion promise", () => {
    expect(Object.keys(rebuildIndex.responses)).toEqual(["202", "401"]);
    expect(rebuildIndex.responses[202].content["application/json"].schema).toBe(IndexStatusSchema);
    expect(rebuildIndex.description).toContain("**Returns immediately, before the work is done**");
    expect(rebuildIndex.responses[202].description).toContain("Accepted and queued, not completed");
  });

  it("answers status with the same schema, read-only", () => {
    expect(Object.keys(getIndexStatus.responses)).toEqual(["200", "401"]);
    expect(getIndexStatus.responses[200].content["application/json"].schema).toBe(
      IndexStatusSchema,
    );
    expect(getIndexStatus.description).toContain("Read-only; no acting party.");
  });

  /**
   * Neither route validates any request input, so neither may declare `400` —
   * `../openapi.test.ts` sweeps that rule across the whole document from both
   * directions, and this is the local statement of the same fact.
   */
  it.each([
    ["GET /api/index/status", getIndexStatus],
    ["POST /api/index/rebuild", rebuildIndex],
  ])("declares no 400 on %s, having nothing to validate", (_signature, route) => {
    expect(Object.keys(route.responses)).not.toContain("400");
  });

  it("groups both under one tag, so the document reads as one surface", () => {
    expect(getIndexStatus.tags).toEqual(["index"]);
    expect(rebuildIndex.tags).toEqual(["index"]);
  });

  /**
   * The name is load-bearing rather than cosmetic: `./index.ts` is this
   * directory's barrel, and a second module competing for that name resolves
   * today but becomes a trap on the first rename on a case-insensitive
   * filesystem (sprint-021 C16). Asserted on the filesystem, because the import
   * above would keep working under either name.
   */
  it("lives beside the barrel rather than competing with it for the name", () => {
    const here = readdirSync(import.meta.dirname);
    expect(here).toContain("index-maintenance.ts");
    expect(here).toContain("index.ts");
    expect(Object.keys(contractRoutes)).toContain("getIndexStatus");
  });

  /**
   * OC9 — a doctor warning for a stuck index (`failed > 0`) is a **server**
   * change, not a contract one, and this test is where that is written down so
   * SERVER-046 does not come back here for a kind literal.
   * `DoctorWarningKind` is an open lowercase token by construction
   * (`../schemas/db.ts`), so a kind this contract has never heard of already
   * validates. No literal is added to `DOCTOR_WARNING_KINDS` here.
   */
  it("needs no contract edit for a failed-chunk doctor warning — the kind space is open", () => {
    expect(DoctorWarningKindSchema.safeParse("semantic_index_failures").success).toBe(true);
  });
});
