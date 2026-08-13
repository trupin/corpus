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
  staleKey: 9,
  patchRefused: 10,
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
  {
    code: ExitCode.staleKey,
    meaning:
      "Stale key — the document changed after the read the write was made against, so nothing was " +
      "written. On `doc edit`, re-read, merge, and resend with the fresh `--key`. On `doc patch` — which " +
      "presents no key of its own — it means an outside editor moved the file mid-operation, and re-running " +
      "the same patch is the whole recovery.",
  },
  {
    code: ExitCode.patchRefused,
    meaning:
      "Patch refused by the document's own text — `--old` matched zero times or more than once, " +
      "so nothing was written. The message names the count and which of the two it was: zero " +
      "means re-read the document, several means quote more context (or pass `--all`).",
  },
];

/**
 * The `--json` failure envelope:
 * `{"error":{"code","message","hint","changed","details"}}`.
 *
 * `changed` is **tri-state on purpose**. `false` is asserted only where the code
 * path proves nothing moved; `true` where something had already begun to move;
 * and it is **absent** everywhere the CLI cannot honestly say — a 500 from a
 * `POST` may or may not have written on the server, and claiming either would
 * replace one false promise with another. The caller's rule is one comparison:
 * `changed === false` means retry freely, anything else means re-verify first.
 *
 * `hint` is **always present, and `null` rather than absent when there is no
 * recovery** (CLI-042). Every refusal this CLI raises was written so the message
 * names its own recovery — the stale key, the patch's two conflicts, the keyless
 * write — and `--json` used to drop exactly that half, telling a machine caller
 * what happened and not what to do. It was visible on the patch route's
 * stale-key refusal, whose message is "the patch itself is still good" and whose
 * recovery (run the same patch again) lived only in the human rendering.
 *
 * Prose rather than a `{action, args}` structure, because **the machine caller
 * is the agent** — an LLM, which reads "re-read the document and run the same
 * patch again" better than it reads a schema. The usual objection to publishing
 * prose (a hint becomes an interface, and rewording it breaks parsers) assumes a
 * brittle consumer this one does not have. _(User decision, 2026-08-13.)_
 *
 * The key is never omitted so that **absence is never ambiguous**: `null` is the
 * CLI saying there is nothing to do, as against nobody having written a hint.
 */
export interface CliProblem {
  readonly code: string;
  readonly message: string;
  readonly hint: string | null;
  readonly changed?: boolean;
  readonly details?: unknown;
}

export interface CliErrorOptions {
  /**
   * One actionable follow-up line — rendered under the message for humans, and
   * carried on `--json` as `hint` (CLI-042).
   *
   * It is a follow-up the **message does not already contain**. Omitting it
   * reports `hint: null`, which says the CLI has no further instruction: either
   * the message is the whole story (a usage error that already enumerates the
   * values it would accept) or nothing about the request can be changed. The key
   * is never absent, so a caller never has to tell "no recovery" apart from
   * "nobody wrote one".
   */
  readonly hint?: string;
  /** Structured extra context: validation issues, a refused write's document, an unparsed body. */
  readonly details?: unknown;
  /**
   * A **pre-rendered** human form of {@link details}, emitted verbatim in place
   * of the JSON dump — its own indentation included, because the renderer that
   * produced it knows what its content is and this one does not.
   *
   * It exists for one failure whose details are not a diagnostic blob but a
   * document: SPEC.md §7's stale-key refusal carries the document *as it now
   * stands*, and an agent has to read that to reconcile against it. Serialised
   * as JSON it is a payload dump with the body escaped onto one line — present,
   * unreadable, and useless as the thing it is there to be. `--json` is
   * unaffected: that mode emits {@link details} structurally, which is what a
   * machine reader wants and what these lines are not.
   */
  readonly detailLines?: readonly string[];
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
  readonly detailLines: readonly string[] | undefined;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
    this.detailLines = options.detailLines;
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

/**
 * SPEC.md §7's refusal: **the key presented names a version the document no
 * longer is**, so the write did not happen.
 *
 * ## Why it is not exit 5, and not exit 7 either
 *
 * An agent branches on exit codes, and this outcome is the one where the right
 * next move is *specific and different from every neighbour's*:
 *
 * - **Not `serverError` (5).** Nothing went wrong. The mechanism worked exactly
 *   as designed — it caught a writer about to overwrite something it never read
 *   — and 5's advice ("the server returned an error") would send the caller
 *   looking for a fault that does not exist. The refusal is the feature.
 * - **Not `usageError` (2).** The command was well-formed; a key *was*
 *   presented. What is stale is the world, not the invocation, and re-reading
 *   the help would teach nothing. (A *missing* key is a usage error, and that
 *   one is caught in `doc edit` before any request is sent.)
 * - **Not `refused` (7).** Closer — nothing was changed, which this asserts too
 *   — but 7 means "your preconditions were not met, stop and reconsider",
 *   whereas here **retrying is the expected path**: re-read, merge, present the
 *   fresh key. Sharing a code with `corpus upgrade`'s refusals would make the
 *   one recoverable failure indistinguishable from the ones that are not.
 *
 * So it carries its own code, and the recovery travels with it: `details` is
 * the document as it now stands (the machine reader's copy, `--json`), and
 * `detailLines` renders it the way `corpus doc show` would (the agent's).
 */
export class StaleKeyError extends CliError {
  override readonly exitCode = ExitCode.staleKey;
  override readonly code = "stale_key";
  /** Nothing was written — that is the whole of the refusal. */
  override readonly changed = false;
  readonly status: number;

