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
import { buildOpenApiDocument, contractRoutes, type QueryKey } from "@corpus/contract";
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
  attachmentsRootOf,
  createRawAttachmentPathGuard,
  createUploadSizeGuard,
  mountAttachmentRoutes,
} from "./attachments/index.js";
import { mountCaptureRoutes } from "./capture/index.js";
import { mountCheckRoutes } from "./check/index.js";
import { mountSkillRoutes } from "./skills/index.js";
import { createDocumentMutex, mountDocsRoutes, type DocsWorkspace } from "./docs/index.js";
import { mountThreadRoutes, type ThreadsWorkspace } from "./threads/index.js";
import {
  createInvalidationBus,
  createSseHub,
  mountEventStream,
  type InvalidationBus,
} from "./events/index.js";
import { createAutoCommitter, createGit, type AutoCommitter } from "./git/index.js";
import { createJobService, mountJobRoutes } from "./jobs/index.js";
import {
  createLockGuard,
  createLockService,
  mountLockRoutes,
  type LockGuard,
  type LockService,
} from "./locks/index.js";
import { createLogger, type Logger } from "./logger.js";
import { mountPluginRoutes, type DiscoveredPlugin } from "./plugins/index.js";
import { createBearerAuth } from "./middleware/auth.js";
import { createRequestLogger } from "./middleware/logging.js";
import { mountDbRoutes, type ProjectionDb } from "./projection/index.js";
import { mountSearchRoutes } from "./search/index.js";
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
   * thread creation, turn append and capture, and later subagent wake-backs —
   * enqueue through the same path the HTTP surface uses, waking parked
   * long-polls. A file dropped into `pending/` would land the same bytes and
   * leave the agent asleep.
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
   * Per-document edit locks (SPEC.md §7), and the guard the document write path
   * calls before every write verb. `undefined` when the server was built without
   * a projection — a lock is per-document, and "does this document exist?" is a
   * question only the projection can answer.
   */
  readonly locks: LockService | undefined;
  readonly lockGuard: LockGuard | undefined;
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
  /**
   * The open projection (SERVER-004), handed in rather than opened here so
   * `createServer` stays a pure function of its config: read routes need the
   * handle at request time, `lifecycle.ts` owns opening and closing it, and a
   * unit test that needs no database simply omits it — the read routes are then
   * not mounted, which is an honest 404 rather than a half-wired server.
   */
  readonly projection?: ProjectionDb | undefined;
  /** How often `GET /events` writes its keep-alive comment; `0` disables it. */
  readonly heartbeatMs?: number | undefined;
  /**
   * Plugins discovered by `lifecycle.ts` (PLUGINS-001). Pre-resolved and
   * handed in — dynamic `import()` is async and `createServer` stays a pure,
   * synchronous function of its inputs, exactly the projection's pattern.
   * Mounted after every core route (a plugin can never shadow `/api/docs`)
   * and only when a projection exists: plugin routes write through the core
   * write path, which does not exist without one.
   */
  readonly plugins?: readonly DiscoveredPlugin[] | undefined;
  /**
   * The server's one git writer (SPEC.md §4). Constructed here from
   * `config.workspaceRoot` by default — it is a command builder, not an open
   * handle, so building it breaks none of `createServer`'s purity (sprint-005
   * Open Conflict 12) — and injected by tests that assert what would have been
   * committed without needing a repository.
   *
   * Exactly one per server: the document write path and the lock service's
   * force-break audit entry share this instance, which is what serializes every
   * commit the server makes on a single `.git/index` lock.
   */
  readonly git?: AutoCommitter | undefined;
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
  // Both forms: `/attachments` alone is answered by the attachment route's own
  // uniform 404 rather than the app's generic one, and a 404 that arrives
  // *before* the token is checked would be a free existence probe.
  app.use("/attachments", headerAuth);
  app.use("/attachments/*", headerAuth);

  // Ahead of every route, and therefore ahead of the body validators: an upload
  // whose declared size is already over the cap is refused from its headers,
  // without buffering it.
  app.use(
    "/api/*",
    createUploadSizeGuard(() => config.attachments),
  );

  // Global, and after the auth mounts so a token is still demanded where one is
  // demanded: a dot-segment traversal under `/attachments` is resolved by the
  // URL parser before routing, so by here it no longer matches the attachment
  // path — the guard reads the target the client actually sent.
  app.use("*", createRawAttachmentPathGuard());
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

  const invalidate = (keys: readonly QueryKey[]): void => {
    bus.invalidate(keys);
  };

  let locks: LockService | undefined;
  let lockGuard: LockGuard | undefined;
  if (deps.projection !== undefined) {
    // Everything the write path needs is already reachable here (sprint-005
    // Open Conflict 12: "no new deps"): the workspace root is on the config, the
    // bus and the self-write registry were just created, the projection is the
    // dep `lifecycle.ts` opened, and the git module is a pure function of the
    // root — constructing a command builder opens no handle and touches no
    // filesystem, so it does not compromise `createServer`'s purity.
    // The command builder is kept beside the committer, not swallowed by it: the
    // skill rollback needs the same repository for *reads* (`rev-parse`, `log`,
    // `show`) that the committer owns for writes, and `AutoCommitter` exposes
    // only its lock. A test that injects `deps.git` replaces the writer; the
    // reader still addresses the workspace the config names.
    const gitCommands = createGit(config.workspaceRoot);
    const git = deps.git ?? createAutoCommitter({ git: gitCommands, logger, now });

    // Locks are built *before* the document routes, because the write pipeline
    // takes the guard as a constructor argument: `assertWritable` is the seam
    // SERVER-005 left in `DocsWorkspace`, and mounting it here is what turns a
    // held lease into the contract's 423 on every write verb at once, rather
    // than one route at a time.
    const lockService = createLockService({
      corpusDir: config.corpusDir,
      projection: deps.projection,
      queue,
      git,
      invalidate: deps.invalidate ?? invalidate,
      observeWrite: (path, content) => {
        selfWrites.record(path, content);
      },
      logger,
      now,
    });
    const guard = createLockGuard(lockService);
    locks = lockService;
    lockGuard = guard;
    mountLockRoutes(app, lockService);

    const docsWorkspace: DocsWorkspace = {
      workspaceRoot: config.workspaceRoot,
      projection: deps.projection,
      git,
      selfWrites,
      bus,
      logger,
      now,
      assertWritable: (docId, actor) => guard.assertWritable(docId, actor),
      attachmentsRoot: attachmentsRootOf(config.corpusDir),
    };
    // One mutex across both surfaces. Anchored thread creation and the deletion
    // cascade rewrite a *document's* frontmatter, so they contend with
    // `PUT /api/docs/{id}` for the same file and must queue in the same lane;
    // two mutexes would serialize each surface against itself and neither
    // against the other (SERVER-006).
    const mutex = createDocumentMutex();
    mountDocsRoutes(app, deps.projection, { now, mutex, workspace: docsWorkspace });

    // Ranked retrieval (SPEC.md §7, §9.2). A pure projection read like the
    // collection query it filters identically to, so it mounts here rather than
    // with the file-backed surface — and inside this block, because a server
    // built without a database has no index to rank.
    mountSearchRoutes(app, deps.projection, { now });

    const threadsWorkspace: ThreadsWorkspace = {
      ...docsWorkspace,
      corpusDir: config.corpusDir,
      // The one enqueue path: `QueueService.enqueue` writes the pending file,
      // mirrors it, invalidates and — the part a file drop cannot do — wakes
      // every parked `queue idle` (SPEC.md §7).
      enqueue: (input) => queue.enqueue(input),
      attachmentLimits: config.attachments,
    };
    mountThreadRoutes(app, threadsWorkspace, mutex);
    mountCaptureRoutes(app, threadsWorkspace, mutex);

    mountJobRoutes(
      app,
      createJobService({
        corpusDir: config.corpusDir,
        projection: deps.projection,
        queue,
        logger,
        now,
      }),
    );

    // Mounted here, with the rest of the projection-backed surface: `doctor`
    // reads the database and `rebuild` replaces it, so neither means anything on
    // a server that was built without one.
    mountDbRoutes(app, {
      config,
      projection: deps.projection,
      queue,
      logger,
      invalidate: deps.invalidate ?? invalidate,
    });

    // §14's validator over HTTP, and §7's skill rollback. Both need the
    // projection — the check resolves ids and answers "does this `[[ref]]`
    // target exist", the rollback resolves a skill's path to its document id —
    // so both live in this block, and both are mounted before the plugin
    // routers like every other core route.
    mountCheckRoutes(app, {
      workspaceRoot: config.workspaceRoot,
      projection: deps.projection,
    });
    mountSkillRoutes(app, { ...docsWorkspace, gitCommands }, mutex);

    // Plugin routers, last of the API surface (SPEC.md §10): every core mount
    // above wins any path dispute by construction, the `/api/*` bearer guard
    // already covers `/api/x/*`, and a failing plugin is skipped inside —
    // never a boot failure.
    mountPluginRoutes(app, deps.plugins ?? [], {
      workspace: docsWorkspace,
      mutex,
      logger,
      now,
    });
  }

  // Outside the projection block on purpose: serving bytes reads the filesystem
  // and nothing else — no rows, no locks, no git — so a server built without a
  // database still hands out attachments rather than 404ing them.
  mountAttachmentRoutes(app, { attachmentsRoot: attachmentsRootOf(config.corpusDir) });

  const openApiDocument = buildOpenApiDocument();
  app.get(OPENAPI_PATH, (c) => c.json(openApiDocument, 200));

  // The token goes with it: the shell this mount serves is the one channel an
  // installed build has for learning its credential (SERVER-024 —
  // `ui-runtime-config.ts` carries the mechanism and its security rationale).
  mountStaticUi(app, { distDir: config.uiDistDir, logger, token: config.token });

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
    locks,
    lockGuard,
    registerDisposer(dispose) {
      disposers.push(dispose);
    },
    start,
    close,
  };
}
