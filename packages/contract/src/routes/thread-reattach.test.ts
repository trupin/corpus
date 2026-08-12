import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import type { paths } from "../client/schema.generated.js";
import { buildOpenApiDocument } from "../openapi.js";
import { isApiError } from "../schemas/error.js";
import {
  REATTACH_REFUSAL_REASONS,
  ReattachThreadRequestSchema,
  type ReattachRefusalReason,
} from "../schemas/reattach.js";
import { ENDPOINT_INVENTORY } from "./inventory.js";
import { reattachThread } from "./thread-reattach.js";

const REATTACH_PATH = "/api/threads/{id}/reattach";

/** `openapi3-ts` types a path item with an `any`-valued index signature. */
interface PublishedOperation {
  readonly description?: string;
  readonly parameters?: { name: string }[];
  readonly requestBody?: { required?: boolean };
  readonly responses?: Record<string, unknown>;
}

interface SchemaNode {
  readonly additionalProperties?: unknown;
  readonly required?: string[];
  readonly properties?: Record<string, Record<string, unknown>>;
}

function published(): PublishedOperation {
  const item = buildOpenApiDocument().paths?.[REATTACH_PATH] as
    Record<string, PublishedOperation> | undefined;
  const found = item?.["post"];
  if (!found) throw new Error(`No post ${REATTACH_PATH} in the generated document.`);
  return found;
}

/**
 * The fixture SERVER-059's impossibility proof is built on, and the reason it is
 * four parallel items rather than two: the previous attempt's safety tests
 * passed because two items are shape-lucky. Every line below quotes text that
 * differs from its siblings by one character, so any measure that ranks
 * similarity ranks them all within noise of each other.
 */
const PARENT_BODY = [
  "## Actions",
  "",
  "- Review the Q1 report by Friday",
  "- Review the Q2 report by Friday",
  "- Review the Q3 report by Friday",
  "- Review the Q4 report by Friday",
  "",
].join("\n");

const quarterRange = (quarter: "Q1" | "Q2" | "Q3" | "Q4") => {
  const exact = `Review the ${quarter} report by Friday`;
  const start = PARENT_BODY.indexOf(exact);
  return { range: { start, end: start + exact.length }, expectedText: exact };
};

/** `anc_other` already resolves over the Q4 line, so a repair may not claim it. */
const OCCUPIED = quarterRange("Q4").range;

const CONTEXT_WINDOW = 32;

interface StubThread {
  readonly anchor: string | null;
  readonly status: "open" | "resolved";
}

const THREADS: Record<string, StubThread> = {
  th_orphan: { anchor: "anc_k4f7", status: "open" },
  th_whole: { anchor: null, status: "open" },
};

/**
 * The route mounted the way a server must mount it, with a handler that carries
 * out exactly the decisions the contract declares — the guard, the overlap
 * refusal, the actor refusal, and the selector computed off the fixture's own
 * bytes. It is not a double for the server: it is the demonstration that the
 * declared request carries **enough** to decide all of them, which is the claim
 * CONTRACT-041 makes about the shape.
 */
