import { describe, expect, it } from "vitest";
import {
  CheckFailedError,
  type CliError,
  EXIT_CODES,
  ExitCode,
  INTERNAL_ERROR_HINT,
  InternalError,
  PartialFailureError,
  PatchRefusedError,
  RefusedError,
  ServerResponseError,
  ServerUnreachableError,
  StaleKeyError,
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

  it("carries the refusal's own reason code", () => {
    const error = new RefusedError("the release publishes no checksum", {
      code: "upgrade_unverifiable",
    });
    expect(exitCodeFor(error)).toBe(ExitCode.refused);
    expect(error.code).toBe("upgrade_unverifiable");
    expect(error.name).toBe("RefusedError");
  });

  it("documents every code from 0 to 11 exactly once", () => {
    // Contiguous and gapless: the list is what `docs/cli.md`'s exit-code table
    // is generated from, so a code that exists and is not here is a code no
    // caller can look up.
    expect(EXIT_CODES.map((entry) => entry.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const entry of EXIT_CODES) expect(entry.meaning.length).toBeGreaterThan(0);
  });

  it("gives a patch refusal its own code, distinct from its nearest neighbours", () => {
    // Both refusals share exit 10 — one class of outcome for a caller reading a
    // shell status — and are told apart by `code`, exactly as `RefusedError`'s
    // several dead ends are. Sharing 9 would be worse than sharing 7: a stale
    // key is resent unchanged, a refused patch never applies until the quote
    // changes.
    const none = new PatchRefusedError("matched 0 times", {
      code: "patch_no_match",
      status: 409,
    });
    const several = new PatchRefusedError("occurs 3 times", {
      code: "patch_multiple_matches",
      status: 409,
    });

    expect([none.exitCode, several.exitCode]).toEqual([ExitCode.patchRefused, 10]);
    expect(none.exitCode).not.toBe(ExitCode.staleKey);
    expect(none.exitCode).not.toBe(ExitCode.refused);
    expect(none.code).not.toBe(several.code);
    // Nothing was written, and the envelope says so without being asked.
    expect(toProblem(none)).toMatchObject({ code: "patch_no_match", changed: false });
    expect(none.name).toBe("PatchRefusedError");
  });

  it("separates a refusal that changed nothing from a failure that changed something", () => {
    // The distinction exit 7 used to blur (CLI-030). It is carried twice on
    // purpose: as an exit code for a caller reading a shell status, and as
    // `changed` for one reading a payload — `.corpus/upgrade.log` has the
    // second and no exit code at all.
    const refused = new RefusedError("the release publishes no checksum", {
      code: "upgrade_unverifiable",
    });
    const partial = new PartialFailureError("the install command failed", {
      code: "upgrade_install_failed",
    });

    expect([refused.exitCode, refused.changed]).toEqual([ExitCode.refused, false]);
    expect([partial.exitCode, partial.changed]).toEqual([ExitCode.partialFailure, true]);
    expect(partial.name).toBe("PartialFailureError");
  });

  it("leaves `changed` unsaid on every failure that cannot honestly answer it", () => {
    // A 500 from a POST may or may not have written. Asserting `false` there
    // would replace one false promise with another.
    for (const error of [
      new UsageError("bad usage"),
      new InternalError("boom"),
      new CheckFailedError("check failed"),
      new ServerResponseError("500 internal: nope", { code: "internal", status: 500 }),
      new ServerUnreachableError("down"),
    ]) {
      expect(error.changed).toBeUndefined();
    }
  });
});

