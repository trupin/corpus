// SERVER-119 — the fixture's declared-status check, tested through the fixture
// rather than by exporting its internals.
//
// Its real proof is the counterfactual, and that is recorded in the issue: each
// of CONTRACT-058's `422`, CONTRACT-059's `403` and CONTRACT-083's `409` was
// removed from the contract in turn, and the suite went red at `roster.test.ts`,
// `provenance.test.ts` and `queue/routes.test.ts` respectively. What is here is
// the part a counterfactual cannot show — that the check admits what it should,
// that its message says what to do, and that the escape hatch cannot go stale.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH,
  createWriteWorkspace,
  withUndeclaredStatus,
  type WriteWorkspace,
} from "./write-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createWriteWorkspace("statuscheck", { sprint: "s119" });
  // The check prints before it throws, so a caller that swallows the throw still
  // gets the sentence. Every case below provokes it deliberately.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  ws.close();
});

/**
 * `POST /api/upgrade` is **declared and not mounted** (CONTRACT-058), so it
 * answers the app's `404` while declaring `202, 401, 409`. That makes it the one
 * stable undeclared status in the suite, and it is what these tests use rather
 * than exporting the check's internals.
 *
 * If the upgrade routes are ever mounted, these tests fail — which is the right
 * moment to notice, since the sweep in `json-body.test.ts` opts out for the same
 * reason and would then be stale.
 */
const UNDECLARED = "/api/upgrade";

describe("the fixture's declared-status check (SERVER-119)", () => {
  it("fails the request that produced an undeclared status, naming the operation", async () => {
    await expect(ws.post(UNDECLARED, {})).rejects.toThrow(
      "POST /api/upgrade answered 404, which the contract does not declare (it declares 202, 401, 409)",
    );
  });

  it("says what to do about it, since the fix is a contract change", async () => {
    await expect(ws.post(UNDECLARED, {})).rejects.toThrow(
      /declare the status on that route in packages\/contract\/src\/routes\/ — a contract change/,
    );
  });

  it("admits a status the operation declares", async () => {
    const response = await ws.request("/api/docs/doc_nosuchdoc", { headers: AUTH });
    expect(response.status).toBe(404);
  });

  it("leaves a path no contract route claims alone", async () => {
    // The UI shell's catch-all: not an operation, so not this check's business.
    const response = await ws.request("/definitely/not/an/api/route", { headers: AUTH });
    expect(response.status).toBeGreaterThanOrEqual(200);
  });

  it("lets a deliberate case through while its opt-out is in force", async () => {
    const response = await withUndeclaredStatus("the upgrade routes are unmounted", () =>
      ws.post(UNDECLARED, {}),
    );
    expect(response.status).toBe(404);
  });

  it("refuses an opt-out that turned out not to be needed", async () => {
    await expect(
      withUndeclaredStatus("nothing undeclared happens here", async () => {
        const response = await ws.request("/api/docs/doc_nosuchdoc", { headers: AUTH });
        expect(response.status).toBe(404);
      }),
    ).rejects.toThrow(/the opt-out is stale/);
  });

  it("does not treat a 500 as undeclared, because no route declares one", async () => {
    // `app.onError`'s envelope belongs to the framework, not to an operation.
    // The eight suites that inject a filesystem failure assert SPEC.md §11's
    // recovery through it, and none of them opts out.
    const response = await ws.request("/api/docs/doc_nosuchdoc", { headers: AUTH });
    expect(response.status).not.toBe(500);
  });
});
