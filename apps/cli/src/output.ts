import { renderError, toProblem, InternalError } from "./errors.js";

/**
 * Every byte the CLI writes goes through here (SPEC.md §2.3). Two modes:
 *
 * - `--json` (the product agent's normal mode): stdout carries exactly one JSON
 *   value and nothing else; human one-liners are suppressed; failures are a
 *   `{"error":{…}}` envelope on stderr.
 * - human: success is quiet — at most a one-liner — and nothing is ever a JSON dump.
 *
 * Help is the deliberate exception: it is human text in both modes, because help
 * is not data (documented in `docs/cli.md`).
 */

export type Writer = (text: string) => void;

export interface OutputOptions {
  readonly json: boolean;
  /** False whenever stdout is not a TTY or `--no-color` was passed. */
  readonly color: boolean;
  readonly stdout: Writer;
  readonly stderr: Writer;
}

export interface Output {
  readonly json: boolean;
  readonly color: boolean;
  /** The command's single machine-readable result. Written only under `--json`. */
  emit(value: unknown): void;
  /** A human one-liner. Suppressed under `--json` so stdout stays one JSON value. */
  line(text: string): void;
  /** Human text that is never data (help). Written to stdout in both modes. */
  write(text: string): void;
  /** Renders a failure to stderr in whichever mode is active. */
  fail(error: unknown, options: { readonly verbose: boolean }): void;
  /** Bold when colour is on, identity otherwise — so `--no-color` is real. */
  bold(text: string): string;
}

const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

export function createOutput(options: OutputOptions): Output {
  let emitted = false;

  return {
    json: options.json,
    color: options.color,

    emit(value: unknown): void {
      if (!options.json) return;
      if (emitted) {
        throw new InternalError(
          "a command tried to emit more than one JSON value; --json guarantees exactly one",
        );
      }
      emitted = true;
      options.stdout(`${JSON.stringify(value)}\n`);
    },

    line(text: string): void {
      if (options.json) return;
      options.stdout(`${text}\n`);
    },

    write(text: string): void {
      options.stdout(text);
    },

    fail(error: unknown, failOptions: { readonly verbose: boolean }): void {
      if (options.json) {
        options.stderr(`${JSON.stringify({ error: toProblem(error) })}\n`);
        return;
      }
      options.stderr(renderError(error, failOptions));
    },

    bold(text: string): string {
      return options.color ? `${BOLD}${text}${RESET}` : text;
    },
  };
}
