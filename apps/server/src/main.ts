// Process entry point: `npm run dev -w apps/server`, `npm start -w apps/server`,
// and the child process `corpus server start` spawns (CLI-002).
//
// Deliberately nothing but wiring — every decision lives in `lifecycle.ts`,
// which is exercised by unit tests with these hooks replaced.

import { runServerProcess } from "./lifecycle.js";

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
