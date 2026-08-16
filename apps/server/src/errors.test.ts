import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiErrorSchema, ERROR_CODES, type Doc } from "@corpus/contract";
import {
  ConfigError,
  CorpusError,
  HttpError,
  MAX_CAUSE_DEPTH,
  badRequest,
  conflict,
  describeThrown,
  errorResponse,
  forbidden,
  internalError,
  notFound,
  staleKey,
  toHttpError,
  toValidationIssues,
  unauthorized,
  unknownJob,
  unknownRecipient,
} from "./errors.js";

/**
 * The document a `stale_key` refusal carries: SPEC.md §7's "a refusal is never
 * bare", so the factory takes the document as it now stands and the body has to
 * parse as one.
 */
const CURRENT_DOC: Doc = {
  frontmatter: {
    id: "doc_a1b2c3",
    type: "note",
    title: "Mortgage options",
    created: "2026-07-19T10:00:00Z",
    updated: "2026-07-19T10:42:00Z",
    tags: [],
    status: "open",
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
  },
  body: "Body.",
  path: "data/docs/mortgage.md",
  anchors: [],
  key: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde",
  userEditing: false,
};

/** One error from every factory the server exposes. */
const ALL_FACTORY_ERRORS = [
  badRequest("b", []),
  unauthorized("u"),
  forbidden("f"),
  notFound("n"),
  conflict("c"),
  staleKey("s", CURRENT_DOC),
  unknownJob("evt_a1b2c3"),
  unknownRecipient("th_x9y8"),
  internalError(),
];

describe("error classes", () => {
  it("gives every class a stable name and keeps the cause chain", () => {
    const cause = new Error("root");
    expect(new CorpusError("x").name).toBe("CorpusError");
    expect(new ConfigError("x", { cause }).name).toBe("ConfigError");
    expect(new ConfigError("x", { cause }).cause).toBe(cause);
    expect(new ConfigError("x")).toBeInstanceOf(CorpusError);
    expect(new HttpError(400, { code: "bad_request", message: "m", issues: [] })).toBeInstanceOf(
      CorpusError,
    );
  });

  it("uses the body message as the Error message", () => {
    expect(notFound("no such doc").message).toBe("no such doc");
  });

  it("defaults to no extra headers", () => {
    expect(notFound("x").headers).toEqual({});
  });
});

