// The Hono application every other server issue plugs into.
//
// `createServer` is a pure function of the config it is handed: it reads no
// environment variable, resolves no path, and never calls `process.exit`. All
// ambient input lives in `loadServerConfig` (config.ts) and all process wiring
// in `lifecycle.ts`, which keeps this — the part with behaviour — testable
// without a process.

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { buildOpenApiDocument, contractRoutes } from "@corpus/contract";
import { isLoopbackHost, nonLoopbackBindError, type ServerConfig } from "./config.js";
import {
  CorpusError,
  badRequest,
  describeThrown,
  errorResponse,
  notFound,
  toHttpError,
  toValidationIssues,
} from "./errors.js";
import {
  createInvalidationBus,
  createSseHub,
  mountEventStream,
  type InvalidationBus,
} from "./events/index.js";
import { createLogger, type Logger } from "./logger.js";
import { createBearerAuth } from "./middleware/auth.js";
import { createRequestLogger } from "./middleware/logging.js";
import type { ProjectionDb } from "./projection/index.js";
import {
  createQueueService,
  mountQueueRoutes,
  type QueueInvalidate,
  type QueueMirror,
  type QueueService,
} from "./queue/index.js";
import { createHealthHandler } from "./routes/health.js";
import { mountStaticUi } from "./static-ui.js";
import { createSelfWriteRegistry, type SelfWriteRegistry } from "./watcher/index.js";

/**
 * Server-local introspection: the live OpenAPI document. Deliberately outside
 * the contract (Sprint-002 Adjudication 4) — there is no typed client method for
 * it — but still behind the bearer guard, because it describes a private API.
 */
export const OPENAPI_PATH = "/api/openapi.json";

export type Disposer = () => void | Promise<void>;

export interface BoundAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

export interface CorpusServer {
  readonly app: OpenAPIHono;
  readonly config: ServerConfig;
  readonly logger: Logger;
  /**
   * The file-backed event queue (SPEC.md §7). Exposed so in-process producers —
   * SERVER-006's `@agent` comments, form answers, subagent wake-backs — enqueue
   * through the same path the HTTP surface uses, waking parked long-polls.
   */
  readonly queue: QueueService;
  /**
   * The SQLite projection (SERVER-004), opened by `lifecycle.ts` *before* the
   * app is built and handed in as a dep — `createServer` receives a handle
   * rather than opening one, which is what keeps it free of filesystem access
   * (sprint-004 Adjudication 2). `undefined` in unit tests that need no rows.
   */
  readonly projection: ProjectionDb | undefined;
  /**
   * The one in-process invalidation emitter (SPEC.md §2.2 rule 3). Write paths
   * and the watcher publish here; `GET /events` is a subscriber. There is
   * deliberately no second channel.
   */
  readonly bus: InvalidationBus;
  /**
   * Lets the watcher tell the server's own writes apart from an outside
   * editor's, so a mutation is projected and announced exactly once.
   */
  readonly selfWrites: SelfWriteRegistry;
  /**
   * Registers cleanup to run at shutdown. Subsystems (the SQLite handle from
   * SERVER-004, the chokidar watcher from SERVER-007) attach here instead of
   * editing shutdown logic. Disposers run in reverse registration order, so a
   * subsystem is torn down before what it depends on.
   */
  registerDisposer(dispose: Disposer): void;
  start(): Promise<BoundAddress>;
  close(): Promise<void>;
}

export interface CreateServerDeps {
  readonly logger?: Logger;
  readonly now?: () => number;
  /**
   * The projection's `events` table (SERVER-004) and the SSE bus (SERVER-007).
   * Optional so the queue works — and is testable — before either exists; the
   * queue itself is file-backed, and the mirror is rebuilt from the directories
   * at boot whatever is passed here.
   */
  readonly queueMirror?: QueueMirror | undefined;
  /**
   * Overrides where queue transitions announce staleness. Defaults to the
   * server's own bus, which is what carries them to `GET /events`; tests inject
   * a recorder.
   */
  readonly invalidate?: QueueInvalidate | undefined;
  /** The open projection, per {@link CorpusServer.projection}. */
  readonly projection?: ProjectionDb | undefined;
  /** How often `GET /events` writes its keep-alive comment; `0` disables it. */
  readonly heartbeatMs?: number | undefined;
}

