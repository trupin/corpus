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
  /**
   * A human-readable aside on **stderr**, suppressed under `--json`.
   *
   * The one caller is the queue's in-progress report (SPEC.md §7, CLI-029), and
   * it needs this channel rather than {@link line} for a reason specific to
   * `queue claim-all`: that command's stdout is a machine payload in *both*
   * modes — the orchestrate skill runs the bare verb and parses stdout, and
   * `docs/cli.md` publishes `corpus queue claim-all | jq …`. Prose appended
   * there would break every one of those readers. stderr is the conventional
   * channel for diagnostics beside a machine payload, and the stream split is
   * itself the guarantee §7 asks for: what you just claimed is on stdout, what
   * the server thinks you already had is on stderr, and nothing can confuse the
   * two.
   *
   * Suppressed under `--json` because stderr in that mode is reserved for the
   * `{"error":{…}}` envelope, and the same data is already in the JSON value.
   */
  note(text: string): void;
  /**
   * Text that must reach stdout in both modes. Two legitimate callers: help,
   * which is documentation rather than data, and `queue claim-all`, whose one
   * JSON line *is* its output in human mode too.
   */
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

    note(text: string): void {
      if (options.json) return;
      options.stderr(`${text}\n`);
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

/**
 * An `Output` for a command run as a **step of another command**.
 *
 * `corpus upgrade` (SPEC.md §2.4) is one verb that performs several: it calls
 * `corpus server stop`, the workspace template sync, and `corpus server start`,
 * all of which are ordinary handlers that emit their own single JSON value and
 * print their own one-liners. Handed the real output, the second `emit` would
 * throw — `--json` guarantees exactly one value — and the composite command
 * would be defeated by its own invariant.
 *
 * So a nested output keeps the invariant instead of relaxing it: the step's JSON
 * value is **captured** for the caller to fold into its own report, and the
 * step's human lines are passed through indented, because a person watching an
 * upgrade wants to see `stopped (pid 4711)` as it happens. Nothing reaches
 * stdout that the parent did not choose to put there.
 *
 * **`json` reports the invocation's mode, and always did have to** (CLI-068).
 * It was hardcoded `false` here, which conflated two different things: *a step
 * may not print a JSON document* — true, and enforced structurally below, since
 * `emit` captures and `write` routes through `line` — with *this invocation is
 * in human mode*, which is the parent's fact and is not the nested output's to
 * invent. A handful of commands read `out.json` to choose what they produce
 * rather than merely how they print it, and every one of them was told the
 * wrong answer inside `corpus batch --json`: `queue claim-all` writes its
 * payload with `out.write` in human mode, so under a `--json` batch it took the
 * human branch, its claim went to the suppressed human channel, and the report
 * said `value: null` for a command that had just claimed the queue. `doc list
 * --fields` refused itself for want of a `--json` that was present, and `server
 * logs --follow` streamed forever instead of being refused. Propagating the
 * parent's mode fixes all four at the source. Nothing here lets a step print:
 * that is the mechanism's job, not the flag's.
 */
export interface NestedOutput {
  readonly output: Output;
  /** The single value the nested command emitted, or `undefined` if it emitted none. */
  value(): unknown;
  /** Every human line the nested command produced, unprefixed. */
  lines(): readonly string[];
}

export function createNestedOutput(parent: Output, prefix = "  "): NestedOutput {
  const lines: string[] = [];
  let value: unknown;

  return {
    value: () => value,
    lines: () => lines,
    output: {
      // The invocation's mode, unaltered. A step must not *print* JSON, and it
      // cannot: `emit` captures and `write` routes through `line`. Telling it
      // the mode was human in order to secure that was the CLI-068 defect — a
      // command that chooses its payload by the mode then chose the wrong one.
      json: parent.json,
      color: parent.color,
      emit(next: unknown): void {
        value = next;
      },
      line(text: string): void {
        lines.push(text);
        parent.line(`${prefix}${text}`);
      },
      // A note is a diagnostic, not the step's result, so it is passed through
      // indented rather than captured: the composite report has no field for it,
      // and a person watching still wants to see it as it happens.
      note(text: string): void {
        parent.note(`${prefix}${text}`);
      },
      write(text: string): void {
        for (const line of text.split("\n")) {
          if (line !== "") this.line(line);
        }
      },
      fail(error: unknown, failOptions: { readonly verbose: boolean }): void {
        // Nested handlers report failure by throwing, which the parent catches.
        // Reaching here would mean a step wrote a failure the composite report
        // never learned about, so it is surfaced rather than swallowed.
        parent.fail(error, failOptions);
      },
      bold: (text: string) => parent.bold(text),
    },
  };
}
