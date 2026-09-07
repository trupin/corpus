/**
 * SPEC.md §9.4's two endpoints, bound to the contract's own route definitions:
 * the report going in, and one document's series coming out.
 *
 * The two are asymmetric on purpose, and the asymmetry is §9.4's. Ingestion is a
 * channel the spec requires to be free — "a report that fails to arrive costs
 * the command nothing and is never retried" — so it reads nothing, refuses
 * nothing it could plausibly keep, answers `204` with no body, and promises no
 * idempotency: a repeat is recorded a second time. The series is an ordinary
 * bounded projection read with the ordinary `400`/`404` of a document
 * subresource.
 *
 * **Neither announces anything.** No SSE frame, no new query key (sprint-025
 * R8). A frame per `corpus` invocation would put the telemetry channel on the
 * hot path it exists to measure, so a report does not update an open panel — the
 * panel refetches on the document frames that already exist.
 *
 * **Neither has an acting party.** Nothing here writes a workspace file, makes a
 * commit or produces a queue event, which is why the contract declares no
 * `x-corpus-author` on either.
 *
 * Authentication is not wired here and must not be: `app.use("/api/*", …)` in
 * `app.ts` covers every route under the prefix, so a new endpoint is protected
 * by mounting rather than by remembering.
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { recordInvocations } from "./record.js";
import { documentCost } from "./series.js";

export interface TelemetryRoutesOptions {
  /** Injected so the ledger's start stamp is testable against a fixed clock. */
  readonly now?: (() => number) | undefined;
}

export function mountTelemetryRoutes(
  app: OpenAPIHono,
  db: ProjectionDb,
  options: TelemetryRoutesOptions = {},
): void {
  const now = options.now ?? Date.now;

  // The whole handler, deliberately. Everything that could make this expensive
  // — deciding which document a row belongs to, converting bytes to tokens,
  // bucketing, bounding — happens on the read below instead.
  app.openapi(contractRoutes.reportInvocations, (c) => {
    recordInvocations(db, c.req.valid("json"), now);
    return c.body(null, 204);
  });

  app.openapi(contractRoutes.getDocCost, (c) =>
    c.json(documentCost(db, c.req.valid("param").id, c.req.valid("query").limit, now()), 200),
  );
}
