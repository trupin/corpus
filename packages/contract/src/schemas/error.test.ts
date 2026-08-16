import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  ConflictErrorSchema,
  ERROR_CODES,
  ErrorCodeSchema,
  ForbiddenErrorSchema,
  InternalErrorSchema,
  isApiError,
  NotFoundErrorSchema,
  StaleKeyErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from "./error.js";

/** A key is 64 lowercase hex characters; nothing here parses one. */
const KEY = "a".repeat(64);

const doc = {
  frontmatter: {
    id: "doc_a1b2c3",
    type: "note",
    title: "Mortgage options",
    created: "2026-07-19T10:00:00Z",
    updated: "2026-07-19T10:42:00Z",
    tags: ["finance"],
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
  },
  body: "Body, as it now stands.",
  path: "data/docs/mortgage.md",
  anchors: [],
  key: KEY,
  userEditing: false,
};

const variants = [
  {
    name: "ValidationError",
    schema: ValidationErrorSchema,
    value: {
      code: "bad_request",
      message: "Request body failed validation.",
      issues: [{ path: "body.title", message: "Expected a non-empty string." }],
    },
  },
  {
    name: "UnauthorizedError",
    schema: UnauthorizedErrorSchema,
    value: { code: "unauthorized", message: "Missing bearer token." },
  },
  {
    name: "ForbiddenError",
    schema: ForbiddenErrorSchema,
    value: { code: "forbidden", message: "The agent archives, never deletes." },
  },
  {
    name: "NotFoundError",
    schema: NotFoundErrorSchema,
    value: { code: "not_found", message: "No document doc_missing1." },
  },
  {
    name: "ConflictError",
    schema: ConflictErrorSchema,
    value: { code: "conflict", message: "Only a failed job can be retried." },
  },
  {
    name: "StaleKeyError",
    schema: StaleKeyErrorSchema,
    value: {
      code: "stale_key",
      message: "doc_a1b2c3 changed since you read it.",
      doc,
    },
  },
  {
    name: "InternalError",
    schema: InternalErrorSchema,
    value: { code: "internal_error", message: "Unexpected server error." },
  },
] as const;

describe.each(variants)("$name", ({ schema, value }) => {
  it("round-trips", () => {
    expect(schema.parse(value)).toEqual(value);
  });

  it("is reachable through the discriminated union", () => {
    expect(ApiErrorSchema.parse(value)).toEqual(value);
  });

  it("is recognised by isApiError", () => {
    expect(isApiError(value)).toBe(true);
  });
});

describe("ApiError", () => {
  it.each(ERROR_CODES)("declares the %s code", (code) => {
    expect(ErrorCodeSchema.parse(code)).toBe(code);
  });

  it("rejects an unknown code rather than accepting an untyped error", () => {
    expect(isApiError({ code: "teapot", message: "nope" })).toBe(false);
  });

  it("rejects a stale-key refusal that does not carry the document", () => {
    expect(isApiError({ code: "stale_key", message: "it moved" })).toBe(false);
  });

  it("rejects a stale-key refusal whose document carries no fresh key", () => {
    const { key: _dropped, ...keyless } = doc;
    expect(isApiError({ code: "stale_key", message: "it moved", doc: keyless })).toBe(false);
  });

  it("discriminates cleanly on `code`, so one check narrows the union", () => {
    const parsed = ApiErrorSchema.parse({ code: "stale_key", message: "moved", doc });
    expect(parsed.code === "stale_key" ? parsed.doc.key : undefined).toBe(KEY);
  });

  /**
   * Both are `409`s, and they are deliberately different answers: "the state
   * refuses this request" (a taken skill name, a moved re-attach range) versus
   * "you are writing against a version this document no longer is". They must
   * not collapse into one code — a client that reads `doc` off a plain conflict
   * would read `undefined`.
   */
  it("keeps conflict and stale_key distinct", () => {
    expect(ApiErrorSchema.parse({ code: "conflict", message: "taken" }).code).toBe("conflict");
    expect(ApiErrorSchema.parse({ code: "stale_key", message: "moved", doc }).code).toBe(
      "stale_key",
    );
  });

  it("accepts a conflict that carries nothing but its message", () => {
    expect(isApiError({ code: "conflict", message: "already resolved" })).toBe(true);
  });

  it("no longer declares the removed lock code", () => {
    expect([...ERROR_CODES]).not.toContain("locked");
    expect(isApiError({ code: "locked", message: "held" })).toBe(false);
  });

  /**
   * A refusal carries a whole document by design (SHARED-041 decision 5: one
   * round trip, not two), so the narrowing path has to survive a body far larger
   * than every other error. Nothing in it caps or samples the value.
   */
  it("classifies a refusal carrying a large document", () => {
    const large = { ...doc, body: "x".repeat(200_000) };
    const value = { code: "stale_key", message: "moved", doc: large };
    expect(isApiError(value)).toBe(true);
    const parsed = ApiErrorSchema.parse(value);
    expect(parsed.code === "stale_key" ? parsed.doc.body.length : 0).toBe(200_000);
  });

  it("still parses a plain conflict through the general variant", () => {
    const value = { code: "conflict", message: "that skill name is taken" };
    expect(ConflictErrorSchema.parse(value)).toEqual(value);
  });

  it.each([null, undefined, "not an error", 42, {}])("rejects %s", (value) => {
    expect(isApiError(value)).toBe(false);
  });
});
