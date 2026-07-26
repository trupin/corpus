import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  ERROR_CODES,
  ErrorCodeSchema,
  isApiError,
  LockedErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from "./error.js";

const lock = {
  docId: "doc_a1b2c3",
  holder: "user",
  acquired: "2026-07-19T10:05:00Z",
  ttl: 300,
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
    name: "NotFoundError",
    schema: NotFoundErrorSchema,
    value: { code: "not_found", message: "No document doc_missing1." },
  },
  {
    name: "LockedError",
    schema: LockedErrorSchema,
    value: { code: "locked", message: "doc_a1b2c3 is being edited.", lock },
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

  it("rejects a locked error that does not name the blocking lock", () => {
    expect(isApiError({ code: "locked", message: "held" })).toBe(false);
  });

  it.each([null, undefined, "not an error", 42, {}])("rejects %s", (value) => {
    expect(isApiError(value)).toBe(false);
  });
});
