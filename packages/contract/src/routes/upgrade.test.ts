import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createCorpusClient } from "../client/index.js";
import { buildOpenApiDocument } from "../openapi.js";
import { UpgradeCheckSchema, UpgradeStartedSchema } from "../schemas/upgrade.js";
import { rebuildDb } from "./db.js";
import { ENDPOINT_INVENTORY } from "./inventory.js";
import { checkUpgrade, startUpgrade } from "./upgrade.js";
import { contractRoutes } from "./index.js";

/**
 * The on-demand upgrade pair (CONTRACT-027), asserted two ways.
 *
 * `createRoute` returns its own argument object, so the first half reads the
 * definitions directly — chiefly the **absences** (no request, no `400`, no
 * `500`, no progress endpoint), which no positive assertion elsewhere would
 * catch. The second half mounts them on a real `OpenAPIHono` and drives them
 * through the generated typed client, which is what proves the shapes a
 * consumer will actually meet: the honest offline answer, the `202` that names
 * where the report lands, and the one refusal.
 *
 * The prose assertions are not decoration. SPEC.md §2.4 states two rules that
 * cannot be expressed in a schema — the upgrade is on demand and never runs in
 * the background, and a conflict is unresolved work rather than a notice — and
 * the published description is the only place a client author reading the
 * generated document can learn either. Pinning them is how they survive an edit.
 */

const BASE_URL = "http://127.0.0.1:8765";
const LOG_PATH = ".corpus/upgrade.log";

const OFFLINE = {
  installed: "0.3.0",
  latest: null,
  upgradeAvailable: false,
  verifiable: false,
  notesUrl: null,
  reachable: false,
  detail: "could not reach api.github.com (getaddrinfo ENOTFOUND)",
} as const;

const BEHIND = {
  installed: "0.3.0",
  latest: "0.4.0",
  upgradeAvailable: true,
  verifiable: true,
  notesUrl: "https://github.com/trupin/corpus/releases/tag/v0.4.0",
  reachable: true,
  detail: null,
} as const;

/**
 * A server whose GitHub reachability the test chooses, and which — like the real
 * one — refuses a second upgrade while one is in flight.
 */
function createApp(options: { readonly reachable: boolean }): OpenAPIHono {
  const app = new OpenAPIHono();
  let inFlight = false;

  app.openapi(contractRoutes.checkUpgrade, (c) =>
    c.json(options.reachable ? BEHIND : OFFLINE, 200),
  );

  app.openapi(contractRoutes.startUpgrade, (c) => {
    if (inFlight) {
      return c.json(
        {
          code: "conflict" as const,
          message: `An upgrade is already running; its output is in ${LOG_PATH}.`,
        },
        409,
      );
    }
    inFlight = true;
    return c.json({ started: true as const, logPath: LOG_PATH }, 202);
  });

  return app;
}

function createTestClient(options: { readonly reachable: boolean } = { reachable: true }) {
  const app = createApp(options);
  return createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
}

