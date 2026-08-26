// SERVER-031 — an unreadable request body is the caller's mistake, on every
// route, and it is reported as one.
//
// This sweep is driven by `ALL_CONTRACT_ROUTES` rather than by a hand-written
// list, because the defect it pins was never about any particular route: Hono's
// body validator throws `HTTPException(400, "Malformed JSON in request body")`
// before `defaultHook` can see the request, and `toHttpError` did not recognise
// the type — so *every* JSON route in the API answered an empty `POST` body with
// `500 internal_error`. A per-route test would have proved one route fixed; the
// inventory proves the class is closed, and a route added later joins the sweep
// by existing.

import { describe, expect, it } from "vitest";
import { ALL_CONTRACT_ROUTES, ApiErrorSchema } from "@corpus/contract";
import { AUTH, createWriteWorkspace, type WriteWorkspace } from "./docs/write-fixture.js";

/**
 * Path parameters filled with **well-formed but nonexistent** values, so param
 * validation passes and the body is the only thing left to fail on. A malformed
 * id would also produce a 400, from the wrong cause.
 */
const PARAM_VALUES: Readonly<Record<string, string>> = {
  id: "doc_aaaaaaaa",
  docId: "doc_aaaaaaaa",
  ts: "2026-07-27T09:00:00Z",
  name: "sample",
  path: "sample.png",
};

const concretePath = (path: string): string =>
  path
    // `/api/threads/{id}` and `/api/queue/{id}` share the parameter's *name* but
    // not its shape, so the prefix decides.
    .replace("/api/threads/{id}", "/api/threads/th_aaaaaaaa")
    .replace("/api/queue/{id}", "/api/queue/evt_aaaaaaaa")
    .replace("/api/jobs/{id}", "/api/jobs/evt_aaaaaaaa")
    .replace(/\{([^}]+)\}/g, (_match, name: string) => PARAM_VALUES[name] ?? "sample");

type BodyRoute = { readonly signature: string; readonly path: string; readonly method: string };

/**
 * One property of an unknown value. The route definitions' `request` is a union
 * across forty-odd routes, wide enough that TypeScript resolves no member on it
 * — and reading the inventory *structurally*, rather than listing the JSON
 * routes by hand, is the whole point of the sweep.
 */
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;

const declaresJsonBody = (route: object): boolean =>
  field(field(field(field(route, "request"), "body"), "content"), "application/json") !== undefined;

const describeRoute = (route: { readonly method: string; readonly path: string }): BodyRoute => ({
  signature: `${route.method.toUpperCase()} ${route.path}`,
  path: concretePath(route.path),
  method: route.method.toUpperCase(),
});

const MUTATING_METHODS = ["post", "put", "patch"];

/**
 * `POST /api/upgrade` is left out, and it is the only exclusion.
 *
 * It takes no body at all, so it has nothing to prove here — and calling it
 * spawns a real detached `corpus upgrade` on the machine running the suite
 * (SERVER-050). The fixture refuses the path outright for that reason, so
 * including it would fail the sweep rather than start an installer, but the
 * sweep exists to walk every route and a filter that says why is better than a
 * throw that says where.
 */
const REAL_WORLD_ROUTES = new Set(["POST /api/upgrade"]);

const mutatingRoutes = (): BodyRoute[] =>
  ALL_CONTRACT_ROUTES.filter((route) => MUTATING_METHODS.includes(route.method))
    .map(describeRoute)
    .filter((route) => !REAL_WORLD_ROUTES.has(route.signature));

/** The routes that declare a JSON request body — the ones a bad body must 400. */
const jsonBodyRoutes = (): BodyRoute[] =>
  ALL_CONTRACT_ROUTES.filter(
    (route) => MUTATING_METHODS.includes(route.method) && declaresJsonBody(route),
  ).map(describeRoute);

