import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiErrorSchema, ERROR_CODES, type Lock } from "@corpus/contract";
import {
  ConfigError,
  CorpusError,
  HttpError,
  MAX_CAUSE_DEPTH,
  badRequest,
  describeThrown,
  errorResponse,
  forbidden,
  internalError,
  locked,
  notFound,
  toHttpError,
  toValidationIssues,
  unauthorized,
} from "./errors.js";

const LOCK: Lock = {
  docId: "doc_abc",
  holder: "user",
  acquired: "2026-07-26T10:00:00.000Z",
  ttl: 300,
};

/** One error from every factory the server exposes. */
const ALL_FACTORY_ERRORS = [
  badRequest("b", []),
  unauthorized("u"),
  forbidden("f"),
  notFound("n"),
  locked("l", LOCK),
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
    [locked("held", LOCK), 423, "locked"],
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
    // Codes the contract declares but no factory covers yet (`conflict` lands
    // with the lock routes) are allowed — the pin is one-directional.
    expect(new Set(emitted).size).toBe(emitted.length);
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
