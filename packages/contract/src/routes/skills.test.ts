import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { createCorpusClient } from "../client/index.js";
import type { paths } from "../client/schema.generated.js";
import { buildOpenApiDocument } from "../openapi.js";
import { SKILL_NAME_MAX_LENGTH } from "../schemas/skill.js";
import { contractRoutes } from "./index.js";

/**
 * The skills surface — `POST /api/skills` (CONTRACT-020) and
 * `POST /api/skills/{name}/rollback` (CONTRACT-008) — exercised through the real
 * route definitions and the generated typed client. The handlers are canned;
 * what is asserted is the contract's own work: the path param, the bodies, the
 * actor header and the `404`/`409` envelopes.
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

/** A pattern-valid name sitting exactly on the length bound, for both routes' edges. */
const LONGEST_NAME = "a".repeat(SKILL_NAME_MAX_LENGTH);

/** What the server fills in for a freshly created skill (SPEC.md §5, §7). */
const CREATED_FRONTMATTER = {
  id: "doc_skillweeklyreview",
  type: "skill",
  title: "weekly-review",
  created: "2026-07-30T09:00:00.000Z",
  updated: "2026-07-30T09:00:00.000Z",
  tags: [] as string[],
  status: "open" as const,
  anchors: {},
  due: null,
  reviewed: null,
  evergreen: false,
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
};

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

  app.openapi(contractRoutes.createSkill, (c) => {
    const { name, description, title, body, tags } = c.req.valid("json");
    if (name === INSTALLED) {
      return c.json(
        {
          code: "conflict" as const,
          message: `\`${name}\` is already installed at .claude/skills/${name}/SKILL.md.`,
        },
        409,
      );
    }
    const actor = c.req.valid("header")[ACTOR_HEADER];
    return c.json(
      {
        doc: {
          frontmatter: {
            ...CREATED_FRONTMATTER,
            // The echo proves what the validator handed the handler: the
            // server-filled title default, the tags, and the acting party.
            title: title ?? name,
            tags: tags ?? [],
          },
          body: body ?? `<!-- ${description} by ${actor} -->`,
          path: `.claude/skills/${name}/SKILL.md`,
          anchors: [],
        },
        warnings: [],
      },
      201,
    );
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

describe("the skill-create route (CONTRACT-020)", () => {
  const minimal = { name: "weekly-review", description: "Run the Monday review." } as const;

  it("creates a skill from a name and a description alone", async () => {
    const { data, error } = await createTestClient().api.POST("/api/skills", { body: minimal });

    expect(error).toBeUndefined();
    expect(data?.doc.path).toBe(".claude/skills/weekly-review/SKILL.md");
    expect(data?.doc.frontmatter.type).toBe("skill");
    // The documented default: no title given, so the title is the name.
    expect(data?.doc.frontmatter.title).toBe("weekly-review");
    expect(data?.warnings).toEqual([]);
  });

  it("carries the optional fields and the acting party through to the handler", async () => {
    const { data } = await createTestClient().api.POST("/api/skills", {
      params: { header: { [ACTOR_HEADER]: "agent" } },
      body: { ...minimal, title: "Weekly review", tags: ["core"] },
    });

    expect(data?.doc.frontmatter.title).toBe("Weekly review");
    expect(data?.doc.frontmatter.tags).toEqual(["core"]);
    expect(data?.doc.body).toBe("<!-- Run the Monday review. by agent -->");
  });

  /**
   * The one refusal the server owns rather than the schema: the name is
   * well-formed, and taken. The envelope is the shared `conflict` shape, so a
   * client narrows it exactly as it narrows a lock-acquisition conflict.
   */
  it("answers 409 in the standard envelope when the name is already installed", async () => {
    const { data, error } = await createTestClient().api.POST("/api/skills", {
      body: { ...minimal, name: INSTALLED },
    });

    expect(data).toBeUndefined();
    expect(error).toEqual({
      code: "conflict",
      message: "`orchestrate` is already installed at .claude/skills/orchestrate/SKILL.md.",
    });
  });

  /**
   * The traversal guard is contract surface, not server hardening: every one of
   * these is a `400` naming `body.name` before a handler runs, so no filesystem
   * call is ever reached with a name that could escape `.claude/skills/`.
   */
  it.each(["../evil", "a/b", "/etc/passwd", "..", "%2e%2e", "Weekly-Review", ""])(
    "rejects the unusable skill name %s before any handler runs",
    async (name) => {
      const response = await createApp().request("/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: "x" }),
      });

      expect(response.status).toBe(400);
      const rejection = (await response.json()) as Rejection;
      expect(rejection.code).toBe("bad_request");
      expect(rejection.issues?.[0]?.path).toBe("json.name");
    },
  );

  /**
   * The length bound, at the route rather than only at the schema (orchestrator
   * ruling, 2026-07-30): the name becomes a directory, so an absurd one is a
   * `400` naming `body.name` and never an `ENAMETOOLONG` the server has to
   * translate. Both edges, because an off-by-one is a different contract.
   */
  it("creates a skill whose name is exactly the maximum length", async () => {
    const { data, error } = await createTestClient().api.POST("/api/skills", {
      body: { ...minimal, name: LONGEST_NAME },
    });

    expect(error).toBeUndefined();
    expect(data?.doc.path).toBe(`.claude/skills/${LONGEST_NAME}/SKILL.md`);
  });

  it("refuses a name one character past the maximum, naming the field", async () => {
    const response = await createApp().request("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...minimal, name: `${LONGEST_NAME}a` }),
    });

    expect(response.status).toBe(400);
    const rejection = (await response.json()) as Rejection;
    expect(rejection.code).toBe("bad_request");
    expect(rejection.issues?.[0]?.path).toBe("json.name");
  });

  it("rejects a body with no description, since a skill needs one to be discovered", async () => {
    const response = await createApp().request("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "weekly-review" }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).issues?.[0]?.path).toBe("json.description");
  });

  /** CONTRACT-017: `folder` is `POST /api/docs`'s vocabulary, and a skill has none. */
  it("rejects an unknown key rather than filing the skill somewhere else", async () => {
    const response = await createApp().request("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...minimal, folder: "data/docs/skills" }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).issues?.[0]?.path).toContain("json");
  });

  it("rejects an actor outside the two parties", async () => {
    const response = await createApp().request("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json", [ACTOR_HEADER]: "robot" },
      body: JSON.stringify(minimal),
    });

    expect(response.status).toBe(400);
  });
});

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

  /**
   * The path parameter shares one definition of a name with the create body, so
   * it inherits the bound. That is the desirable reading rather than collateral:
   * an over-long name can name no installed skill, and "this input cannot be
   * right" (`400`) is truer than "no such skill" (`404`).
   */
  it("still accepts a path name of exactly the maximum length, reaching the handler", async () => {
    const response = await createApp().request(`/api/skills/${LONGEST_NAME}/rollback`, {
      method: "POST",
    });

    // Not installed, so a 404 — but a 404 is proof the name passed validation.
    expect(response.status).toBe(404);
  });

  it("refuses a path name one character past the maximum with a 400, not a 404", async () => {
    const response = await createApp().request(`/api/skills/${LONGEST_NAME}a/rollback`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).issues?.[0]?.path).toBe("param.name");
  });

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
describe("the generated client types describe the create surface", () => {
  type JsonBody<Body> = Body extends { content: { "application/json": infer Shape } }
    ? Shape
    : never;
  type CreateBody = JsonBody<NonNullable<paths["/api/skills"]["post"]["requestBody"]>>;
  type CreateOk = JsonBody<paths["/api/skills"]["post"]["responses"][201]>;
  type CreateConflict = JsonBody<paths["/api/skills"]["post"]["responses"][409]>;

  const minimal: CreateBody = { name: "weekly-review", description: "Run the Monday review." };
  const full: CreateBody = {
    name: "weekly-review",
    description: "Run the Monday review.",
    title: "Weekly review",
    body: "## Steps\n",
    tags: ["core"],
  };

  it("demands the two fields a discoverable skill cannot do without", () => {
    expect([minimal, full]).toHaveLength(2);
  });

  it("declares exactly the codes a creation can answer with", () => {
    const responses = buildOpenApiDocument().paths?.["/api/skills"]?.post?.responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(["201", "400", "401", "409"]);
  });

  /** A skill is an ordinary document, so creating one returns the ordinary shape. */
  it("types the 201 body as the document mutation response", () => {
    const created: CreateOk = {
      doc: {
        frontmatter: CREATED_FRONTMATTER,
        body: "",
        path: ".claude/skills/weekly-review/SKILL.md",
        anchors: [],
      },
      warnings: [],
    };
    expect(created.doc.frontmatter.type).toBe("skill");
  });

  it("types the 409 body as the shared conflict envelope", () => {
    const taken: CreateConflict = { code: "conflict", message: "`orchestrate` is installed." };
    expect(taken.code).toBe("conflict");
  });

  it("rejects a wrong-shaped body at compile time", () => {
    // @ts-expect-error the skill is named in the body, and a name is not a number.
    const wrongType: CreateBody = { name: 2, description: "x" };
    // @ts-expect-error `folder` belongs to `POST /api/docs`; a skill has no folder.
    const strayFolder: CreateBody = { ...minimal, folder: "inbox" };

    expect([wrongType, strayFolder]).toHaveLength(2);
  });
});

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