function createApp() {
  // Mirrors the server's own `defaultHook`, so a rejection renders as the
  // contract's `ValidationError` rather than the library's raw dump.
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
  app.openapi(reattachThread, (c) => {
    const { id } = c.req.valid("param");
    const actor = c.req.valid("header")[ACTOR_HEADER];
    const { range, expectedText } = c.req.valid("json");

    if (actor === "agent") {
      return c.json({ code: "forbidden" as const, message: "the agent does not re-attach" }, 403);
    }

    const thread = THREADS[id];
    if (!thread) return c.json({ code: "not_found" as const, message: "no such thread" }, 404);

    const refuse = (reason: ReattachRefusalReason, message: string) =>
      c.json({ code: "conflict" as const, message, reason }, 409);

    if (thread.anchor === null) return refuse("not-anchored", "the thread has no anchor");
    if (PARENT_BODY.slice(range.start, range.end) !== expectedText) {
      return refuse("range-changed", "the parent's bytes at that range are not what you saw");
    }
    if (range.start < OCCUPIED.end && OCCUPIED.start < range.end) {
      return refuse("range-overlaps", "`anc_other` already resolves over that text");
    }

    return c.json(
      {
        thread: {
          id,
          title: "Re: the Q2 action",
          status: thread.status,
          parent: "doc_a1b2c3",
          anchor: thread.anchor,
          agent: "none" as const,
          created: "2026-07-19T10:05:00Z",
          updated: "2026-07-19T10:05:00Z",
          turnCount: 1,
          lastAuthor: "user" as const,
          lastTs: "2026-07-19T10:05:00Z",
        },
        anchor: {
          anchorId: thread.anchor,
          // Read off the document's bytes, never taken from the request
          // (SERVER-071's rule, reused here).
          selector: {
            exact: PARENT_BODY.slice(range.start, range.end),
            prefix: PARENT_BODY.slice(Math.max(0, range.start - CONTEXT_WINDOW), range.start),
            suffix: PARENT_BODY.slice(range.end, range.end + CONTEXT_WINDOW),
          },
          threadId: id,
          threadStatus: thread.status,
          range,
          orphaned: false,
        },
        warnings: [],
      },
      200,
    );
  });
  return app;
}

const reattach = (threadId: string, body: unknown, actor?: string) =>
  createApp().request(`/api/threads/${threadId}/reattach`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(actor === undefined ? {} : { [ACTOR_HEADER]: actor }),
    },
    body: JSON.stringify(body),
  });

interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly reason?: string;
}

interface Repaired {
  readonly anchor: {
    readonly selector: { readonly exact: string; readonly prefix: string; readonly suffix: string };
    readonly range: { readonly start: number; readonly end: number } | null;
    readonly orphaned: boolean;
  };
}

