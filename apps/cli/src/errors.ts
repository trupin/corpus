/**
 * The CLI's uniform failure surface (SPEC.md §2.3). Every command failure is a
 * `CliError`: it carries the exit code, a machine-readable `code` for `--json`,
 * a human message, an optional actionable hint, and optional details. Handlers
 * therefore never map errors to exit codes themselves.
 */

export const ExitCode = {
  success: 0,
  internalError: 1,
  usageError: 2,
  noWorkspace: 3,
  serverUnreachable: 4,
  serverError: 5,
  checkFailed: 6,
  refused: 7,
  partialFailure: 8,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Documented in `docs/cli.md`; the generator reads this list, so it cannot drift. */
export const EXIT_CODES: readonly { readonly code: ExitCode; readonly meaning: string }[] = [
  { code: ExitCode.success, meaning: "Success." },
  { code: ExitCode.internalError, meaning: "Internal error — an unexpected exception." },
  {
    code: ExitCode.usageError,
    meaning: "Usage error — unknown command, bad flag, missing argument.",
  },
  {
    code: ExitCode.noWorkspace,
    meaning: "Not inside a Corpus workspace, or its config is invalid.",
  },
  { code: ExitCode.serverUnreachable, meaning: "The workspace server is unreachable." },
  { code: ExitCode.serverError, meaning: "The server returned an error response." },
  {
    code: ExitCode.checkFailed,
    meaning: "A check-style command reported a failure (its work succeeded).",
  },
  {
    code: ExitCode.refused,
    meaning: "Refused — a precondition was not met, and nothing was changed.",
  },
  {
    code: ExitCode.partialFailure,
    meaning: "Failed partway — something had already been changed, so verify before retrying.",
  },
];

/**
 * The `--json` failure envelope: `{"error":{"code","message","changed","details"}}`.
 *
 * `changed` is **tri-state on purpose**. `false` is asserted only where the code
 * path proves nothing moved; `true` where something had already begun to move;
 * and it is **absent** everywhere the CLI cannot honestly say — a 500 from a
 * `POST` may or may not have written on the server, and claiming either would
 * replace one false promise with another. The caller's rule is one comparison:
 * `changed === false` means retry freely, anything else means re-verify first.
 */
export interface CliProblem {
  readonly code: string;
  readonly message: string;
  readonly changed?: boolean;
  readonly details?: unknown;
}

export interface CliErrorOptions {
  /** One actionable follow-up line, rendered under the message for humans. */
  readonly hint?: string;
  /** Structured extra context: validation issues, a held lock, an unparsed body. */
  readonly details?: unknown;
  readonly cause?: unknown;
}

export abstract class CliError extends Error {
  abstract readonly exitCode: ExitCode;
  abstract readonly code: string;
  /**
   * Whether this failure left anything changed, when that is knowable. Only the
   * two errors whose whole meaning is the answer override it: `RefusedError`
   * (`false`) and `PartialFailureError` (`true`). Every other failure leaves it
   * `undefined`, which is the honest answer for most of them.
   */
  readonly changed: boolean | undefined = undefined;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
  }
}

/** Unknown command, unknown flag, missing argument, malformed value. */
export class UsageError extends CliError {
  override readonly exitCode = ExitCode.usageError;
  override readonly code = "usage_error";
}

/** No `.corpus/config.json` in the current directory or any ancestor. */
export class WorkspaceNotFoundError extends CliError {
  override readonly exitCode = ExitCode.noWorkspace;
  override readonly code = "no_workspace";
}

/** A workspace was found but its config cannot be read or does not validate. */
export class WorkspaceConfigError extends CliError {
  override readonly exitCode = ExitCode.noWorkspace;
  override readonly code = "invalid_workspace_config";
}

/** Transport failure: nothing listening, connection reset, request timed out. */
export class ServerUnreachableError extends CliError {
  override readonly exitCode = ExitCode.serverUnreachable;
  override readonly code = "server_unreachable";
}

/** A non-2xx response. `code` mirrors the contract's `ApiError.code` when the body is one. */
export class ServerResponseError extends CliError {
  override readonly exitCode = ExitCode.serverError;
  override readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    options: CliErrorOptions & { readonly code: string; readonly status: number },
  ) {
    super(message, options);
    this.code = options.code;
    this.status = options.status;
  }
}

/**
 * The command ran successfully and its answer is "no" — `doc check` and
 * `db doctor` use this so hooks can distinguish a failed check from a crash.
 */
export class CheckFailedError extends CliError {
  override readonly exitCode = ExitCode.checkFailed;
  override readonly code = "check_failed";
}