  constructor(message: string, options: CliErrorOptions & { readonly status: number }) {
    super(message, options);
    this.status = options.status;
  }
}

/**
 * SPEC.md §9.2's refusal: **the excerpt `corpus doc patch` quoted did not match
 * the document's body exactly once**, so nothing was written.
 *
 * ## Why it is its own code, and which neighbour it is not
 *
 * The argument is {@link StaleKeyError}'s, one route over — an agent branches on
 * exit codes, and this outcome's right next move is specific:
 *
 * - **Not `serverError` (5).** Nothing went wrong. The document declined to
 *   contain what the patch said it contained, which is the operation's whole
 *   safety property working: an excerpt that matches nowhere, or matches in two
 *   places, is exactly the patch that would otherwise land somewhere the caller
 *   did not mean.
 * - **Not `usageError` (2).** The invocation was well-formed and every local
 *   check passed. What is wrong is the *quote*, and the fix comes from re-reading
 *   the document — not from re-reading the help. (An `--old` that was never given
 *   at all, or was empty, *is* a usage error, and those are caught before any
 *   request is sent.)
 * - **Not `refused` (7).** 7 means "your preconditions were not met, stop and
 *   reconsider". Here retrying is the expected path — re-quote and send the same
 *   patch again — so sharing a code with `corpus upgrade`'s dead ends would make
 *   the recoverable failure indistinguishable from the ones that are not.
 * - **Not `staleKey` (9) either**, though it is the closest: 9's recovery is
 *   "read the fresh key off the document the refusal brought you and resend
 *   unchanged", and this one's is "change what you quoted". A caller that treated
 *   them alike would retry a patch that cannot ever apply.
 *
 * ## Why one code for two refusals
 *
 * The two recoveries differ — re-read versus quote more — and the CLI says which
 * in the message, the hint, and `details.reason`. But they are one *class* of
 * outcome for a caller branching on the exit status ("the text refused it,
 * nothing was written, fix the quote"), and `code` is where this CLI already
 * distinguishes within a class: {@link RefusedError} does exactly that for
 * `corpus upgrade`'s several dead ends. So the two arrive as `patch_no_match`
 * and `patch_multiple_matches` on one exit code, and `details.matches` carries
 * the count as a number rather than as a sentence a caller has to parse.
 */
export class PatchRefusedError extends CliError {
  override readonly exitCode = ExitCode.patchRefused;
  override readonly code: string;
  /** Nothing was written — the refusal happens before the save is even attempted. */
  override readonly changed = false;
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
 * Anything thrown that is not a `CliError` is reported as this.
 *
 * It carries a **default hint**, which the other classes do not, because its
 * recovery is a property of the class rather than of the call site: an internal
 * error is a defect, so there is nothing about the request to change, and the
 * one useful next step is the same every time. Without it these would report
 * `hint: null` — "the CLI has no further instruction" — while `toProblem`'s
 * fallback for a non-`CliError` said the opposite about the identical situation
 * (CLI-042). A call site that knows better still overrides it.
 */
export class InternalError extends CliError {
  override readonly exitCode = ExitCode.internalError;
  override readonly code = "internal_error";

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, { hint: INTERNAL_ERROR_HINT, ...options });
  }
}

export const INTERNAL_ERROR_HINT =
  "This is a bug in corpus rather than a problem with the request. Re-run with `--verbose` for a stack trace, and report it.";

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
      hint: error.hint ?? null,
      ...(error.changed === undefined ? {} : { changed: error.changed }),
    };
    return error.details === undefined ? problem : { ...problem, details: error.details };
  }
  // An exception that reached here is a defect rather than a refusal, so the
  // recovery is not about the corpus: there is nothing the caller can change
  // about its request to make this one succeed. Same sentence `InternalError`
  // defaults to, from the same constant, because it is the same situation
  // reached by a different road.
  return { code: "internal_error", message: messageOf(error), hint: INTERNAL_ERROR_HINT };
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
    if (error.detailLines !== undefined) {
      // Verbatim, indentation included: these lines are content (a document),
      // not a diagnostic, and re-indenting content misrepresents it.
      lines.push(...error.detailLines);
    } else if (error.details !== undefined) {
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
