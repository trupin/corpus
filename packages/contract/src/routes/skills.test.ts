import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { createCorpusClient } from "../client/index.js";
import type { paths } from "../client/schema.generated.js";
import { buildOpenApiDocument } from "../openapi.js";
import { contractRoutes } from "./index.js";

/**
 * `POST /api/skills/{name}/rollback` exercised through the real route definition
 * and the generated typed client. The handler is canned; what is asserted is the
 * contract's own work — the path param, the optional body, the actor header and
 * the `404` envelope.
 */

const BASE_URL = "http://127.0.0.1:8765";
const INSTALLED = "orchestrate";
/** Installed too, but standing in for a skill the *other* party is mid-edit on. */
const LOCKED = "comment";
const COMMIT = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456";
const HELD_LOCK = {
  docId: "doc_9z8y7x",
  holder: "user",
  acquired: "2026-07-29T09:15:00.000Z",
  ttl: 300,
} as const;

interface Rejection {
  readonly code: string;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/** Mirrors the server's own `defaultHook`, so a rejection renders as `ValidationError`. */
function createApp(): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) =>
      result.success
        ? undefined
        : c.json(
            {
              code: "bad_request" as const,
              message: "request failed validation",
              issues: result.error.issues.map((issue) => ({
                path: [result.target, ...issue.path.map(String)].join("."),
                message: issue.message,
              })),
            },
            400,
          ),
  });

  app.openapi(contractRoutes.rollbackSkill, (c) => {
    const { name } = c.req.valid("param");
    if (name === LOCKED) {
      return c.json(
        {
          code: "locked" as const,
          message: `\`${name}\` is held by the user's edit lock.`,
          lock: HELD_LOCK,
        },
        423,
      );
    }
    if (name !== INSTALLED) {
      return c.json(
        { code: "not_found" as const, message: `No skill \`${name}\` under .claude/skills/.` },
        404,
      );
    }
    const actor = c.req.valid("header")[ACTOR_HEADER];
    const { to } = c.req.valid("json") ?? {};
    return c.json(
      {
        name,
        // The echo proves what the validator saw: which revision was asked for
        // and who is on the hook for the commit.
        docId: "doc_a1b2c3",
        commit: COMMIT,
        path: `.claude/skills/${name}/SKILL.md`,
        warnings: [
          { code: "commit_failed" as const, detail: `to=${to ?? "last-known-good"} by ${actor}` },
        ],
      },
      200,
    );
  });

  return app;
}

function createTestClient() {
  return createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => createApp().fetch(new Request(input, init)),
  });
}