/**
 * The command declined to act, and **nothing was changed**.
 *
 * Distinct from every code above it because the three obvious alternatives all
 * say something false. `internal_error` claims an unexpected exception, when a
 * refusal is the most deliberate thing the command does; `check_failed` claims
 * the work succeeded and its answer was "no", when here no work was attempted;
 * and a `0` would tell a caller that what it asked for happened.
 *
 * Introduced for `corpus upgrade` (SPEC.md §2.4), whose whole safety story is
 * refusing rather than guessing — an unverifiable release, an install method it
 * cannot detect, a checksum that does not match — and every one of those must be
 * distinguishable by a caller from "corpus crashed". Nothing about it is
 * upgrade-specific: it is the general "your preconditions were not met, and I
 * left everything alone" answer, and `code` names which precondition.
 *
 * **"Nothing was changed" is load-bearing, not decoration.** A caller reads it
 * as permission to skip re-verifying, so a failure that got as far as changing
 * something is not a refusal however deliberate it looks — it is a
 * `PartialFailureError` (CLI-030).
 */
export class RefusedError extends CliError {
  override readonly exitCode = ExitCode.refused;
  override readonly code: string;
  override readonly changed = false;

  constructor(message: string, options: CliErrorOptions & { readonly code: string }) {
    super(message, options);
    this.code = options.code;
  }
}

/**
 * The command began, changed something, and then failed — so its effect is
 * **unknown** and the caller has to look before it acts again.
 *
 * This is the honest half of what exit 7 used to claim for everything
 * (CLI-030). `corpus upgrade` stops the workspace's server and hands the global
 * package to npm; if npm then fails, or an interrupt ends the window, the run
 * has already: taken the board down (it is restarted, but that can fail too),
 * and possibly left npm's replacement of the package half-applied. Reporting
 * that as "refused — nothing was changed" tells an agent it may retry without
 * checking, which is precisely the wrong conclusion after a half-finished
 * install.
 *
 * Distinct from `internal_error`, which means an *unexpected* exception: this
 * outcome is expected, named, and reported — what is unknown is the state left
 * behind, not the reason. Distinct from `RefusedError` by exactly one fact, and
 * that fact is carried twice: as exit code 8 for a caller reading a shell exit
 * status, and as `changed: true` in the `--json` envelope for a caller reading a
 * payload — including a reader of `.corpus/upgrade.log`, which is a detached
 * upgrade's only witness and has no exit code in it at all.
 */
export class PartialFailureError extends CliError {
  override readonly exitCode = ExitCode.partialFailure;
  override readonly code: string;
  override readonly changed = true;

  constructor(message: string, options: CliErrorOptions & { readonly code: string }) {
    super(message, options);
    this.code = options.code;
  }
}

/** Anything thrown that is not a `CliError` is reported as this. */
export class InternalError extends CliError {
  override readonly exitCode = ExitCode.internalError;
  override readonly code = "internal_error";
}

export function isCliError(value: unknown): value is CliError {
  return value instanceof CliError;
}

export function exitCodeFor(error: unknown): ExitCode {
  return isCliError(error) ? error.exitCode : ExitCode.internalError;
}

export function toProblem(error: unknown): CliProblem {
  if (isCliError(error)) {
    const problem: CliProblem = {
      code: error.code,
      message: error.message,
      ...(error.changed === undefined ? {} : { changed: error.changed }),
    };
    return error.details === undefined ? problem : { ...problem, details: error.details };
  }
  return { code: "internal_error", message: messageOf(error) };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unexpected internal error";
}

/**
 * Human rendering of a failure: `corpus: <message>`, the hint, then details.
 * `verbose` adds the stack, which is the only place a stack ever appears.
 */
export function renderError(error: unknown, options: { readonly verbose: boolean }): string {
  const lines: string[] = [`corpus: ${messageOf(error)}`];
  if (isCliError(error)) {
    // A person does not see the exit code, so the one fact that decides what
    // they do next is said out loud (CLI-030). Only ever printed where the
    // error class asserts it — silence here is not a claim that nothing moved.
    if (error.changed === true) {
      lines.push(
        "  This failed partway: something had already been changed — verify before retrying.",
      );
    }
    if (error.hint !== undefined) lines.push(`  ${error.hint}`);
    if (error.details !== undefined) {
      for (const line of formatDetails(error.details)) lines.push(`  ${line}`);
    }
  }
  if (options.verbose && error instanceof Error && error.stack !== undefined) {
    lines.push(error.stack);
  }
  return `${lines.join("\n")}\n`;
}

function formatDetails(details: unknown): readonly string[] {
  return JSON.stringify(details, null, 2)?.split("\n") ?? [String(details)];
}
