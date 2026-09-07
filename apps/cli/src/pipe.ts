import type { Writer } from "./output.js";

/**
 * **What happens when the reader on the other end of a pipe goes away**
 * (CLI-024, CLI-041).
 *
 * A CLI whose own skills teach piping — `corpus search … | head`, `corpus doc
 * diff <id> | head -5`, `corpus doc show <id> | less` — has to end quietly when
 * its reader closes the pipe. Node makes that a deliberate act rather than a
 * default: it sets `SIGPIPE` to `SIG_IGN` at startup, so the kernel signal that
 * would ordinarily end the process never arrives, and the failed write surfaces
 * as an `EPIPE` on the stream instead. Nothing was handling it, so the process
 * died with a ten-line stack trace where the shell expected silence.
 *
 * **This is one guard, not two.** CLI-041 was filed as "the SIGPIPE guard
 * CLI-024 added does not cover `doc diff`", and the first thing this
 * implementation did was look for that guard. There was none: CLI-024 was still
 * `todo`, and `grep EPIPE apps/cli/src` matched one unrelated line in
 * `client.ts`'s retry classifier. So the verb was never missed by a per-verb
 * guard — every verb was unprotected, and both issues close on the same code.
 * The reproduction is in both issue files: `corpus doc show` and `corpus doc
 * diff` each produced `Error: write EPIPE` against a real server on 2026-08-24.
 *
 * ## Why it lives here and not in `run.ts`
 *
 * `run.ts` receives `stdout`/`stderr` as injected {@link Writer}s and never
 * touches a stream. That is deliberate and stays: the guard is about the two
 * real streams `bin/corpus.ts` owns, so it wraps them there — which is also what
 * makes it cover **every verb at once**, including the ones added after it.
 *
 * ## Two failure modes, because Node has two
 *
 * A pipe write can fail either way depending on the platform and the stream's
 * mode: `process.stdout.write` may **throw** synchronously, or the stream may
 * emit an asynchronous `error` event after `run` has already returned. Both are
 * handled, or the guard would work on one operating system and not the other.
 */

/**
 * The error codes that mean *the reader is gone*, as opposed to a real I/O
 * failure a person needs to see.
 *
 * `EPIPE` is the write to a closed pipe. The two `ERR_STREAM_*` codes are what
 * Node raises for a write issued after it has already torn the stream down,
 * which is the same event observed one tick later.
 */
export const BROKEN_PIPE_CODES: ReadonlySet<string> = new Set([
  "EPIPE",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

export function isBrokenPipe(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const { code } = error as { code?: unknown };
  return typeof code === "string" && BROKEN_PIPE_CODES.has(code);
}

/** The slice of `process.stdout` this module uses; the real streams satisfy it. */
export interface PipeStream {
  write(text: string): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

export interface PipeGuardOptions {
  readonly stdout: PipeStream;
  readonly stderr: PipeStream;
  /**
   * Ends the process, quietly and successfully. `bin/corpus.ts` passes
   * `() => process.exit(0)`; a test passes a spy, which is why the writers below
   * keep working after it returns rather than assuming it never does.
   */
  readonly quit: () => void;
}

export interface PipeGuard {
  readonly stdout: Writer;
  readonly stderr: Writer;
  /**
   * How many bytes the two streams have **delivered**, UTF-8 (SPEC.md §9.4,
   * CLI-085) — the `readBytes` of the invocation's cost report.
   *
   * The counter lives here, below the guard, for two reasons. It wraps the two
   * real streams where the guard already wraps them, so it covers every verb at
   * once including verbs added later — the same reason the guard is here rather
   * than in `run.ts`. And it counts what {@link guard} actually wrote: bytes a
   * closed pipe refused are dropped by `if (broken) return` and are not counted,
   * so `corpus … > out.json && wc -c < out.json` reproduces the reported number
   * exactly. A counter placed *above* the guard would measure bytes attempted,
   * which is a different number nobody can check by hand.
   *
   * stdout and stderr are one total, because §9.4 measures what the command
   * printed and the split between the two channels is a fact about plumbing.
   */
  bytesWritten(): number;
}

/**
 * Wraps the two real streams so a closed reader ends the run instead of crashing
 * it, and returns the {@link Writer}s `run` should be given.
 *
 * **stdout and stderr are treated differently, on purpose.**
 *
 * A broken **stdout** is the whole event: the reader asked for the first few
 * lines and has them, so the run is over. It exits **0 and silently**, which is
 * the convention every well-behaved pipeline member follows and is what the
 * ignored `SIGPIPE` would otherwise have done for us. Writing a diagnostic there
 * would be worse than useless — the only channel left is stderr, which in the
 * common `2>&1 | head` case is the very pipe that just closed.
 *
 * A broken **stderr** is not the event. It is a diagnostic channel, and losing
 * it must not change what the command reports: the writes are dropped, the run
 * continues, and the exit code stays whatever the command earned. Exiting 0
 * there would turn a failure into a success because nobody was reading the
 * complaint.
 *
 * Anything that is not a broken pipe is re-thrown from the writer or left to
 * Node's unhandled-error path from the listener. A guard that swallowed a real
 * `ENOSPC` would hide a workspace someone has to repair.
 */
export function guardPipes(options: PipeGuardOptions): PipeGuard {
  let delivered = 0;
  const count = (text: string): void => {
    delivered += Buffer.byteLength(text, "utf8");
  };

  return {
    stdout: guard(options.stdout, options.quit, count),
    stderr: guard(options.stderr, undefined, count),
    bytesWritten: () => delivered,
  };
}

function guard(
  stream: PipeStream,
  quit: (() => void) | undefined,
  count: (text: string) => void,
): Writer {
  let broken = false;

  const onBroken = (): void => {
    broken = true;
    quit?.();
  };

  stream.on("error", (error: unknown) => {
    if (isBrokenPipe(error)) {
      onBroken();
      return;
    }
    // Not our failure to absorb. Re-throwing from the listener restores exactly
    // what Node would have done with an unhandled `error` event.
    throw error;
  });

  return (text: string) => {
    // Once the reader is gone every further write fails the same way; skipping
    // them keeps a command that is mid-loop from raising the same error per line.
    if (broken) return;
    try {
      stream.write(text);
      // Counted only once the write returned — a byte a closed pipe refused was
      // never delivered, and `wc -c` on a redirect would not see it either.
      count(text);
    } catch (error) {
      if (!isBrokenPipe(error)) throw error;
      onBroken();
    }
  };
}
