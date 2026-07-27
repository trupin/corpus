// The library surface of `@corpus/server`: the app factory, config loading and
// the error types. Consumed by the server's own tests and by the CLI's
// integration tests; the runnable process entry point is `main.ts`.
export const PACKAGE_NAME = "@corpus/server";

export * from "./anchors/index.js";
export * from "./core/index.js";

export * from "./app.js";
export * from "./config.js";
export * from "./errors.js";
export * from "./lifecycle.js";
export * from "./logger.js";
export * from "./middleware/auth.js";
export * from "./middleware/localhost.js";
export * from "./middleware/logging.js";
export * from "./projection/index.js";
export * from "./routes/health.js";
export * from "./static-ui.js";
