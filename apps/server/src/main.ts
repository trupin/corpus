// Process entry point: `npm run dev -w apps/server`, `npm start -w apps/server`,
// and the child process `corpus server start` spawns (CLI-002).
//
// Deliberately nothing but wiring — every decision lives in `lifecycle.ts`,
// which is exercised by unit tests with these hooks replaced.

import { isMainThread } from "node:worker_threads";
import { runServerProcess } from "./lifecycle.js";

// Only on the main thread. In an installed tool every first-party module is
// inlined into one esbuild bundle, so the URL SERVER-049's inference worker is
// spawned with — `import.meta.url` inside `semantic/engine/inference-worker.ts`
// — *is* this bundle. Loading it in a worker must start an embedding worker,
// not a second server on a socket that is already bound.
if (isMainThread) {
  await runServerProcess({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    hooks: {
      onSignal: (signal, handler) => {
        process.on(signal, handler);
      },
      onUnhandledRejection: (handler) => {
        process.on("unhandledRejection", handler);
      },
      exit: (code) => {
        process.exit(code);
      },
      setTimeout: (handler, ms) => setTimeout(handler, ms),
    },
  });
}
