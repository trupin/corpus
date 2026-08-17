import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createCorpusClient } from "../client/index.js";
import { ApiErrorSchema, UnknownRecipientErrorSchema } from "../schemas/error.js";
import { ORCHESTRATOR_LANE } from "../schemas/lane.js";
import { contractRoutes } from "./index.js";

/**
 * The park's refusal, driven end to end through the generated client
 * (CONTRACT-058).
 *
 * `openapi.test.ts` asserts that the `422` is *declared* and what its published
 * prose says. This file asserts the half a document cannot: that a consumer
 * mounting the contract's route definition and answering with the body the
 * server actually sends gets that body back through `@corpus/contract/client`,
 * narrowed on `code` like every other member of the `ApiError` union. A
 * declaration the client cannot surface would be a document that reads correctly
 * and a branch nobody can write.
 *
 * The handler below is deliberately the *server's* logic in miniature — refuse
 * before parking, and only for a scope that is neither absent nor the
 * orchestrator's — because the refusal's whole content is which values reach it.
 */

const BASE_URL = "http://127.0.0.1:8765";
const LANE = "th_designated";

/** The server's own message (`apps/server/src/errors.ts`'s `unknownLaneScope`). */
const refusalMessage = (scope: string): string =>
  `\`${scope}\` names no lane to consume: either this workspace holds no such thread, or that ` +
  "thread holds no resident and is therefore not a lane at all (SPEC.md §7). Nothing was " +
  "parked and no work was claimed — omit `scope` to take the orchestrator's lane, designate a " +
  "resident on that thread first, or pick a lane from `GET /api/agents`.";

function createApp(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(contractRoutes.idleQueue, (c) => {
    const { scope } = c.req.valid("query");
    if (scope !== undefined && scope !== ORCHESTRATOR_LANE && scope !== LANE) {
      return c.json(
        { code: "unknown_recipient" as const, message: refusalMessage(scope), recipient: scope },
        422,
      );
    }
    return c.json({ events: [], inProgress: { events: [], total: 0, truncated: false } }, 200);
  });

  return app;
}

const client = () =>
  createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => createApp().fetch(new Request(input, init)),
  });

const park = async (scope?: string) =>
  client().api.GET("/api/queue/idle", {
    params: { query: scope === undefined ? {} : { scope } },
  });

describe("a park on a scope that is not a lane, through the generated client", () => {
  /**
   * **This test is the declaration.** `error` is the union of the operation's
   * declared error bodies, so narrowing it to `"unknown_recipient"` only
   * compiles while the `422` is declared — with the response removed, the
   * comparison below is a `TS2367` ("this comparison appears unintentional")
   * against a union that cannot hold the code, and `error.recipient` a
   * `TS2339`. That is precisely the state the route was in before
   * CONTRACT-058: the server sent this body and no consumer could type a
   * branch for it.
   */
  it("hands the refusal back as a typed error a consumer can narrow", async () => {
    const { data, error, response } = await park("th_nosuchthing");

    expect(response.status).toBe(422);
    expect(data).toBeUndefined();
    expect(error?.code).toBe("unknown_recipient");
    if (error?.code !== "unknown_recipient") throw new Error("expected the lane refusal");
    expect(error.recipient).toBe("th_nosuchthing");
  });

  it("carries a body that parses as the declared component and as an ApiError", async () => {
    const { error } = await park("th_nosuchthing");

    expect(UnknownRecipientErrorSchema.safeParse(error).success).toBe(true);
    // And as the union, which is what `isApiError` and the CLI's renderer read:
    // a refusal outside it would be the one a caller could not handle
    // generically.
    expect(ApiErrorSchema.safeParse(error).success).toBe(true);
  });

  it("names all three recoveries in the message a caller will log", async () => {
    const { error } = await park("th_nosuchthing");
    const message = error?.message ?? "";

    expect(message).toContain("omit `scope`");
    expect(message).toContain("designate a resident on that thread first");
    expect(message).toContain("pick a lane from `GET /api/agents`");
    expect(message).toContain("Nothing was parked and no work was claimed");
  });

  /**
   * The two values that must never reach it. An omitted `scope` means the
   * orchestrator's lane — every caller written before lanes existed — and
   * `orchestrator` names a lane that exists whether or not anything is
   * designated. A refusal that caught either would break the loop it guards.
   */
  it.each([
    ["an omitted scope", undefined],
    ["the orchestrator's lane", ORCHESTRATOR_LANE],
    ["a designated thread", LANE],
  ])("admits %s", async (_label, scope) => {
    const { data, error } = await park(scope);

    expect(error).toBeUndefined();
    expect(data?.events).toEqual([]);
  });
});
