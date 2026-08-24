#!/usr/bin/env node
// Thin bin shim: every decision lives in src/run.ts so it stays testable.
// Excluded from coverage in the root vitest config for that reason.
//
// The one thing that cannot live there is the pipe guard (CLI-024, CLI-041):
// `run` is handed writers and never sees a stream, so wrapping the two real
// streams is this file's job. Doing it here is also what makes the guard cover
// every verb, including the ones added after it. The decisions are all in
// `src/pipe.ts`.
import { run } from "../run.js";
import { guardPipes } from "../pipe.js";

const pipes = guardPipes({
  stdout: process.stdout,
  stderr: process.stderr,
  // A reader that closed the pipe has what it asked for, so the run is over and
  // it succeeded. Silent exit 0 is what the ignored SIGPIPE would have done.
  quit: () => {
    process.exit(0);
  },
});

process.exitCode = await run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdout: pipes.stdout,
  stderr: pipes.stderr,
  isTTY: process.stdout.isTTY === true,
});