describe("the upgrade pair's declaration (CONTRACT-027)", () => {
  it("declares the two endpoints §2.4's UI sentence implies, at the pinned spellings", () => {
    expect([checkUpgrade.method, checkUpgrade.path]).toEqual(["get", "/api/upgrade/check"]);
    expect([startUpgrade.method, startUpgrade.path]).toEqual(["post", "/api/upgrade"]);
    expect(ENDPOINT_INVENTORY).toContain("GET /api/upgrade/check");
    expect(ENDPOINT_INVENTORY).toContain("POST /api/upgrade");
  });

  it("registers both in the route registry the server mounts handlers against", () => {
    expect(contractRoutes.checkUpgrade).toBe(checkUpgrade);
    expect(contractRoutes.startUpgrade).toBe(startUpgrade);
  });

  /**
   * §9.2's acting-party rule binds a request to the git author of the commit it
   * makes. This request makes none: the server's whole contribution is `spawn`,
   * and the writes and the single attributed commit happen in another process
   * that outlives it. A header here would be a promise nothing keeps, so — as
   * with the index-maintenance pair, though for a different reason — neither
   * route declares a `request` at all.
   *
   * Written as a key check rather than `route.request === undefined` because
   * there is no such property to read: `createRoute` infers the definition's
   * literal type, so a `request` added here would be a *type* change and
   * `route.request` would not compile today. The compiler holds the other half.
   */
  it.each([
    ["GET /api/upgrade/check", checkUpgrade],
    ["POST /api/upgrade", startUpgrade],
  ])("names no acting party and takes no input on %s", (_signature, route) => {
    expect(Object.keys(route)).not.toContain("request");
  });

  it("diverges from the projection rebuild, which does carry one", () => {
    expect(rebuildDb.request.headers).toBeDefined();
    expect(startUpgrade.description).toContain("carries no acting party");
    expect(startUpgrade.description).toContain("**Takes no request body at all**");
  });

  it("answers the check read-only, with nothing but the report and the auth refusal", () => {
    expect(Object.keys(checkUpgrade.responses)).toEqual(["200", "401"]);
    expect(checkUpgrade.responses[200].content["application/json"].schema).toBe(UpgradeCheckSchema);
    expect(checkUpgrade.description).toContain("**Read-only in the strictest sense**");
  });

  /**
   * `202`, because the response is written before the download begins — and the
   * `409`, because two installs racing over one npm prefix is how a working
   * installation becomes a broken one. A `200` here would claim a finished
   * upgrade, which is the one thing this call can never report.
   */
  it("acknowledges the trigger with 202 and declares its single refusal", () => {
    expect(Object.keys(startUpgrade.responses)).toEqual(["202", "401", "409"]);
    expect(startUpgrade.responses[202].content["application/json"].schema).toBe(
      UpgradeStartedSchema,
    );
    expect(startUpgrade.responses[202].description).toContain("Spawned, not completed");
    expect(startUpgrade.responses[409].content["application/json"].schema).toBeDefined();
  });

  /** §2.4's opening constraint, and the only place a document-only reader meets it. */
  it("publishes the on-demand-only rule on the check", () => {
    expect(checkUpgrade.description).toContain("**Only when called**");
    expect(checkUpgrade.description).toContain(
      "never checks for, downloads, or installs anything in the background, and never phones home",
    );
  });

  it("publishes the checksum rule that makes `verifiable` mean something", () => {
    expect(checkUpgrade.description).toContain("`verifiable`");
    expect(startUpgrade.description).toContain("verifies its published checksum");
  });

  /**
   * The rule the rider singled out (user, 2026-08-03: the audience is the
   * agent). It cannot live in a schema — the report is written by another
   * process, minutes later — so the contract's obligation is to say where it
   * lands and what shape it has to take.
   */
  it("publishes the conflict rule, distinctly, on the trigger", () => {
    expect(startUpgrade.description).toContain(
      "**a conflict is unresolved work rather than a notice**",
    );
    expect(startUpgrade.description).toContain("corpus workspace diff <path>");
    expect(startUpgrade.description).toContain("listed apart from both");
    expect(UpgradeStartedSchema.shape.logPath.description).toContain(
      "a conflict is unresolved work rather than a notice",
    );
  });

  /** §2.4's conditional restart, and the ride-through that stands in for progress. */
  it("publishes the restart condition and how completion is observed", () => {
    expect(startUpgrade.description).toContain(
      "if and only if the server was running when the upgrade began",
    );
    expect(startUpgrade.description).toContain("**Completion is observed, not reported.**");
    expect(startUpgrade.description).toContain("normal SSE reconnect");
  });

  it("says why the workspace template sync is not a route of its own", () => {
    expect(checkUpgrade.description).toContain("It reports nothing about the workspace's template");
    expect(startUpgrade.description).toContain("brings the workspace's template files");
  });

  it("carries its own tag into the generated document, so the surface is findable", () => {
    const tag = buildOpenApiDocument().tags?.find((entry) => entry.name === "upgrade");
    expect(tag?.description).toContain("SPEC.md §2.4");
    expect(checkUpgrade.tags).toEqual(["upgrade"]);
    expect(startUpgrade.tags).toEqual(["upgrade"]);
  });
});

describe("the upgrade pair through the generated client", () => {
  it("reports a newer, installable release", async () => {
    const { data, error } = await createTestClient().api.GET("/api/upgrade/check");

    expect(error).toBeUndefined();
    expect(data).toEqual(BEHIND);
  });

  /**
   * The acceptance criterion that matters most: an unreachable GitHub is a
   * described `200`, never a thrown error the UI has to guess at. The typed
   * client hands it back as `data`, so a client branches on `reachable` rather
   * than on a failed request.
   */
  it("hands an unreachable check back as data, not as an error", async () => {
    const { data, error } = await createTestClient({ reachable: false }).api.GET(
      "/api/upgrade/check",
    );

    expect(error).toBeUndefined();
    expect(data?.reachable).toBe(false);
    expect(data?.latest).toBeNull();
    expect(data?.upgradeAvailable).toBe(false);
    // Still known offline: it is a fact about this process, not about GitHub.
    expect(data?.installed).toBe("0.3.0");
    expect(data?.detail).toContain("api.github.com");
  });

  it("acknowledges a trigger with 202 and names where the report will land", async () => {
    const { data, error, response } = await createTestClient().api.POST("/api/upgrade");

    expect(error).toBeUndefined();
    expect(response.status).toBe(202);
    expect(data).toEqual({ started: true, logPath: LOG_PATH });
  });

  it("refuses a second trigger in the house envelope while one is in flight", async () => {
    const client = createTestClient();
    await client.api.POST("/api/upgrade");

    const { data, error, response } = await client.api.POST("/api/upgrade");

    expect(data).toBeUndefined();
    expect(response.status).toBe(409);
    expect(error).toEqual({
      code: "conflict",
      message: `An upgrade is already running; its output is in ${LOG_PATH}.`,
    });
  });
});
