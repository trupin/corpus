#!/usr/bin/env node
// Thin bin shim: every decision lives in src/run.ts so it stays testable.
// Excluded from coverage in the root vitest config for that reason.
import { run } from "../run.js";

process.exitCode = await run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  isTTY: process.stdout.isTTY === true,
});
