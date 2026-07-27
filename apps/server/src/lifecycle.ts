// Process lifecycle: argument parsing, boot, signal handling, graceful
// shutdown. Every interaction with the real process is injected, so `main.ts`
// stays a wiring shim with nothing to test and this module carries the
// behaviour.

import { createServer, type CorpusServer } from "./app.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { CorpusError, describeThrown } from "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import { attachProjection } from "./projection/attach.js";

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** How long a disposer may hold up shutdown before the process is forced down. */
export const SHUTDOWN_GRACE_MS = 5000;

export interface ProcessHooks {
  onSignal(signal: NodeJS.Signals, handler: () => void): void;
  onUnhandledRejection(handler: (reason: unknown) => void): void;
  exit(code: number): void;
  setTimeout(handler: () => void, ms: number): { unref(): unknown };
}

export interface ServerArgs {
  readonly workspace: string | undefined;
}

/**
 * Accepts `--workspace <path>`, `--workspace=<path>`, `-w <path>` or a bare
 * positional. The explicit form wins over `CORPUS_WORKSPACE` (SPEC.md §4's
 * resolution order is env-then-search; an operator naming a directory outranks
 * both).
 */
export function parseServerArgs(argv: readonly string[]): ServerArgs {
  let workspace: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === "--workspace" || arg === "-w") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CorpusError(`${arg} requires a workspace directory`);
      }
      workspace = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--workspace=")) {
      const value = arg.slice("--workspace=".length);
      if (value === "") throw new CorpusError("--workspace requires a workspace directory");
      workspace = value;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CorpusError(`unknown option ${arg}; usage: corpus-server [--workspace <dir>]`);
    }

    workspace = arg;
  }

  return { workspace };
}

/**
 * A `CorpusError` is a failure we anticipated and phrased for the operator —
 * its message already names the file, the field or the fix, and a stack trace
 * only buries it. Anything else is a bug and gets the full dump.
 */
function logBootFailure(logger: Logger, error: unknown, fallbackMessage: string): void {
  if (error instanceof CorpusError) {
    logger.error(error.message);
    return;
  }
  logger.error(fallbackMessage, describeThrown(error));
}

export interface RunServerOptions {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly hooks: ProcessHooks;
  readonly logger?: Logger;
  readonly createServerFn?: (config: ServerConfig) => CorpusServer;
  /**
   * Opens the SQLite projection and registers its disposer (SERVER-004).
   * Injected so a test driving the lifecycle with a stand-in server does not
   * need a real workspace on disk.
   */
  readonly attachProjectionFn?: (server: CorpusServer) => void;
  readonly gracePeriodMs?: number;
}

/**
 * Boots the server for a real process. Resolves once the server is listening and
 * the signal handlers are installed; the process then stays alive on the open
 * socket until a signal arrives.
 */
export async function runServerProcess(
  options: RunServerOptions,
): Promise<CorpusServer | undefined> {
  const { argv, env, cwd, hooks } = options;
  const gracePeriodMs = options.gracePeriodMs ?? SHUTDOWN_GRACE_MS;

  // Before the config is read the log level is unknown; boot failures are
  // errors, which are never level-gated, so `info` is a safe provisional level.
  let logger = options.logger ?? createLogger("info");

  let server: CorpusServer;
  try {
    const args = parseServerArgs(argv);
    const config = loadServerConfig({ workspace: args.workspace, env, cwd });
    logger = options.logger ?? createLogger(config.logLevel);
    for (const warning of config.warnings) {
      logger.info(`warning: ${warning}`, { configPath: config.configPath });
    }
    server = (options.createServerFn ?? createServer)(config);
    // Before the socket opens: a projection that cannot be built is a boot
    // failure, and the first request must never race the initial projection.
    (options.attachProjectionFn ?? attachProjection)(server);
  } catch (error) {
    logBootFailure(logger, error, "failed to start");
    hooks.exit(1);
    return undefined;
  }

  try {
    const address = await server.start();
    logger.info(`listening on ${address.url}`, {
      url: address.url,
      port: address.port,
      workspace: server.config.workspaceRoot,
      version: server.config.version,
    });
  } catch (error) {
    logBootFailure(logger, error, "failed to bind");
    hooks.exit(1);
    return undefined;
  }

  installShutdownHandlers({ server, hooks, logger, gracePeriodMs });
  return server;
}

interface ShutdownOptions {
  readonly server: CorpusServer;
  readonly hooks: ProcessHooks;
  readonly logger: Logger;
  readonly gracePeriodMs: number;
}

function installShutdownHandlers(options: ShutdownOptions): void {
  const { server, hooks, logger, gracePeriodMs } = options;
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    // A second SIGTERM while the first is still draining must be a no-op, not a
    // double-dispose.
    if (shuttingDown) {
      logger.info("shutdown already in progress", { signal });
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });

    // Backstop: if a disposer never settles, the process still goes away.
    hooks
      .setTimeout(() => {
        logger.error(`shutdown did not complete within ${gracePeriodMs}ms; forcing exit`, {
          signal,
        });
        hooks.exit(1);
      }, gracePeriodMs)
      .unref();

    void server
      .close()
      .then(() => {
        logger.info("shutdown complete", { signal });
        hooks.exit(0);
      })
      .catch((error: unknown) => {
        logger.error("shutdown failed", describeThrown(error));
        hooks.exit(1);
      });
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    hooks.onSignal(signal, () => {
      shutdown(signal);
    });
  }

  hooks.onUnhandledRejection((reason) => {
    // Silently ignoring these hides real bugs behind a server that looks fine.
    logger.error("unhandled promise rejection", describeThrown(reason));
    hooks.exit(1);
  });
}