/** IPv6 literals need brackets to form a URL authority. */
export function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** Turns a listen failure into an error that says what to do about it. */
export function mapListenError(error: unknown, port: number, host: string): CorpusError {
  if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
    return new CorpusError(
      `port ${port} already in use — another corpus server may be running (corpus server status)`,
      { cause: error },
    );
  }
  if (error instanceof Error && "code" in error && error.code === "EADDRNOTAVAIL") {
    return new CorpusError(`cannot bind ${host}: address not available on this machine`, {
      cause: error,
    });
  }
  return new CorpusError(
    `failed to bind ${formatHostForUrl(host)}:${port}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

function closeIdleConnections(server: ServerType): void {
  // Only `http.Server` exposes it, and only Node ≥ 18.2. Without it a
  // keep-alive connection (every `curl` on the same host) holds `close()` open
  // until its idle timeout, turning a graceful shutdown into a hang.
  const candidate: unknown = (server as { closeIdleConnections?: unknown }).closeIdleConnections;
  if (typeof candidate === "function") {
    (candidate as () => void).call(server);
  }
}

export function createServer(config: ServerConfig, deps: CreateServerDeps = {}): CorpusServer {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return errorResponse(
          c,
          badRequest("request failed validation", toValidationIssues(result.error, result.target)),
        );
      }
      return undefined;
    },
  });

  app.use("*", createRequestLogger(logger, now));

  const headerAuth = createBearerAuth({ token: config.token });
  app.use("/api/*", headerAuth);
  app.use("/attachments/*", headerAuth);
  // `/events` is under neither guarded prefix, so it needs its own mount — and
  // it is the one path where `?token=` is accepted (SPEC.md §2.1: EventSource
  // cannot set headers).
  app.use("/events", createBearerAuth({ token: config.token, allowQueryToken: true }));

  app.openapi(
    contractRoutes.getHealth,
    createHealthHandler({
      version: config.version,
      workspaceRoot: config.workspaceRoot,
      startedAt,
      now,
    }),
  );

  const bus = createInvalidationBus({ logger });
  const hub = createSseHub({
    bus,
    logger,
    ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
  });
  mountEventStream(app, hub);

  const selfWrites = createSelfWriteRegistry();
  const queue = createQueueService({
    corpusDir: config.corpusDir,
    logger,
    mirror: deps.queueMirror,
    invalidate:
      deps.invalidate ??
      ((keys) => {
        bus.invalidate(keys);
      }),
    observeWrite: (path, content) => {
      selfWrites.record(path, content);
    },
    now,
  });
  mountQueueRoutes(app, queue);

  const openApiDocument = buildOpenApiDocument();
  app.get(OPENAPI_PATH, (c) => c.json(openApiDocument, 200));

  mountStaticUi(app, { distDir: config.uiDistDir, logger });

  app.notFound((c) => errorResponse(c, notFound(`no route matches ${c.req.method} ${c.req.path}`)));

  app.onError((error, c) => {
    const httpError = toHttpError(error);
    if (httpError.status >= 500) {
      // The client gets "internal error"; the operator gets everything.
      logger.error("unhandled error", {
        method: c.req.method,
        path: c.req.path,
        ...describeThrown(error),
      });
    }
    return errorResponse(c, httpError);
  });

  const disposers: Disposer[] = [];
  let httpServer: ServerType | undefined;
  let closePromise: Promise<void> | undefined;

  const start = (): Promise<BoundAddress> =>
    new Promise<BoundAddress>((resolvePromise, rejectPromise) => {
      // Loopback-only is enforced here, at the bind, and not in the config
      // schema (Sprint-002 Adjudication 6): the file parses — the CLI reads the
      // same one and only needs a dial target — but *this* process refuses to
      // put an unencrypted, single-token API on a routable interface.
      if (!isLoopbackHost(config.host)) {
        rejectPromise(nonLoopbackBindError(config.host, config.configPath));
        return;
      }

      let settled = false;

      const onStartupError = (error: Error): void => {
        if (settled) return;
        settled = true;
        rejectPromise(mapListenError(error, config.port, config.host));
      };

      const server = serve(
        { fetch: app.fetch, hostname: config.host, port: config.port },
        (info) => {
          if (settled) return;
          settled = true;
          server.off("error", onStartupError);
          server.on("error", (error) => {
            logger.error("http server error", describeThrown(error));
          });
          resolvePromise({
            host: config.host,
            port: info.port,
            url: `http://${formatHostForUrl(config.host)}:${info.port}`,
          });
        },
      );

      httpServer = server;
      server.on("error", onStartupError);
    });

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      // Before `server.close()`, which waits for open connections: a parked
      // long-poll and an attached SSE stream are both *active* connections and
      // would otherwise hold shutdown open — the long-poll for the rest of its
      // window, the stream forever. Releasing them lets each one hang up.
      queue.close();
      await hub.close();
      const server = httpServer;
      httpServer = undefined;
      if (server !== undefined) {
        await new Promise<void>((resolveClose) => {
          server.close(() => {
            resolveClose();
          });
          closeIdleConnections(server);
        });
      }

      for (const dispose of [...disposers].reverse()) {
        try {
          await dispose();
        } catch (error) {
          // One failing disposer must not strand the ones registered before it.
          logger.error("disposer failed", describeThrown(error));
        }
      }
      disposers.length = 0;
    })();
    return closePromise;
  };

  return {
    app,
    config,
    logger,
    queue,
    projection: deps.projection,
    bus,
    selfWrites,
    registerDisposer(dispose) {
      disposers.push(dispose);
    },
    start,
    close,
  };
}
