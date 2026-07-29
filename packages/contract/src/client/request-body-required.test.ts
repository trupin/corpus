import { describe, expect, it } from "vitest";
import type { paths } from "./schema.generated.js";

/**
 * CONTRACT-004. `openapi-typescript` emits `requestBody?:` for any operation
 * whose `requestBody.required` is absent or false, so `client.api.POST("/api/docs")`
 * with no body compiled clean and then 400'd at runtime. These are compile-time
 * probes over the generated `paths`: they fail under `tsc --noEmit`, which is
 * the surface the CLI and the UI actually write against.
 *
 * `BodyIsMandatory` reads the generated types the way a caller does — an
 * optional `requestBody` property admits `undefined`, a mandatory one does not.
 */
type BodyIsMandatory<Operation> = Operation extends { requestBody?: unknown }
  ? undefined extends Operation["requestBody"]
    ? false
    : true
  : never;

/** A body with at least one required field: omitting it can never be the caller's intent. */
const MANDATORY = {
  "POST /api/docs": true satisfies BodyIsMandatory<paths["/api/docs"]["post"]>,
  "PUT /api/docs/{id}": false satisfies BodyIsMandatory<paths["/api/docs/{id}"]["put"]>,
  "POST /api/docs/{id}/move": true satisfies BodyIsMandatory<paths["/api/docs/{id}/move"]["post"]>,
  "POST /api/capture": true satisfies BodyIsMandatory<paths["/api/capture"]["post"]>,
  "POST /api/threads": true satisfies BodyIsMandatory<paths["/api/threads"]["post"]>,
  // The one exemption: `@hono/zod-openapi@1.5.1` cannot validate a two-media-type
  // body that declares itself required. See `RULE_EXEMPTIONS` in ../openapi.test.ts.
  // Dual-media, and mandatory since CONTRACT-005: `routes/turn-append.ts`
  // declares `required: true` and dispatches validation on `content-type`
  // itself, so the generated type no longer admits a bodiless call.
  "POST /api/threads/{id}/turns": true satisfies BodyIsMandatory<
    paths["/api/threads/{id}/turns"]["post"]
  >,
  "POST /api/threads/{id}/seen": false satisfies BodyIsMandatory<
    paths["/api/threads/{id}/seen"]["post"]
  >,
  "POST /api/queue/halt": false satisfies BodyIsMandatory<paths["/api/queue/halt"]["post"]>,
  "POST /api/queue/{id}/fail": false satisfies BodyIsMandatory<
    paths["/api/queue/{id}/fail"]["post"]
  >,
  "POST /api/locks/{docId}": false satisfies BodyIsMandatory<paths["/api/locks/{docId}"]["post"]>,
  "POST /api/jobs/{id}/log": true satisfies BodyIsMandatory<paths["/api/jobs/{id}/log"]["post"]>,
  // CONTRACT-008. Mandatory because *both* branches of the check's request XOR
  // demand a key: there is no bodiless whole-workspace form to fall back to.
  "POST /api/check": true satisfies BodyIsMandatory<paths["/api/check"]["post"]>,
  // Omittable: a bare POST restores the last-known-good version, which is the
  // call an operator recovering a broken loop actually makes.
  "POST /api/skills/{name}/rollback": false satisfies BodyIsMandatory<
    paths["/api/skills/{name}/rollback"]["post"]
  >,
} as const;

describe("the generated client types demand every mandatory body", () => {
  it("marks each body mandatory exactly when its schema has a required field", () => {
    // The `satisfies` clauses above are the assertion; this pins the same table
    // in a form the runner reports on, so a flip shows up as a named failure
    // rather than only as a compile error in someone else's build.
    expect(MANDATORY).toEqual({
      "POST /api/docs": true,
      "PUT /api/docs/{id}": false,
      "POST /api/docs/{id}/move": true,
      "POST /api/capture": true,
      "POST /api/threads": true,
      "POST /api/threads/{id}/turns": true,
      "POST /api/threads/{id}/seen": false,
      "POST /api/queue/halt": false,
      "POST /api/queue/{id}/fail": false,
      "POST /api/locks/{docId}": false,
      "POST /api/jobs/{id}/log": true,
      "POST /api/check": true,
      "POST /api/skills/{name}/rollback": false,
    });
  });
});
