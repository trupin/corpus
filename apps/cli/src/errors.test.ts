import { describe, expect, it } from "vitest";
import {
  CheckFailedError,
  EXIT_CODES,
  ExitCode,
  InternalError,
  ServerResponseError,
  ServerUnreachableError,
  UsageError,
  WorkspaceConfigError,
  WorkspaceNotFoundError,
  exitCodeFor,
  isCliError,
  renderError,
  toProblem,
} from "./errors.js";

describe("exit codes", () => {
  it.each([
    [new UsageError("bad usage"), ExitCode.usageError, "usage_error"],
    [new WorkspaceNotFoundError("no workspace"), ExitCode.noWorkspace, "no_workspace"],
    [new WorkspaceConfigError("bad config"), ExitCode.noWorkspace, "invalid_workspace_config"],
    [new ServerUnreachableError("down"), ExitCode.serverUnreachable, "server_unreachable"],
    [new CheckFailedError("check failed"), ExitCode.checkFailed, "check_failed"],
    [new InternalError("boom"), ExitCode.internalError, "internal_error"],
  ])("maps %s to its exit code and machine-readable code", (error, code, machineCode) => {
    expect(exitCodeFor(error)).toBe(code);
    expect(error.code).toBe(machineCode);
    expect(error.name).toBe(error.constructor.name);
  });

  it("carries the server's own code on a ServerResponseError", () => {
    const error = new ServerResponseError("401 unauthorized: nope", {
      code: "unauthorized",
      status: 401,
    });
    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(error.code).toBe("unauthorized");
    expect(error.status).toBe(401);
  });

  it("treats anything that is not a CliError as an internal error", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(ExitCode.internalError);
    expect(exitCodeFor("a string")).toBe(ExitCode.internalError);
    expect(isCliError(new Error("boom"))).toBe(false);
  });

  it("documents every code from 0 to 6 exactly once", () => {
    expect(EXIT_CODES.map((entry) => entry.code)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const entry of EXIT_CODES) expect(entry.meaning.length).toBeGreaterThan(0);
  });
});

describe("toProblem", () => {
  it("omits details when there are none", () => {
    expect(toProblem(new UsageError("bad usage"))).toEqual({
      code: "usage_error",
      message: "bad usage",
    });
  });

  it("includes details when the error carries them", () => {
    const error = new ServerResponseError("400 bad_request: invalid", {
      code: "bad_request",
      status: 400,
      details: [{ path: "body.title", message: "Required" }],
    });
    expect(toProblem(error)).toEqual({
      code: "bad_request",
      message: "400 bad_request: invalid",
      details: [{ path: "body.title", message: "Required" }],
    });
  });

  it("falls back for thrown non-Errors", () => {
    expect(toProblem("just a string")).toEqual({
      code: "internal_error",
      message: "just a string",
    });
    expect(toProblem({ weird: true })).toEqual({
      code: "internal_error",
      message: "unexpected internal error",
    });
  });
});

describe("renderError", () => {
  it("renders message, hint and details as indented lines", () => {
    const rendered = renderError(
      new ServerResponseError("400 bad_request: invalid", {
        code: "bad_request",
        status: 400,
        hint: "Fix the body.",
        details: [{ path: "body.title", message: "Required" }],
      }),
      { verbose: false },
    );
    expect(rendered.startsWith("corpus: 400 bad_request: invalid\n")).toBe(true);
    expect(rendered).toContain("  Fix the body.");
    expect(rendered).toContain('"path": "body.title"');
  });

  it("renders a plain string throw", () => {
    expect(renderError("boom", { verbose: false })).toBe("corpus: boom\n");
  });

  it("appends the stack only under verbose", () => {
    const error = new UsageError("bad usage");
    expect(renderError(error, { verbose: false })).not.toContain("errors.test.ts");
    expect(renderError(error, { verbose: true })).toContain("UsageError: bad usage");
  });

  it("keeps the original cause for debugging", () => {
    const cause = new Error("socket closed");
    const error = new ServerUnreachableError("down", { cause });
    expect(error.cause).toBe(cause);
  });
});