describe("error factories", () => {
  it.each([
    [badRequest("bad", [{ path: "body.title", message: "required" }]), 400, "bad_request"],
    [unauthorized("nope"), 401, "unauthorized"],
    [forbidden("not yours"), 403, "forbidden"],
    [notFound("gone"), 404, "not_found"],
    [conflict("already held"), 409, "conflict"],
    [staleKey("moved on", CURRENT_DOC), 409, "stale_key"],
    [internalError(), 500, "internal_error"],
  ] as const)("maps %#: status %s / code %s", (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.body.code).toBe(code);
  });

  it("produces bodies the contract's ApiError accepts (Adjudication 2)", () => {
    for (const error of ALL_FACTORY_ERRORS) {
      expect(ApiErrorSchema.safeParse(error.body).success).toBe(true);
    }
  });

  it("attaches WWW-Authenticate to every 401", () => {
    expect(unauthorized("nope").headers).toEqual({ "WWW-Authenticate": "Bearer" });
  });

  it("serializes an unexpected failure as a contract `internal_error` (CONTRACT-002)", () => {
    const error = internalError();
    expect(error.status).toBe(500);
    expect(error.body).toEqual({ code: "internal_error", message: "internal error" });
    // No route declares a 500 by design, but the code is a full union member, so
    // the last-resort body still type-checks and parses as an `ApiError`.
    expect(ERROR_CODES).toContain("internal_error");
    expect(ApiErrorSchema.safeParse(error.body).success).toBe(true);
  });

  it("emits only codes the contract declares (Adjudication 2)", () => {
    const emitted = ALL_FACTORY_ERRORS.map((error) => error.body.code);
    for (const code of emitted) {
      expect(ERROR_CODES).toContain(code);
    }
    // Every code the contract declares now has a factory, and no factory emits
    // the same code twice.
    expect(new Set(emitted).size).toBe(emitted.length);
    expect([...emitted].sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe("toValidationIssues", () => {
  it("renders dotted paths, prefixed by the validation target", () => {
    const schema = z.object({ title: z.string(), tags: z.array(z.string()) });
    const result = schema.safeParse({ title: 1, tags: [2] });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = toValidationIssues(result.error, "body");
    expect(issues.map((issue) => issue.path)).toEqual(["body.title", "body.tags.0"]);
    expect(issues.every((issue) => issue.message.includes("string"))).toBe(true);
  });

  it("omits the target when there is none and the path when it is empty", () => {
    const result = z.string().safeParse(1);
    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = toValidationIssues(result.error);
    expect(issues.map((issue) => issue.path)).toEqual([""]);
    expect(issues[0]?.message).toContain("string");
  });
});

describe("toHttpError", () => {
  it("passes an HttpError through untouched", () => {
    const error = notFound("gone");
    expect(toHttpError(error)).toBe(error);
  });

  it("maps a ZodError to a 400 carrying its issues", () => {
    const result = z.object({ n: z.number() }).safeParse({ n: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;

    const mapped = toHttpError(result.error);
    expect(mapped.status).toBe(400);
    expect(mapped.body).toMatchObject({ code: "bad_request" });
  });

  it.each([
    ["a plain Error carrying a secret", new Error("token=hunter2 leaked")],
    ["a thrown string", "boom"],
    ["a thrown object", { secret: "hunter2" }],
  ])("maps %s to an opaque 500", (_label, thrown) => {
    const mapped = toHttpError(thrown);
    expect(mapped.status).toBe(500);
    expect(JSON.stringify(mapped.body)).not.toContain("hunter2");
    expect(mapped.body.message).toBe("internal error");
  });

  // SERVER-031: Hono throws these from below every handler — the body validator
  // refuses an unreadable body before `defaultHook` runs — and unrecognised they
  // became `500 internal_error` on every JSON route in the API.
  it("keeps a framework HTTPException's status and re-clothes it as an ApiError", () => {
    const mapped = toHttpError(
      new HTTPException(400, { message: "Malformed JSON in request body" }),
    );
    expect(mapped.status).toBe(400);
    expect(mapped.body).toEqual({
      code: "bad_request",
      message: "Malformed JSON in request body",
      issues: [],
    });
    expect(ApiErrorSchema.safeParse(mapped.body).success).toBe(true);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [413, "bad_request"],
    [422, "bad_request"],
  ] as const)("maps an HTTPException %i to code %s", (status, code) => {
    const mapped = toHttpError(new HTTPException(status, { message: "refused" }));
    expect(mapped.status).toBe(status);
    expect(mapped.body.code).toBe(code);
    expect(ApiErrorSchema.safeParse(mapped.body).success).toBe(true);
  });

  it("still hides a 5xx HTTPException's message", () => {
    const mapped = toHttpError(new HTTPException(503, { message: "token=hunter2 upstream down" }));
    expect(mapped.status).toBe(500);
    expect(mapped.body.message).toBe("internal error");
    expect(JSON.stringify(mapped.body)).not.toContain("hunter2");
  });

  it("gives a message-less HTTPException something to say", () => {
    expect(toHttpError(new HTTPException(400)).body.message).toBe("request refused");
  });
});

describe("errorResponse", () => {
  it("writes application/json with the body and the error's headers", async () => {
    const app = new Hono();
    app.get("/x", (c) => errorResponse(c, unauthorized("nope")));

    const response = await app.request("/x");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({ code: "unauthorized", message: "nope" });
  });

  it("never emits application/problem+json (Adjudication 2 dropped RFC 9457)", async () => {
    const app = new Hono();
    app.get("/x", (c) => errorResponse(c, notFound("gone")));

    const response = await app.request("/x");
    expect(response.headers.get("content-type")).not.toContain("problem");
  });
});

describe("describeThrown", () => {
  it("names the error and follows the cause chain", () => {
    const described = describeThrown(new Error("outer", { cause: new TypeError("inner") }));
    expect(described.error).toBe("Error: outer");
    expect(described.stack).toEqual(expect.any(String));
    expect(described.cause).toMatchObject({ error: "TypeError: inner" });
  });

  it("stringifies non-Error values", () => {
    expect(describeThrown("boom")).toEqual({ error: "boom" });
    expect(describeThrown(undefined)).toEqual({ error: "undefined" });
  });

  it("truncates a self-referencing cause chain instead of hanging", () => {
    const looping = new Error("loop");
    looping.cause = looping;

    // The top-level call is depth 0, so the marker replaces the cause of the
    // node at depth MAX_CAUSE_DEPTH — one level below the last real error.
    let described = describeThrown(looping);
    for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
      expect(described.error).toBe("Error: loop");
      described = described.cause as Record<string, unknown>;
    }
    expect(described.cause).toEqual({
      error: `<cause chain truncated at depth ${MAX_CAUSE_DEPTH}>`,
    });
  });
});

describe("conflict", () => {
  it("is bare: SPEC.md §7's key removed the lock it used to carry (SERVER-099)", () => {
    // The refusal that *does* carry state is `staleKey`, which answers with the
    // document as it now stands. A 409 `conflict` names no lease, because there
    // is no lease to name.
    expect(conflict("already held").body).toEqual({
      code: "conflict",
      message: "already held",
    });
  });
});

describe("staleKey", () => {
  it("carries the document as it now stands, whose own `key` is the fresh one", () => {
    // §7: "A refused write comes back with the document as it now stands and a
    // fresh key for it — not merely 'no'." The fresh key is `doc.key` and not a
    // sibling field, because two copies of one value are two things that can
    // disagree.
    const error = staleKey("you never read this version", CURRENT_DOC);
    expect(error.status).toBe(409);
    expect(error.body).toEqual({
      code: "stale_key",
      message: "you never read this version",
      doc: CURRENT_DOC,
    });
  });
});
