// Process lifecycle: argument parsing, boot, signal handling, graceful
// shutdown. Every interaction with the real process is injected, so `main.ts`
// stays a wiring shim with nothing to test and this module carries the
// behaviour.

import { createServer, type CorpusServer, type CreateServerDeps } from "./app.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { CorpusError, describeThrown } from "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import { discoverPlugins, resolvePluginsRoot, type DiscoveredPlugin } from "./plugins/index.js";
import {
  attachProjection,
  openWorkspaceProjection,
  type ProjectionDb,
} from "./projection/index.js";
import {
  attachEmbedWorker,
  attachEmbeddedEngine,
  attachSemanticIndex,
  type AttachEmbedWorkerDeps,
  type AttachSemanticIndexDeps,
  type CorpusEmbeddedEngine,
} from "./semantic/index.js";
import { attachWatcher } from "./watcher/index.js";

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

/** The production discovery: resolve the bundled `plugins/` root, scan it. */
function defaultDiscoverPlugins(
  logger: Logger,
  env: NodeJS.ProcessEnv,
): Promise<readonly DiscoveredPlugin[]> {
  return discoverPlugins({ pluginsRoot: resolvePluginsRoot(env), env, logger });
}

export interface RunServerOptions {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly hooks: ProcessHooks;
  readonly logger?: Logger;
  readonly createServerFn?: (config: ServerConfig, deps: CreateServerDeps) => CorpusServer;
  /**
   * Opens the SQLite projection (SERVER-004). Runs *before* `createServer`, whose
   * `projection` dep it becomes. Injected so a test driving the lifecycle with a
   * stand-in server does not need a real workspace on disk.
   */
  readonly openProjectionFn?: (config: ServerConfig, logger: Logger) => ProjectionDb | undefined;
  /**
   * Discovers `plugins/*` (PLUGINS-001). Runs before `createServer` — dynamic
   * `import()` is async and route mounting is not — and never throws: a broken
   * plugin is a logged skip, not a boot failure. Injected so lifecycle tests
   * need no plugins on disk.
   */
  readonly discoverPluginsFn?: (
    logger: Logger,
    env: NodeJS.ProcessEnv,
  ) => Promise<readonly DiscoveredPlugin[]>;
  /** Registers the projection's disposer and binds the queue's `events` mirror. */
  readonly attachProjectionFn?: (server: CorpusServer) => void;
  /** Starts the chokidar watcher and registers its disposer (SERVER-007). */
  readonly attachWatcherFn?: (server: CorpusServer) => void;
  /**
   * Resolves the embedding provider and checks the index's recorded identity
   * (SERVER-043). Injected so a test — and the seam's own E2E — can register an
   * embedded engine, which is otherwise absent until SERVER-048.
   */
  readonly attachSemanticFn?: (server: CorpusServer, deps: AttachSemanticIndexDeps) => void;
  /**
   * Builds the in-process embedding engine and registers its disposer
   * (SERVER-048). Injected so a test can boot without one; the default is
   * inert until something asks it to embed.
   */
  readonly attachEmbeddedEngineFn?: (
    server: CorpusServer,
    env: Readonly<Record<string, string | undefined>>,
  ) => CorpusEmbeddedEngine | undefined;
  /**
   * Starts the background embed worker and registers its disposer (SERVER-044).
   * Registered **last**, so its disposer runs first — it writes to the
   * projection and drives the engine's model session, and both must outlive it.
   */
  readonly attachEmbedWorkerFn?: (server: CorpusServer, deps: AttachEmbedWorkerDeps) => void;
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
  let projection: ProjectionDb | undefined;
  try {
    const args = parseServerArgs(argv);
    const config = loadServerConfig({ workspace: args.workspace, env, cwd });
    logger = options.logger ?? createLogger(config.logLevel);
    for (const warning of config.warnings) {
      logger.info(`warning: ${warning}`, { configPath: config.configPath });
    }
    // Before the socket opens, and before the app is built: a projection that
    // cannot be built is a boot failure, the first request must never race the
    // initial projection, and `createServer` takes the open handle as a dep
    // rather than opening one itself.
    projection = (options.openProjectionFn ?? openWorkspaceProjection)(config, logger);
    // Plugins resolve against the tool's install directory, never the
    // workspace (SPEC.md §10, sprint-012 Adjudication 12); routes must be
    // mounted before the socket opens, so discovery happens here.
    const plugins = await (options.discoverPluginsFn ?? defaultDiscoverPlugins)(logger, env);
    server = (options.createServerFn ?? createServer)(config, { projection, plugins });
    (options.attachProjectionFn ?? attachProjection)(server);
    // The watcher is filesystem-bound and lifecycle-scoped, so it attaches here
    // alongside the projection; its disposer runs before the database closes.
    (options.attachWatcherFn ?? attachWatcher)(server);
    // The engine registers its disposer before the seam registers its own, so
    // shutdown aborts the resolution first and only then releases the model.
    // Building one touches nothing: it downloads on demand and loads on `open`.
    const embeddedEngine = (options.attachEmbeddedEngineFn ?? attachEmbeddedEngine)(server, env);
    // Last, so its disposer runs first: it reads the projection, and a resolution
    // still in flight must be aborted and awaited before the database closes. It
    // resolves in the background — a configured endpoint that never answers must
    // not hold the socket shut on a server whose documents are all readable.
    (options.attachSemanticFn ?? attachSemanticIndex)(
      server,
      embeddedEngine === undefined ? {} : { embeddedEngine },
    );
    // Last of all, so its disposer runs before every one of theirs: it writes to
    // the projection, reads the config's embedding block through the seam, and
    // drives the engine's model session. Starting it costs one query — it
    // resolves a provider only once there is something to index.
    (options.attachEmbedWorkerFn ?? attachEmbedWorker)(
      server,
      embeddedEngine === undefined ? {} : { engine: embeddedEngine },
    );
  } catch (error) {
    // A handle opened before the failure would otherwise outlive the process's
    // attempt to start.
    projection?.close();
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
