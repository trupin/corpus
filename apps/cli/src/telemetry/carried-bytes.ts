/**
 * The bytes an invocation carried in **beside its argv** (SPEC.md §9.4,
 * CLI-085) — a heredoc, a pipe, or the file behind a payload flag.
 *
 * `wroteBytes` has two halves. One is the argv, which `run.ts` has in its hand
 * and measures there. The other is every byte that arrived by some other route,
 * and this module is that half: the verbs read a body several levels below the
 * dispatcher and none of them reports upward, so the count is taken at the read
 * and read back where the report is composed.
 *
 * **A body costs what a body costs, whatever carried it.** This counter used to
 * take stdin only, on the argument that a `--file` names a path and the file's
 * contents are not something the invocation carried. The PHASE-59 evaluation
 * measured what that argument costs in practice: the identical 2100-byte reply
 * reported 182 bytes through `--flag-file` and 2143 through a heredoc, and a
 * 5107-byte document body written with `--file` reported its 224-byte argv. The
 * panel exists to answer "is working with this document getting more
 * expensive?", and an agent could halve the answer by changing transport —
 * toward the transport `corpus --help` recommends for the largest payloads,
 * because it is the injection-safe one. So both routes count, and the two
 * arithmetics agree to the byte.
 *
 * **Counted at the read, which is what the caller wrote.** `--flag-file` drops
 * one trailing newline from the value it builds, so a file ending in one is
 * charged a byte more than the value that goes on the wire. That is the right
 * end to count from — the caller wrote the file — and it is one byte against a
 * figure reported in tokens of four.
 *
 * **Two read sites, one funnel each.** `input.ts#readAll` is the only place
 * stdin is read, and `input.ts#readFlagFile` is the only place a flag's file is
 * read — `--file`, `--old-file`/`--new-file` and every `--flag-file` go through
 * it. The file funnel counts only what a `FlagSpec.payload` declaration marks,
 * so a future flag whose path merely names a target does not start charging its
 * target's size to a document.
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
 * **A composite verb reads it as a difference.** `corpus batch` runs several
 * invocations in one process and reports each separately, so it brackets each
 * entry's reads with {@link carriedBytes} and charges the entry the delta. That
 * works because the entries run one after another, which is also the only way a
 * batch runs.
 */

let bytes = 0;

/**
 * Adds one read's bytes. Called by `input.ts#readAll` and
 * `input.ts#readFlagFile`, and nowhere else.
 */
export function countCarriedBytes(text: string): void {
  bytes += Buffer.byteLength(text, "utf8");
}

/** What this run has carried in so far, beside its argv. */
export function carriedBytes(): number {
  return bytes;
}

/** `run.ts`'s first act, so one process may serve more than one run in tests. */
export function resetCarriedBytes(): void {
  bytes = 0;
}