describe("the machine surface carries the recovery (CLI-042)", () => {
  // The point of the issue: `--json` used to tell a caller what happened and
  // not what to do, and the caller it exists for is the agent. One case per
  // error class, because a partial answer leaves a caller guessing which errors
  // carry a recovery.
  //
  // **These construct their own errors, so the table below asserts that
  // `toProblem` carries a hint through every class — not that any production
  // call site sets one.** That second claim is a different test and is made
  // where the errors are really built: `commands/doc/render.test.ts` drives
  // `staleKeyError` itself, including the patch refusal whose recovery is the
  // defect this issue was filed about.
  const withHint: readonly [string, CliError][] = [
    ["UsageError", new UsageError("bad usage", { hint: "Run `corpus doc --help`." })],
    [
      "WorkspaceNotFoundError",
      new WorkspaceNotFoundError("no workspace", { hint: "Run `corpus init`." }),
    ],
    [
      "WorkspaceConfigError",
      new WorkspaceConfigError("bad config", { hint: "Check `.corpus/config.json`." }),
    ],
    [
      "ServerUnreachableError",
      new ServerUnreachableError("down", { hint: "Run `corpus server start`." }),
    ],
    [
      "ServerResponseError",
      new ServerResponseError("400 bad_request: nope", {
        code: "bad_request",
        status: 400,
        hint: "Fix the named field and retry.",
      }),
    ],
    [
      "CheckFailedError",
      new CheckFailedError("2 problems", { hint: "Fix them and re-run `corpus doc check`." }),
    ],
    [
      "RefusedError",
      new RefusedError("refused", { code: "refused", hint: "Nothing changed; retry freely." }),
    ],
    [
      "PartialFailureError",
      new PartialFailureError("halfway", {
        code: "interrupted",
        hint: "Re-verify before retrying.",
      }),
    ],
    ["InternalError", new InternalError("boom")],
  ];

  it.each(withHint)("%s reports its recovery on the machine surface", (_name, error) => {
    const hint = toProblem(error).hint;
    expect(hint).not.toBeNull();
    expect(hint).not.toBe("");
  });

  it("says so explicitly when there is no recovery, rather than omitting the field", () => {
    const problem = toProblem(new UsageError("bad usage"));
    // Present and null — not absent. Absence would leave a caller unable to
    // tell "there is nothing to do" from "nobody wrote a hint".
    expect(problem).toHaveProperty("hint");
    expect(problem.hint).toBeNull();
  });

  it("gives an internal error the same recovery whichever road reaches it", () => {
    // A thrown non-CliError and an InternalError are the same situation, and
    // used to disagree: the fallback had a sentence and the class had none.
    expect(toProblem(new InternalError("boom")).hint).toBe(INTERNAL_ERROR_HINT);
    expect(toProblem(new Error("boom")).hint).toBe(INTERNAL_ERROR_HINT);
    expect(toProblem("boom").hint).toBe(INTERNAL_ERROR_HINT);
  });

  it("lets a call site override the internal default", () => {
    const problem = toProblem(new InternalError("boom", { hint: "Something specific." }));
    expect(problem.hint).toBe("Something specific.");
  });

  it("carries the stale-key recovery, the refusal that prompted the issue", () => {
    // SPEC.md §7's refusal: the message says the write was refused, and the
    // recovery — re-read, then write against the fresh key — was human-only.
    const error = new StaleKeyError("the write was refused", {
      status: 409,
      hint: "Re-read the document and write again against the key it hands you.",
      details: { id: "doc_a1b2c3" },
    });
    expect(toProblem(error).hint).toContain("Re-read");
  });
});

describe("toProblem", () => {
  it("omits details when there are none", () => {
    expect(toProblem(new UsageError("bad usage"))).toEqual({
      code: "usage_error",
      message: "bad usage",
      // Always keyed, `null` when there is no follow-up beyond the message
      // (CLI-042) — so a caller never has to tell "no recovery" apart from
      // "nobody wrote one".
      hint: null,
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
      hint: null,
      details: [{ path: "body.title", message: "Required" }],
    });
  });

  it("carries `changed` into the envelope whenever the failure knows it", () => {
    expect(toProblem(new RefusedError("nope", { code: "upgrade_unverifiable" }))).toEqual({
      code: "upgrade_unverifiable",
      message: "nope",
      hint: null,
      changed: false,
    });
    expect(
      toProblem(
        new PartialFailureError("halfway", { code: "upgrade_interrupted", details: { pid: 7 } }),
      ),
    ).toEqual({
      code: "upgrade_interrupted",
      message: "halfway",
      hint: null,
      changed: true,
      details: { pid: 7 },
    });
    expect(toProblem(new UsageError("bad usage"))).not.toHaveProperty("changed");
  });

  it("falls back for thrown non-Errors", () => {
    expect(toProblem("just a string")).toEqual({
      code: "internal_error",
      message: "just a string",
      hint: INTERNAL_ERROR_HINT,
    });
    expect(toProblem({ weird: true })).toEqual({
      code: "internal_error",
      message: "unexpected internal error",
      hint: INTERNAL_ERROR_HINT,
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

  it("says out loud that a failure changed something, and only then", () => {
    // A person never sees the exit code, so the fact that decides what they do
    // next has to be in the text (CLI-030).
    const partial = renderError(
      new PartialFailureError("the install command failed", {
        code: "upgrade_install_failed",
        hint: "Check `corpus --version`.",
      }),
      { verbose: false },
    );
    expect(partial).toContain("This failed partway");
    expect(partial).toContain("Check `corpus --version`.");

    const refused = renderError(new RefusedError("nope", { code: "upgrade_unverifiable" }), {
      verbose: false,
    });
    expect(refused).not.toContain("failed partway");
    expect(renderError(new UsageError("bad usage"), { verbose: false })).not.toContain(
      "failed partway",
    );
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
