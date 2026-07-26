#!/usr/bin/env node
// Thin bin shim: all behaviour lives in src/index.ts so it stays testable.
// Excluded from coverage in the root vitest config for that reason.
import { runCli } from "../index.js";

process.stdout.write(`${runCli()}\n`);
