import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  ConflictErrorSchema,
  ERROR_CODES,
  ErrorCodeSchema,
  ForbiddenErrorSchema,
  InternalErrorSchema,
  isApiError,
  LockConflictErrorSchema,
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
    name: "LockConflictError",
    schema: LockConflictErrorSchema,
    value: { code: "conflict", message: "doc_a1b2c3 is already locked.", lock },
  },
  {
    name: "LockedError",
    schema: LockedErrorSchema,
    value: { code: "locked", message: "doc_a1b2c3 is being edited.", lock },
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

  it("rejects a locked error that does not name the blocking lock", () => {
    expect(isApiError({ code: "locked", message: "held" })).toBe(false);
  });

  it("discriminates cleanly on `code`, so one check narrows the union", () => {
    const parsed = ApiErrorSchema.parse({ code: "locked", message: "held", lock });
    expect(parsed.code === "locked" ? parsed.lock.holder : undefined).toBe("user");
  });

  /**
   * 409 and 423 are deliberately different answers: "your lock request conflicts
   * with a holder" versus "this write is refused because the document is locked".
   * They must not collapse into one code.
   */
  it("keeps conflict and locked distinct", () => {
    expect(ApiErrorSchema.parse({ code: "conflict", message: "held", lock }).code).toBe("conflict");
    expect(ApiErrorSchema.parse({ code: "locked", message: "held", lock }).code).toBe("locked");
  });

  it("accepts a conflict that carries no lock, since not every conflict is one", () => {
    expect(isApiError({ code: "conflict", message: "already resolved" })).toBe(true);
  });

  /**
   * `LockConflictError` narrows `ConflictError` rather than adding a second
   * `conflict` variant, so the union keeps exactly one member per code while the
   * lock-acquire route can still promise the lock is present.
   */
  it("parses a lock conflict as the general conflict variant too", () => {
    const value = { code: "conflict", message: "held", lock };
    expect(ConflictErrorSchema.parse(value)).toEqual(value);
    expect(LockConflictErrorSchema.safeParse({ code: "conflict", message: "held" }).success).toBe(
      false,
    );
  });

  it.each([null, undefined, "not an error", 42, {}])("rejects %s", (value) => {
    expect(isApiError(value)).toBe(false);
  });
});