interface Rejection {
  readonly code: string;
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

describe("the range a person chose", () => {
  it("attaches the thread to exactly the range it was given", async () => {
    const chosen = quarterRange("Q2");
    const response = await reattach("th_orphan", chosen);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Repaired;
    expect(body.anchor.range).toEqual(chosen.range);
    expect(body.anchor.orphaned).toBe(false);
  });

  /**
   * The acceptance criterion this route exists for. Two of the four siblings are
   * *byte-identical* requests apart from their offsets, so a candidate index or
   * a similarity score could not tell them apart at all — and yet each lands on
   * its own line. The range denotes its own meaning; nothing has to be
   * re-derived server-side and nothing can go stale.
   */
  it.each(["Q1", "Q2", "Q3"] as const)("separates sibling %s from its lookalikes", async (q) => {
    const chosen = quarterRange(q);
    const body = (await (await reattach("th_orphan", chosen)).json()) as Repaired;

    expect(body.anchor.range).toEqual(chosen.range);
    expect(body.anchor.selector.exact).toBe(`Review the ${q} report by Friday`);
  });

  /**
   * SERVER-071's rule, carried into the repair: the caller sends no selector at
   * all, so the stored one can only have come from the document. The context
   * here is the surrounding *siblings*, which is exactly what makes the repaired
   * anchor resolvable on the next read without a fuzzy rung.
   */
  it("computes the whole selector off the document's bytes, not the request", async () => {
    const chosen = quarterRange("Q3");
    const body = (await (await reattach("th_orphan", chosen)).json()) as Repaired;
    const { prefix, exact, suffix } = body.anchor.selector;

    expect(Object.keys(chosen)).toEqual(["range", "expectedText"]);
    expect(prefix).toContain("Q2 report");
    expect(suffix).toContain("Q4 report");
    expect(PARENT_BODY.indexOf(prefix + exact + suffix)).toBeGreaterThanOrEqual(0);
    expect(PARENT_BODY.split(prefix + exact + suffix)).toHaveLength(2);
  });
});

describe("refusals the document's state makes", () => {
  /** The document is live: the person's range may be stale by the time it arrives. */
  it("refuses a range whose bytes are no longer what the caller saw", async () => {
    const chosen = quarterRange("Q2");
    const response = await reattach("th_orphan", {
      ...chosen,
      expectedText: "Review the Q9 report by Friday",
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as Refusal;
    expect(body.reason).toBe("range-changed");
  });

  it("refuses a range running past the end of the body as the same fact", async () => {
    const beyond = PARENT_BODY.length + 40;
    const response = await reattach("th_orphan", {
      range: { start: beyond, end: beyond + 5 },
      expectedText: "abcde",
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as Refusal).reason).toBe("range-changed");
  });

  /** SPEC.md §6: two threads on disjoint text never end up claiming overlapping text. */
  it("refuses a range overlapping another thread's text rather than merging it", async () => {
    const response = await reattach("th_orphan", quarterRange("Q4"));

    expect(response.status).toBe(409);
    expect(((await response.json()) as Refusal).reason).toBe("range-overlaps");
  });

  it("refuses a thread with no anchor to repair", async () => {
    const response = await reattach("th_whole", quarterRange("Q2"));

    expect(response.status).toBe(409);
    expect(((await response.json()) as Refusal).reason).toBe("not-anchored");
  });

  it("distinguishes the three refusals from each other by a machine-readable field", () => {
    expect(new Set(REATTACH_REFUSAL_REASONS).size).toBe(REATTACH_REFUSAL_REASONS.length);
  });

  /**
   * The `409` body adds a field to `ConflictError` rather than an eighth member
   * to `ERROR_CODES`, exactly as `LockConflictError` does — so every consumer
   * that narrows on `code` keeps working without growing a branch.
   */
  it("still parses as an ApiError, so no consumer has to learn a new code", async () => {
    const body: unknown = await (await reattach("th_whole", quarterRange("Q2"))).json();
    expect(isApiError(body)).toBe(true);
  });
});

describe("who may ask for a repair", () => {
  /**
   * Person-initiated by design. The evidence the route runs on does not exist at
   * read time (SERVER-059), so an agent calling it would be guessing — and §6
   * puts a visible orphan above a silent misattachment. Declared rather than
   * left to an actor check nobody wrote down.
   */
  it("refuses an agent actor with 403", async () => {
    const response = await reattach("th_orphan", quarterRange("Q2"), "agent");
    expect(response.status).toBe(403);
    expect(((await response.json()) as Refusal).code).toBe("forbidden");
  });

  it("accepts the default actor, which is the person", async () => {
    expect((await reattach("th_orphan", quarterRange("Q2"), "user")).status).toBe(200);
    expect((await reattach("th_orphan", quarterRange("Q2"))).status).toBe(200);
  });

  it("declares the acting-party header, which becomes the git author", () => {
    expect(published().parameters?.map((parameter) => parameter.name)).toEqual([
      "id",
      ACTOR_HEADER,
    ]);
  });
});

describe("the request body's shape", () => {
  const issuesOf = async (response: Response) => ((await response.json()) as Rejection).issues;

  it("rejects an empty range, since an anchor cannot quote nothing", async () => {
    const response = await reattach("th_orphan", {
      range: { start: 12, end: 12 },
      expectedText: "x",
    });
    expect(response.status).toBe(400);
    expect((await issuesOf(response)).map((issue) => issue.path)).toContain("json.range.end");
  });

  it("rejects a body whose text and range describe different passages", async () => {
    const response = await reattach("th_orphan", {
      range: { start: 12, end: 20 },
      expectedText: "not eight characters",
    });
    expect(response.status).toBe(400);
    expect((await issuesOf(response)).map((issue) => issue.path)).toContain("json.expectedText");
  });

  it("rejects a negative offset", async () => {
    const response = await reattach("th_orphan", {
      range: { start: -1, end: 4 },
      expectedText: "abcde",
    });
    expect(response.status).toBe(400);
  });

  /**
   * CONTRACT-017. A candidate index is precisely the field this route refuses to
   * take, so sending one must be a loud `400` rather than a silently ignored key
   * that leaves the caller believing the server used it.
   */
  it("rejects a candidate index as an unknown key", async () => {
    const response = await reattach("th_orphan", { ...quarterRange("Q2"), candidate: 2 });
    expect(response.status).toBe(400);
    expect((await issuesOf(response)).some((issue) => issue.message.includes("candidate"))).toBe(
      true,
    );
  });

  it("demands both fields", async () => {
    const chosen = quarterRange("Q2");
    expect((await reattach("th_orphan", { range: chosen.range })).status).toBe(400);
    expect((await reattach("th_orphan", { expectedText: chosen.expectedText })).status).toBe(400);
  });

  it("publishes a strict body with no server-applied default", () => {
    const schema = buildOpenApiDocument().components?.schemas?.["ReattachThreadRequest"] as
      SchemaNode | undefined;
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.required).toEqual(["range", "expectedText"]);
    for (const property of Object.values(schema?.properties ?? {})) {
      expect(property).not.toHaveProperty("default");
    }
  });

  it("parses a well-formed body straight from the schema", () => {
    const parsed = ReattachThreadRequestSchema.parse(quarterRange("Q2"));
    expect(parsed.expectedText.length).toBe(parsed.range.end - parsed.range.start);
  });
});

describe("the published operation", () => {
  it("is in the pinned endpoint inventory", () => {
    expect(ENDPOINT_INVENTORY).toContain("POST /api/threads/{id}/reattach");
  });

  it("declares exactly the codes a repair can answer with", () => {
    expect(Object.keys(published().responses ?? {}).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
    ]);
  });

  /**
   * The route's reasoning has to survive without this issue file: a future
   * reader meets the description long before they meet SERVER-059's post-mortem,
   * and the one thing they must not conclude is that a candidate index would
   * have been simpler.
   */
  it("says in its own description why it takes a range and who may call it", () => {
    const description = published().description ?? "";
    expect(description).toContain("never a candidate");
    expect(description).toContain("User-only");
    expect(description).toContain("One action, one commit");
    expect(description).toContain("§6");
  });

  it("mandates the body, since a re-attach with no range is not a decision", () => {
    expect(published().requestBody?.required).toBe(true);
  });
});

/** Compile-time probes over the generated `paths`; they fail under `tsc --noEmit`. */
describe("the generated client's view of the repair", () => {
  type JsonBody<Body> = Body extends { content: { "application/json": infer Shape } }
    ? Shape
    : never;
  type Operation = paths["/api/threads/{id}/reattach"]["post"];
  type ReattachBody = JsonBody<NonNullable<Operation["requestBody"]>>;
  type ReattachOk = JsonBody<Operation["responses"][200]>;
  type ReattachConflict = JsonBody<Operation["responses"][409]>;

  const body: ReattachBody = {
    range: { start: 14, end: 45 },
    expectedText: "Review the Q2 report by Friday",
  };

  it("types the body as a range plus its guard, and nothing else", () => {
    expect(Object.keys(body).sort()).toEqual(["expectedText", "range"]);
  });

  it("types the 409 as the conflict envelope narrowed by a reason", () => {
    const changed: ReattachConflict = {
      code: "conflict",
      message: "the parent moved under you",
      reason: "range-changed",
    };
    expect(REATTACH_REFUSAL_REASONS).toContain(changed.reason);
  });

  it("types the 200 as the anchor, the thread and §14's warnings", () => {
    const repaired: Pick<ReattachOk, "warnings"> = { warnings: [] };
    expect(repaired.warnings).toEqual([]);
  });

  it("rejects a wrong-shaped body at compile time", () => {
    // @ts-expect-error a candidate index is exactly what this route refuses to take.
    const candidate: ReattachBody = { ...body, candidate: 2 };
    // @ts-expect-error the range is an object, not a pair of top-level offsets.
    const flattened: ReattachBody = { start: 14, end: 45, expectedText: "x" };
    // @ts-expect-error the selector is the server's to compute, never the caller's to send.
    const selector: ReattachBody = { ...body, selector: { exact: "x" } };

    expect([candidate, flattened, selector]).toHaveLength(3);
  });
});
