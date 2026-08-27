// SERVER-119 — the fixture's declared-status check.
//
// It used to be tested through the fixture, because `POST /api/upgrade` was
// declared and not mounted and so answered a stable undeclared `404`. SERVER-050
// mounted it, this file went red, and the comment that predicted that said this
// was the right moment to notice. There is no unmounted route left to stand in,
// and manufacturing one would be a fixture pretending to be a server — so the
// check is called directly instead. It is the shipped function with the shipped
// route inventory; what is lost is only the proof that `checkDeclaredStatuses`
// wires it to `app.request`, and that is asserted at the bottom of this file.
//
// Its real proof is the counterfactual, and that is recorded in the issue: each
// of CONTRACT-058's `422`, CONTRACT-059's `403` and CONTRACT-083's `409` was
// removed from the contract in turn, and the suite went red at `roster.test.ts`,
// `provenance.test.ts` and `queue/routes.test.ts` respectively. What is here is
// the part a counterfactual cannot show — that the check admits what it should,
// that its message says what to do, and that the escape hatch cannot go stale.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorpusServer } from "../app.js";
import {
  AUTH,
  assertDeclaredStatus,
  checkDeclaredStatuses,
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
 * The specimen: `POST /api/upgrade`, which declares `202, 401, 409`, asked to
 * account for a `404`. The route is real and mounted; the status is one it
 * cannot produce, which is exactly the shape of every violation this check was
 * written for — CONTRACT-058's `422`, CONTRACT-059's `403`, CONTRACT-083's three
 * `409`s.
 */
const UNDECLARED = "/api/upgrade";
const POSTED: RequestInit = { method: "POST" };

describe("the fixture's declared-status check (SERVER-119)", () => {
  it("fails the request that produced an undeclared status, naming the operation", () => {
    expect(() => {
      assertDeclaredStatus(UNDECLARED, POSTED, 404);
    }).toThrow(
      "POST /api/upgrade answered 404, which the contract does not declare (it declares 202, 401, 409)",
    );
  });

  it("says what to do about it, since the fix is a contract change", () => {
    expect(() => {
      assertDeclaredStatus(UNDECLARED, POSTED, 404);
    }).toThrow(
      /declare the status on that route in packages\/contract\/src\/routes\/ — a contract change/,
    );
  });

  it("admits every status the operation does declare", () => {
    for (const status of [202, 401, 409]) {
      expect(() => {
        assertDeclaredStatus(UNDECLARED, POSTED, status);
      }).not.toThrow();
    }
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
    await expect(
      withUndeclaredStatus("this one is deliberate", () => {
        assertDeclaredStatus(UNDECLARED, POSTED, 404);
        return Promise.resolve("through");
      }),
    ).resolves.toBe("through");
  });

  it("refuses an opt-out that turned out not to be needed", async () => {
    await expect(
      withUndeclaredStatus("nothing undeclared happens here", async () => {
        const response = await ws.request("/api/docs/doc_nosuchdoc", { headers: AUTH });
        expect(response.status).toBe(404);
      }),
    ).rejects.toThrow(/the opt-out is stale/);
  });

  it("does not treat a 500 as undeclared, because no route declares one", () => {
    // `app.onError`'s envelope belongs to the framework, not to an operation.
    // The eight suites that inject a filesystem failure assert SPEC.md §11's
    // recovery through it, and none of them opts out.
    expect(() => {
      assertDeclaredStatus(UNDECLARED, POSTED, 500);
    }).not.toThrow();
  });
});

/**
 * The half the direct calls above cannot show: that the check is actually
 * *installed*, so a suite gets it without asking. Against a stub app rather than
 * a real one, because the whole difficulty is that no real route answers a
 * status it does not declare — which is the point of the check and the reason
 * there is nothing left to provoke it with.
 */
describe("checkDeclaredStatuses wires the check to app.request", () => {
  function serverAnswering(status: number): CorpusServer {
    const app = {
      request: () => Promise.resolve(new Response(null, { status })),
    };
    return { app } as unknown as CorpusServer;
  }

  it("throws on the wrapped request when the status is undeclared", async () => {
    const server = serverAnswering(404);
    checkDeclaredStatuses(server);
    await expect(server.app.request(UNDECLARED, POSTED)).rejects.toThrow(
      "which the contract does not declare",
    );
  });

  it("returns the response untouched when the status is declared", async () => {
    const server = serverAnswering(202);
    checkDeclaredStatuses(server);
    expect((await server.app.request(UNDECLARED, POSTED)).status).toBe(202);
  });
});

/**
 * SERVER-050's guard. `POST /api/upgrade` starts a real installer and
 * `GET /api/upgrade/check` makes a real network request, so no fixture may reach
 * either — and the refusal has to name where they *are* tested, or the next
 * person to meet it removes it.
 */
describe("refuseRealWorldRoutes", () => {
  it("refuses the trigger before it can spawn anything", async () => {
    await expect(ws.post("/api/upgrade", {})).rejects.toThrow(
      /must not be called from a fixture: it spawns a real, detached `corpus upgrade`/,
    );
  });

  it("refuses the check before it can reach GitHub", async () => {
    await expect(ws.request("/api/upgrade/check", { headers: AUTH })).rejects.toThrow(
      /it makes a real request to the GitHub Releases API/,
    );
  });

  it("names the suite that does test them", async () => {
    await expect(ws.post("/api/upgrade", {})).rejects.toThrow(
      "apps/server/src/upgrade/routes.test.ts",
    );
  });

  it("leaves every other route alone", async () => {
    expect((await ws.request("/api/health")).status).toBe(200);
  });
});