describe("the skill-rollback route", () => {
  it("restores the last-known-good version on a bodiless call", async () => {
    const { data, error } = await createTestClient().api.POST("/api/skills/{name}/rollback", {
      params: { path: { name: INSTALLED } },
    });

    expect(error).toBeUndefined();
    expect(data).toMatchObject({
      name: INSTALLED,
      docId: "doc_a1b2c3",
      commit: COMMIT,
      path: ".claude/skills/orchestrate/SKILL.md",
    });
    expect(data?.warnings[0]?.detail).toBe("to=last-known-good by user");
  });

  it("carries an explicit revision and the acting party through to the handler", async () => {
    const { data } = await createTestClient().api.POST("/api/skills/{name}/rollback", {
      params: { path: { name: INSTALLED }, header: { [ACTOR_HEADER]: "agent" } },
      body: { to: "HEAD~2" },
    });

    expect(data?.warnings[0]?.detail).toBe("to=HEAD~2 by agent");
  });

  it("reads an explicit null as last-known-good", async () => {
    const { data } = await createTestClient().api.POST("/api/skills/{name}/rollback", {
      params: { path: { name: INSTALLED } },
      body: { to: null },
    });

    expect(data?.warnings[0]?.detail).toBe("to=last-known-good by user");
  });

  /** The path param is parsed and reaches the handler, which is what makes the 404 its own. */
  it("answers 404 for a skill nobody installed, in the standard envelope", async () => {
    const { data, error } = await createTestClient().api.POST("/api/skills/{name}/rollback", {
      params: { path: { name: "never-installed" } },
    });

    expect(data).toBeUndefined();
    expect(error).toEqual({
      code: "not_found",
      message: "No skill `never-installed` under .claude/skills/.",
    });
  });

  /**
   * A rollback rewrites `.claude/skills/{name}/SKILL.md`, so §9.2's "document
   * write paths refuse edits to a document locked by the other party" covers it
   * like any other write (CONTRACT-018). The `lock` in the envelope is what tells
   * the operator whom to wait for — or whose lock to break.
   */
  it("answers 423 with the blocking lock when the other party holds the skill", async () => {
    const { data, error } = await createTestClient().api.POST("/api/skills/{name}/rollback", {
      params: { path: { name: LOCKED } },
    });

    expect(data).toBeUndefined();
    expect(error).toEqual({
      code: "locked",
      message: "`comment` is held by the user's edit lock.",
      lock: HELD_LOCK,
    });
  });

  it.each(["Orchestrate", "my_skill", "-lead"])(
    "rejects the unusable skill name %s before any handler runs",
    async (name) => {
      const response = await createApp().request(`/api/skills/${name}/rollback`, {
        method: "POST",
      });

      expect(response.status).toBe(400);
      const rejection = (await response.json()) as Rejection;
      expect(rejection.code).toBe("bad_request");
      expect(rejection.issues?.[0]?.path).toBe("param.name");
    },
  );

  it("rejects an empty revision, which resolves to nothing", async () => {
    const response = await createApp().request(`/api/skills/${INSTALLED}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "" }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).issues?.[0]?.path).toBe("json.to");
  });

  it("rejects an actor outside the two parties", async () => {
    const response = await createApp().request(`/api/skills/${INSTALLED}/rollback`, {
      method: "POST",
      headers: { [ACTOR_HEADER]: "robot" },
    });

    expect(response.status).toBe(400);
  });
});

/** Compile-time probes over the generated `paths`; they fail under `tsc --noEmit`. */
describe("the generated client types describe the rollback surface", () => {
  type JsonBody<Body> = Body extends { content: { "application/json": infer Shape } }
    ? Shape
    : never;
  type RollbackBody = JsonBody<
    NonNullable<paths["/api/skills/{name}/rollback"]["post"]["requestBody"]>
  >;
  type RollbackOk = JsonBody<paths["/api/skills/{name}/rollback"]["post"]["responses"][200]>;
  type RollbackLocked = JsonBody<paths["/api/skills/{name}/rollback"]["post"]["responses"][423]>;

  const bare: RollbackBody = {};
  const pinned: RollbackBody = { to: "HEAD~2" };
  const cleared: RollbackBody = { to: null };

  it("makes the body optional in full", () => {
    expect([bare, pinned, cleared]).toHaveLength(3);
  });

  it("types the result's four facts plus its warnings", () => {
    const result: RollbackOk = {
      name: "orchestrate",
      docId: "doc_a1b2c3",
      commit: COMMIT,
      path: ".claude/skills/orchestrate/SKILL.md",
      warnings: [],
    };
    expect(Object.keys(result).sort()).toEqual(["commit", "docId", "name", "path", "warnings"]);
  });

  it("declares exactly the codes the rollback can answer with, 423 among them", () => {
    const responses =
      buildOpenApiDocument().paths?.["/api/skills/{name}/rollback"]?.post?.responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "401", "404", "423"]);
  });

  /** The generated client narrows the refusal to `LockedError`, not a bare error. */
  it("types the 423 body as the locked envelope carrying the holder", () => {
    const locked: RollbackLocked = {
      code: "locked",
      message: "`comment` is held by the user's edit lock.",
      lock: { ...HELD_LOCK },
    };
    expect(locked.lock.holder).toBe("user");
  });

  it("rejects a wrong-shaped body at compile time", () => {
    // @ts-expect-error `to` is a git ref, not a revision count. The
    // `@ts-expect-error` *is* the assertion: it fails to compile if the
    // generated types ever stop catching this.
    const wrongType: RollbackBody = { to: 2 };
    // @ts-expect-error the skill is named in the path; the body has no `name`.
    const strayName: RollbackBody = { name: "orchestrate" };

    expect([wrongType, strayName]).toHaveLength(2);
  });
});
