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
];

/** The `--json` failure envelope: `{"error":{"code","message","details"}}`. */
export interface CliProblem {
  readonly code: string;
  readonly message: string;
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
    const problem: CliProblem = { code: error.code, message: error.message };
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
