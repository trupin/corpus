import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { createCorpusClient } from "../client/index.js";
import type { paths } from "../client/schema.generated.js";
import { buildOpenApiDocument } from "../openapi.js";
import { SKILL_NAME_MAX_LENGTH } from "../schemas/skill.js";
import { contractRoutes } from "./index.js";

/**
 * The skills surface — `POST /api/skills` (CONTRACT-020), and nothing else since
 * the rollback route went (rider signed 2026-08-12) — exercised through the real
 * route definition and the generated typed client. The handler is canned; what is
 * asserted is the contract's own work: the body, the actor header and the `409`
 * envelope.
 */

const BASE_URL = "http://127.0.0.1:8765";
const INSTALLED = "orchestrate";
/** The key a freshly created skill document is read at (SPEC.md §7). */
const CREATED_KEY = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde";

/** A pattern-valid name sitting exactly on the length bound, for the route's edges. */
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
  origin: null,
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
          key: CREATED_KEY,
          userEditing: false,
        },
        warnings: [],
      },
      201,
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
   * client narrows it exactly as it narrows a re-attach whose range moved.
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
        key: CREATED_KEY,
        userEditing: false,
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
