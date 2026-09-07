/**
 * How many bytes fd 0 handed **this** invocation (SPEC.md §9.4, CLI-085).
 *
 * The other half of `wroteBytes` is the argv, which `run.ts` has in its hand.
 * The body does not reach `run.ts` at all: `resolveBody` is called by some
 * thirty verbs, several levels below the dispatcher, and each of them decides
 * for itself whether a body was offered. So the count is taken where the read
 * happens — in `input.ts#readAll`, the one funnel every stdin read goes through
 * — and read back where the report is composed.
 *
 * **A module-level total, reset at the start of every run.** That is a
 * deliberate choice and not an oversight: one `corpus` invocation is one
 * process, so "this invocation" and "this module instance" are the same scope
 * in production. The reset exists for the one place they are not — a test suite
 * calling `run()` many times in one worker — and it is `run.ts`'s first act, so
 * a second run cannot inherit the first one's body. Threading a counter through
 * `InputDependencies` instead would put a measurement argument in thirty verb
 * signatures to serve a fact none of them uses.
 *
 * **Only stdin is counted here.** `-m "…"` is argv and is already counted
 * there. `--file <path>` and `--flag-file <flag>=<path>` name a path in the
 * argv and read the bytes from disk: the caller wrote the path, and the file's
 * contents are not something the invocation carried. §9.4 measures what the
 * caller wrote *into* the invocation, and a heredoc or a pipe is that.
 */

let bytes = 0;

/** Adds one read's bytes. Called by `input.ts#readAll` and nowhere else. */
export function countStdinBytes(text: string): void {
  bytes += Buffer.byteLength(text, "utf8");
}

/** What fd 0 has handed this run so far. */
export function stdinBytesRead(): number {
  return bytes;
}

/** `run.ts`'s first act, so one process may serve more than one run in tests. */
export function resetStdinBytes(): void {
  bytes = 0;
}