/**
 * A loopback peer, which `POST /api/jobs/{id}/log` requires: it trades bearer
 * auth for peer-address proof (SPEC.md §7, `middleware/localhost.ts`), and
 * without this it is refused `403` before its body is ever read — which would
 * quietly excuse the one route in the sweep from proving anything.
 */
const LOOPBACK_ENV = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

const send = async (ws: WriteWorkspace, route: BodyRoute, body: string): Promise<Response> =>
  ws.server.app.request(
    route.path,
    {
      method: route.method,
      headers: { ...AUTH, "content-type": "application/json" },
      body,
    },
    LOOPBACK_ENV,
  );

describe("an unreadable JSON body is a 400 on every route that takes one", () => {
  // One workspace for the whole sweep: every request is refused before it can
  // write, so no case can observe another's state.
  const withWorkspace = async (run: (ws: WriteWorkspace) => Promise<void>): Promise<void> => {
    const ws = createWriteWorkspace("jsonbody", { sprint: "s014" });
    try {
      await run(ws);
    } finally {
      ws.close();
    }
  };

  it.each([
    ["an empty body", ""],
    ["a truncated object", "{"],
    ["prose", "not json at all"],
    ["a bare comma", ","],
  ])("%s is 400 with the contract's error envelope, on every JSON route", async (_label, body) => {
    await withWorkspace(async (ws) => {
      const routes = jsonBodyRoutes();
      // Guards the sweep itself: an inventory that stopped matching would make
      // every assertion below vacuously true.
      expect(routes.length).toBeGreaterThanOrEqual(10);

      for (const route of routes) {
        const response = await send(ws, route, body);
        expect([route.signature, response.status]).toEqual([route.signature, 400]);
        expect(response.headers.get("content-type")).toContain("application/json");

        const payload: unknown = await response.json();
        const parsed = ApiErrorSchema.safeParse(payload);
        expect([route.signature, parsed.success]).toEqual([route.signature, true]);
        expect([route.signature, parsed.success && parsed.data.code]).toEqual([
          route.signature,
          "bad_request",
        ]);
      }
    });
  });

  it("never answers 500 on any mutating route, whatever the body says", async () => {
    await withWorkspace(async (ws) => {
      // Every declared route in the sweep is now mounted, so nothing here
      // answers a status its own declaration does not name and the
      // `withUndeclaredStatus` opt-out this used to carry is gone. It was for
      // the upgrade pair, which SERVER-050 mounted; the check that would have
      // caught its staleness is what said so.
      for (const route of mutatingRoutes()) {
        for (const body of ["", "{", "[1,2"]) {
          const response = await send(ws, route, body);
          expect([route.signature, body, response.status >= 500]).toEqual([
            route.signature,
            body,
            false,
          ]);
        }
      }
    });
  });

  it("still validates a well-formed body against the schema", async () => {
    // The fix must not turn every body into a 400 by another route: a readable
    // body that fails the schema still reports its field-level issues.
    await withWorkspace(async (ws) => {
      const response = await ws.post("/api/docs", { type: "note" });
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { code: string; issues?: unknown[] };
      expect(payload.code).toBe("bad_request");
      expect(Array.isArray(payload.issues) && payload.issues.length).toBeGreaterThan(0);
    });
  });

  it("leaves a body-less request on a JSON route alone when no content-type claims JSON", async () => {
    // Hono only reads the body when the request says it is JSON, so a `POST`
    // with no content-type reaches the schema with `{}` and fails validation on
    // its fields — not on the parse. Pinned so the fix is not mistaken for
    // "anything without a body is a parse error".
    await withWorkspace(async (ws) => {
      const response = await ws.server.app.request("/api/docs", { method: "POST", headers: AUTH });
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { code: string; issues?: { path: string }[] };
      expect(payload.code).toBe("bad_request");
      expect(payload.issues?.map((issue) => issue.path)).toEqual(["json.type", "json.title"]);
    });
  });
});
