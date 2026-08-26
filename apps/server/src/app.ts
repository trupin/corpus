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
import {
  DEFAULT_REFLECT_QUIET_MINUTES,
  buildOpenApiDocument,
  contractRoutes,
  type QueryKey,
} from "@corpus/contract";
import {
  isLoopbackHost,
  nonLoopbackBindError,
  readQuietMinutes,
  writeQuietMinutes,
  type ServerConfig,
} from "./config.js";
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
import { mountAgentRoutes } from "./agents/index.js";
import { mountCaptureRoutes } from "./capture/index.js";
import { mountCheckRoutes } from "./check/index.js";
import { mountSkillRoutes } from "./skills/index.js";
import {
  createDocumentMutex,
  mountDocsRoutes,
  type DocsWorkspace,
  type DocumentMutex,
} from "./docs/index.js";
import { mountFolderRoutes } from "./folders/index.js";
import {
  mountThreadRoutes,
  mountThreadScopeRoutes,
  type ThreadsWorkspace,
} from "./threads/index.js";
import {
  EDIT_ACK_IDLE_MS,
  createEditSessionTracker,
  mountDocDiffRoutes,
  mountEditSessionRoutes,
  type EditSessionTracker,
} from "./edit/index.js";
import {
  createInvalidationBus,
  createSseHub,
  mountEventStream,
  type InvalidationBus,
} from "./events/index.js";
import {
  createAutoCommitter,
  createGit,
  recoverUncommittedChanges,
  type AutoCommitter,
} from "./git/index.js";
import {
  createJobService,
  createStatedWeightRecorder,
  mountJobRoutes,
  type JobService,
} from "./jobs/index.js";
import { createLogger, type Logger } from "./logger.js";
import { createBearerAuth } from "./middleware/auth.js";
import { createRequestLogger } from "./middleware/logging.js";
import { mountDbRoutes, type ProjectionDb } from "./projection/index.js";
import { createReflectService, mountReflectRoutes, type ReflectService } from "./reflect/index.js";
import { mountSearchRoutes } from "./search/index.js";
import {
  createIndexAnnouncer,
  createIndexMaintenance,
  createSemanticRetrieval,
  type IndexAnnouncer,
  mountIndexRoutes,
  type IndexMaintenance,
  type SemanticRetrieval,
} from "./semantic/index.js";
import {
  createLaneTracker,
  createQueueService,
  mountQueueRoutes,
  PRESENCE_QUERY_KEYS,
  type QueueInvalidate,
  type QueueMirror,
  type QueueService,
} from "./queue/index.js";
import { createJobLookup } from "./queue/job-lookup.js";
import { createLaneScopeLookup, createReleasedLaneLookup } from "./queue/scope.js";
import { createHealthHandler } from "./routes/health.js";
import { mountStaticUi } from "./static-ui.js";
import {
  createOutOfBandCommitter,
  createSelfWriteRegistry,
  type CommitOutOfBandChanges,
  type SelfWriteRegistry,
} from "./watcher/index.js";

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
   * The one per-document write lane every mutation queues in (SERVER-006), and
   * the only handle a test has on it: holding a lane is how an interleaving is
   * *decided* rather than timed, which is the difference between a lost-update
   * regression test that proves something and one that passes on a fast laptop.
   * `undefined` alongside {@link projection} — a server with no rows mounts no
   * write path to serialize.
   */
  readonly mutex: DocumentMutex | undefined;
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
   * Retrieval's semantic half (SERVER-045): hybrid ranking for `/api/search`,
   * `similar` neighbours for `/api/docs/{id}/related`, and the one
   * `semanticIndex` word both envelopes carry. `undefined` when the server was
   * built without a projection — there are no chunk vectors to rank against.
   *
   * Exposed because two things bind to it *after* the routes are mounted:
   * `lifecycle.ts` hands it the embedded engine once it exists (a search is the
   * first thing that may need a model loaded), and SERVER-046's
   * `POST /api/index/rebuild` raises its rebuild flag, which is what makes
   * `indexing` outrank `stale` on all three surfaces at once.
   */
  readonly semantic: SemanticRetrieval | undefined;
  /**
   * The semantic index's operational surface (SERVER-046): `GET /api/index/status`,
   * `POST /api/index/rebuild`, and the effective-model question `db doctor`
   * asks. `undefined` alongside {@link semantic}, for the same reason.
   *
   * Exposed for the same late binding {@link semantic} is: the embed worker is
   * started by `lifecycle.ts` after the routes are mounted, and `useWorker` is
   * how a rebuild reaches it — without one, a rebuild still discards and
   * re-queues, there is simply nothing to drain it.
   */
  readonly indexMaintenance: IndexMaintenance | undefined;
  /**
   * Where every `["index"]` frame goes (SERVER-116). Exposed because the embed
   * worker is attached after this function returns (`worker-attach.ts`) and has
   * to publish through the **same** announcer `indexMaintenance` does: the memo
   * of "what state word did we last announce" belongs to the server, not to
   * either emitter. `undefined` alongside {@link semantic}.
   */
  readonly indexAnnouncer: IndexAnnouncer | undefined;
  /**
   * SPEC.md §4's edit acknowledgment (SERVER-052): what decides a *user* edit
   * session has ended and enqueues the one `doc.edited` for it. `undefined`
   * alongside {@link semantic} — without a projection there is no write pipeline
   * to observe and no git writer to name a range from.
   *
   * It is also §7's "someone is editing this" signal (`isOpen`) and, since
   * SERVER-099, what returns a deferred queue event to `pending`: a session
   * ending is the trigger the lock's release used to be.
   */
  readonly editSessions: EditSessionTracker | undefined;
  /**
   * SPEC.md §4's out-of-band half (SERVER-090): commits what an outside editor
   * changed, authored `user`. `undefined` alongside the rest of the
   * projection-backed subsystems — without a projection there is no watcher to
   * call it and no git writer behind it.
   *
   * Exposed for the same reason {@link semantic} is: the watcher is attached by
   * `lifecycle.ts` after `createServer` returns, and this is how it reaches the
   * server's one git writer without being handed the writer itself. The writer
   * is deliberately *not* on this surface — every other subsystem reaches git
   * through the write pipeline, and a second door onto `AutoCommitter.commit`
   * would be an invitation to open a third.
   */
  readonly commitOutOfBand: CommitOutOfBandChanges | undefined;
  /**
   * SPEC.md §7's reflection (SERVER-137): the clock, the ask and the quiet
   * window. `undefined` on a server built without a projection — `changed` is a
   * projection count and a pending reflection is a projection query, so there is
   * nothing for the Reflect control to read.
   *
   * Exposed for {@link commitOutOfBand}'s reason: the watcher is attached by
   * `lifecycle.ts` after this function returns, and an out-of-band edit restarts
   * the quiet window like any other write by a person.
   */
  readonly reflect: ReflectService | undefined;
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
   * The server's one git writer (SPEC.md §4). Constructed here from
   * `config.workspaceRoot` by default — it is a command builder, not an open
   * handle, so building it breaks none of `createServer`'s purity (sprint-005
   * Open Conflict 12) — and injected by tests that assert what would have been
   * committed without needing a repository.
   *
   * Exactly one per server: every write path shares this instance, which is what
   * serializes every commit the server makes on a single `.git/index` lock.
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
  // The projection is what resolves a held event's origin document; a server
  // built without one still reports the set, with null origins (SERVER-061).
  mountQueueRoutes(app, queue, deps.projection);

  const invalidate = (keys: readonly QueryKey[]): void => {
    bus.invalidate(keys);
  };

  // Declared here rather than below the routes because the git writer built
  // inside the block that follows registers §4's shutdown close on it.
  const disposers: Disposer[] = [];
  const registerDisposer = (dispose: Disposer): void => {
    disposers.push(dispose);
  };

  // SPEC.md §7's presence (SERVER-112): a resident is live exactly while it
  // holds a parked scoped `idle`, so this counts the `idle` requests the queue
  // is holding and nothing else — no heartbeat, no registration, nothing to
  // reap. Bound **unconditionally**, outside the projection block: presence is
  // in-memory and needs no database, and a server whose lanes read lapsed while
  // residents are parked would hand their work to the orchestrator.
  const laneTracker = createLaneTracker({
    now,
    // §7: "who is running is a read, never a push". The frame carries the keys
    // and the routes are refetched over HTTP; no presence data goes over SSE.
    //
    // **Both** keys, because presence is carried by two routes: the roster
    // (`["agents"]`) and `QueueStatus.agent` (`["queue"]`, CONTRACT-045), which
    // is the one the console's pill actually reads. See PRESENCE_QUERY_KEYS.
    onPresenceChanged: () => {
      (deps.invalidate ?? invalidate)(PRESENCE_QUERY_KEYS);
    },
  });
  queue.attachLaneTracker(laneTracker);
  registerDisposer(() => {
    laneTracker.close();
  });

  let editSessions: EditSessionTracker | undefined;
  /** SPEC.md §4's out-of-band commit (SERVER-090); bound with the git writer below. */
  let commitOutOfBand: CommitOutOfBandChanges | undefined;
  let semantic: SemanticRetrieval | undefined;
  let indexMaintenance: IndexMaintenance | undefined;
  let indexAnnouncer: IndexAnnouncer | undefined;
  /** SPEC.md §7's reflection (SERVER-137); built with the projection below. */
  let reflect: ReflectService | undefined;
  /**
   * The console's job store, declared here rather than at its construction
   * because the reflection service records who asked on the new job's log and
   * is built before it (the service reads the queue; reflection reads the
   * projection, which is open first).
   */
  let jobs: JobService | undefined;
  /** The write lanes, published on the server so a test can hold one. */
  let documentMutex: DocumentMutex | undefined;
  /**
   * SPEC.md §4's boot half (SERVER-094), bound only when the server has a
   * workspace to recover — i.e. when it has a projection, which is the same
   * condition every other filesystem-backed subsystem is built under.
   */
  let recoverAtBoot: (() => Promise<void>) | undefined;
  /** §4's clean-stop half — the same close, reached from the two points below. */
  let closeCommitWindow: (() => Promise<void>) | undefined;
  if (deps.projection !== undefined) {
    // SPEC.md §7's lanes (SERVER-111): the walk from an event to the designated
    // root thread whose scope it falls in. Bound here, and not passed to
    // `createQueueService`, for the reason the mirror is bound rather than
    // passed — the queue is built above, before this block knows there is a
    // database. Until it is bound every event routes to the orchestrator, which
    // is what a server with no projection can honestly say.
    //
    // Its sibling seam, `attachLaneTracker`, is bound above and not here: a
    // walk needs the database, liveness does not, and SERVER-112 is what makes
    // the partition mean anything — with nothing live, every thread lane reads
    // as lapsed and the orchestrator's unscoped claim sees the whole queue.
    queue.attachScopeLookup(createLaneScopeLookup(deps.projection));
    // SPEC.md §7's one deliberate widening (SERVER-153): a conversation whose
    // resident a person released hands its pending work to the orchestrator.
    // Read at claim time, never written into an event.
    queue.attachReleasedLookup(createReleasedLaneLookup(deps.projection));

    // SPEC.md §7's reflection (rider 9, SERVER-137). Built early in this block
    // because everything after it wants to tell it something: the write
    // pipeline restarts its quiet window, the thread surface reports the digest,
    // and the queue moves its clock.
    const reflectService = createReflectService({
      corpusDir: config.corpusDir,
      projection: deps.projection,
      // The one enqueue path, for `comment.created`'s reason: it is the only
      // one that also wakes a parked `corpus queue idle` (SPEC.md §7).
      enqueue: (input) => queue.enqueue(input),
      // Re-read per use rather than captured, so an edit to `reflect.quiet`
      // takes effect without a restart. See `readQuietMinutes`.
      quietMinutes: () =>
        readQuietMinutes(config.configPath, config.reflect?.quiet ?? DEFAULT_REFLECT_QUIET_MINUTES),
      // The one place the server writes `.corpus/config.json` (SERVER-151).
      setQuietMinutes: (quiet) => writeQuietMinutes(config.configPath, quiet),
      // Where "who asked" and "no digest landed" are recorded: the payload is
      // `{ since }` and a stored event has no actor field, so the job log is the
      // honest home for both.
      recordJobLine: async (eventId, line) => {
        await jobs?.appendLine(eventId, line, "server");
      },
      logger,
    });
    reflect = reflectService;
    // Before the transition is announced, which is the whole point of the seam.
    queue.observeSettled((event) => {
      reflectService.observeSettled(event);
    });
    mountReflectRoutes(app, reflectService);
    registerDisposer(() => {
      reflectService.stop();
    });

    // Everything the write path needs is already reachable here (sprint-005
    // Open Conflict 12: "no new deps"): the workspace root is on the config, the
    // bus and the self-write registry were just created, the projection is the
    // dep `lifecycle.ts` opened, and the git module is a pure function of the
    // root — constructing a command builder opens no handle and touches no
    // filesystem, so it does not compromise `createServer`'s purity.
    // The command builder is kept beside the committer, not swallowed by it:
    // `GET /api/docs/{id}/diff` and the edit acknowledgment need the same
    // repository for *reads* (`rev-parse`, `log`, `show`) that the committer
    // owns for writes, and `AutoCommitter` exposes only its lock. A test that
    // injects `deps.git` replaces the writer; the reader still addresses the
    // workspace the config names.
    const gitCommands = createGit(config.workspaceRoot);
    const git =
      deps.git ??
      createAutoCommitter({
        git: gitCommands,
        logger,
        now,
        // Every amend of the open window's commit moves its sha — the relabel a
        // close performs, and each later save folding in. The edit
        // acknowledgment is the one thing that writes a sha down and publishes
        // it outside the repository, so it is the one thing that has to follow
        // the rewrite (SERVER-093; PR #42's review for the fold half, which
        // reaches a *neighbour* document's session under §4's party-scoped
        // window). Read through the `let` above rather than captured: the
        // tracker is built below, because it needs this committer.
        onWindowRewritten: (from, to) => {
          editSessions?.observeRewrite(from, to);
        },
      });

    // SPEC.md §4's out-of-band half (SERVER-090). Built here rather than inside
    // `attachWatcher` for the reason everything else in this block is: `git` is
    // the server's one writer and it does not leave this scope.
    commitOutOfBand = createOutOfBandCommitter({ git, logger });

    // SPEC.md §4: "a queue event finished, however it finished" closes the open
    // commit window (SERVER-092). Late-bound because the queue is built above,
    // before the git writer exists — and the closer is the whole of what the
    // queue needs from git, so binding it here keeps the queue ignorant of the
    // committer rather than handing it one.
    queue.attachWindowCloser(() => git.closeWindow("act"));

    // SPEC.md §4: "A clean stop commits the open window."
    closeCommitWindow = async () => {
      await git.closeWindow("shutdown");
    };
    // Registered first, so — disposers run in reverse — this is the *last* thing
    // a shutdown does. `close()` calls the same close once at its top as well,
    // and the two are not redundant: the early one runs while the edit-session
    // tracker can still follow the rewrite (see `close()`), and this one runs
    // after the socket is shut, catching a window opened by a request that was
    // still in flight when the early close went through. A close that finds no
    // window open is a no-op, so the ordinary shutdown pays nothing for it.
    // `close()` awaits each disposer, which is the whole point: one that fired
    // and returned before git finished would be the same as not having one.
    registerDisposer(async () => {
      await git.closeWindow("shutdown");
    });

    // §4's other end. Bound rather than run here — `createServer` is a pure,
    // synchronous function of its config — and called from `start()`, before the
    // socket exists, so no request can add to what is being recovered.
    recoverAtBoot = async () => {
      await recoverUncommittedChanges({
        // The command builder, not the committer: a recovery claims no acting
        // party and so cannot go through `AutoCommitter.commit`, whose request
        // requires one. It takes the committer's lock all the same, which is
        // what keeps it from interleaving with a mutation.
        git: gitCommands,
        withGitLock: (run) => git.withGitLock(run),
        logger,
      });
    };

    // §4's edit acknowledgment (SERVER-052). Built before the write pipeline
    // because the pipeline takes it as a constructor argument: every mutation
    // has to reach it, and threading it through one workspace object is what
    // makes that true of verbs written later.
    // It enqueues through `queue.enqueue` and not a file drop, because that is
    // the only path that also wakes a parked `corpus queue idle` (SPEC.md §7).
    editSessions = createEditSessionTracker({
      git: gitCommands,
      enqueue: (input) => queue.enqueue(input),
      // The one thing the acknowledgment says back to the write path: a commit
      // its event has named must not be amended afterwards, or the published
      // range dangles and the next session re-announces the same change.
      endSquashSession: (sha) => {
        git.endSquashSession(sha);
      },
      // SPEC.md §7, SHARED-041: an agent that found a person editing may defer
      // its claimed event, and the deferral "re-enters the queue on its own once
      // the session ends". This is that trigger — the whole of what replaced the
      // lock's release/break/reap, and the only reason the queue's `deferred`
      // state still has an automatic way out. It fires whichever way a session
      // ended (the reader closed, or it went idle), because the person having
      // put the document down is the fact the agent was waiting on, not the
      // acknowledgment that may or may not follow.
      onSessionEnded: (docId) => {
        void queue.requeueDeferredFor(docId).catch((error: unknown) => {
          // Never fatal to a session ending: the deferral simply stays visible
          // in the console, where §7's `corpus job retry` is the manual override.
          logger.error("could not re-enter deferred events for an ended edit session", {
            docId,
            ...describeThrown(error),
          });
        });
      },
      logger,
      now,
      idleMs: config.editAcknowledgment?.idleMs ?? EDIT_ACK_IDLE_MS,
    });

    // §4's `close` path, which the reader calls when it puts a document down
    // (CONTRACT-031, SERVER-057). Mounted here rather than with the docs routes
    // for the same reason the diff read is: it is one half of the acknowledgment
    // feature, and the tracker it opens onto has just been built above.
    mountEditSessionRoutes(app, { projection: deps.projection, editSessions });

    // The other half of the same feature: the bounded diff an agent fetches once
    // a `doc.edited` has convinced it the change is worth reading (CLI-026).
    // The committer travels with it for one reason only: §4's read-back rule
    // makes closing the open commit window part of answering the read
    // (SERVER-093). The route still writes nothing.
    mountDocDiffRoutes(app, { projection: deps.projection, git: gitCommands, committer: git });

    const docsWorkspace: DocsWorkspace = {
      workspaceRoot: config.workspaceRoot,
      projection: deps.projection,
      git,
      selfWrites,
      bus,
      logger,
      now,
      attachmentsRoot: attachmentsRootOf(config.corpusDir),
      editSessions,
      // §9.2's provenance (SERVER-110). Reads the queue's own event files, so a
      // write naming a `job` can be stamped with the conversation that work
      // came from without the write path knowing anything about the queue.
      jobs: createJobLookup(queue.store, deps.projection),
      // SPEC.md §7's quiet window: every mutation reports itself and its acting
      // party, and the service decides what that means.
      reflect: reflectService,
      // SPEC.md §5's ramp, as this workspace configured it (SERVER-133). The
      // write path reads it only through the saved queries two of its verbs run.
      staleness: config.staleness,
    };
    // One mutex across both surfaces. Anchored thread creation and the deletion
    // cascade rewrite a *document's* frontmatter, so they contend with
    // `PUT /api/docs/{id}` for the same file and must queue in the same lane;
    // two mutexes would serialize each surface against itself and neither
    // against the other (SERVER-006).
    const mutex = createDocumentMutex();
    documentMutex = mutex;

    // Retrieval's semantic half, built before the two endpoints that read it.
    // Constructing it costs nothing — no query, no resolution, no model — and it
    // is deliberately *not* handed the embedded engine here: the engine is built
    // by `lifecycle.ts` after this function returns, and `useEngine` is how it
    // arrives. A server that never gets one resolves `engine-not-installed` and
    // answers `disabled`, which is the complete, honest lexical-only product.
    const retrieval = createSemanticRetrieval({
      db: deps.projection,
      settings: config.embedding,
      logger,
      now,
    });
    semantic = retrieval;

    // The index's maintenance verbs share the retrieval half's rebuild flag and
    // its provider resolution — one bit and one cached answer, so `indexing`
    // cannot outrank `stale` on one endpoint and not on another.
    // SERVER-116. One announcer, shared by the two emitters, so a single memo
    // decides whether the state word moved — two would each announce the same
    // transition. `readState` is the retrieval half's own `state()`, which is
    // the word `/api/search` and `/api/docs/{id}/related` publish: the fact is
    // read, never re-derived.
    const announcer = createIndexAnnouncer({
      bus,
      logger,
      readState: () => retrieval.state(),
    });
    indexAnnouncer = announcer;
    indexMaintenance = createIndexMaintenance({
      db: deps.projection,
      semantic: retrieval,
      logger,
      announcer,
    });
    mountIndexRoutes(app, indexMaintenance);

    mountDocsRoutes(app, deps.projection, {
      now,
      mutex,
      workspace: docsWorkspace,
      semantic,
      staleness: config.staleness,
    });

    // SPEC.md §9.2's folder acts (SERVER-136). Mounted beside the document
    // surface and sharing its lanes: a folder act writes the same files
    // `PUT /api/docs/{id}` writes, so the two queue rather than race. Inside
    // this block because a folder's membership is a projection read.
    mountFolderRoutes(app, docsWorkspace, mutex);

    // Ranked retrieval (SPEC.md §7, §9.2). A pure projection read like the
    // collection query it filters identically to, so it mounts here rather than
    // with the file-backed surface — and inside this block, because a server
    // built without a database has no index to rank.
    mountSearchRoutes(app, deps.projection, { now, semantic, staleness: config.staleness });

    const threadsWorkspace: ThreadsWorkspace = {
      ...docsWorkspace,
      corpusDir: config.corpusDir,
      // Re-stated at the wider type: only this surface can report §7's digest,
      // and the spread above carries the document half of the observer.
      reflect: reflectService,
      // The one enqueue path: `QueueService.enqueue` writes the pending file,
      // mirrors it, invalidates and — the part a file drop cannot do — wakes
      // every parked `queue idle` (SPEC.md §7).
      enqueue: (input) => queue.enqueue(input),
      attachmentLimits: config.attachments,
    };
    // `semantic` reaches the thread surface for one route — the context pack's
    // related half (SERVER-047) — and is read per request for the same reason
    // `mountSearchRoutes` reads it per request.
    mountThreadRoutes(app, threadsWorkspace, mutex, { semantic });
    mountCaptureRoutes(app, threadsWorkspace, mutex);

    // §7's scope listing (SERVER-130): the inverse of the lane walk bound above,
    // and a pure projection read — every column it reports is projected, so it
    // needs neither the workspace nor the mutex the thread surface takes. Mounted
    // beside that surface because the path is one segment under it, and inside
    // this block for the roster's reason: without a database there are no lanes
    // to have a scope.
    mountThreadScopeRoutes(app, { projection: deps.projection });

    // §7's roster (SERVER-112). Mounted after the thread surface because that is
    // where a lane comes from — a designation is thread state — and inside this
    // block because the lanes are a projection read; the liveness half needs no
    // database and is bound above.
    mountAgentRoutes(app, { projection: deps.projection, tracker: laneTracker, now });

    const jobService = createJobService({
      corpusDir: config.corpusDir,
      projection: deps.projection,
      queue,
      logger,
      now,
    });
    jobs = jobService;
    mountJobRoutes(app, jobService);
    // §7's console bullet, the server's half (SERVER-069): every event a request
    // stated a weight on gets that weight written onto its job log, verbatim and
    // before any dispatch line exists, so "honoured, not weighed again" is
    // checkable against something the orchestrator did not write. Bound here
    // rather than passed to `createQueueService` because the job service reads
    // the queue and so cannot exist before it.
    queue.observeEnqueued(createStatedWeightRecorder({ jobs: jobService, logger }));

    // Mounted here, with the rest of the projection-backed surface: `doctor`
    // reads the database and `rebuild` replaces it, so neither means anything on
    // a server that was built without one.
    mountDbRoutes(app, {
      config,
      projection: deps.projection,
      queue,
      logger,
      invalidate: deps.invalidate ?? invalidate,
      index: indexMaintenance,
    });

    // §11's validator over HTTP, and §7's skill creation. Both need the
    // projection — the check resolves ids and answers "does this `[[ref]]`
    // target exist", a create mints an id against it — so both live in this
    // block.
    mountCheckRoutes(app, {
      workspaceRoot: config.workspaceRoot,
      projection: deps.projection,
    });
    mountSkillRoutes(app, docsWorkspace, mutex);
  }

  // Outside the projection block on purpose: serving bytes reads the filesystem
  // and nothing else — no rows, no git — so a server built without a
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

  let httpServer: ServerType | undefined;
  let closePromise: Promise<void> | undefined;

  const bind = (): Promise<BoundAddress> =>
    new Promise<BoundAddress>((resolvePromise, rejectPromise) => {
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

  const start = async (): Promise<BoundAddress> => {
    // Loopback-only is enforced here, before the bind, and not in the config
    // schema (Sprint-002 Adjudication 6): the file parses — the CLI reads the
    // same one and only needs a dial target — but *this* process refuses to
    // put an unencrypted, single-token API on a routable interface. It is asked
    // ahead of the recovery below, so a server that will refuse to start writes
    // nothing to the operator's repository on its way out.
    if (!isLoopbackHost(config.host)) {
      throw nonLoopbackBindError(config.host, config.configPath);
    }
    // SPEC.md §4: what a previous run left uncommitted is committed *before*
    // anything can add to it. Awaited here rather than registered, because the
    // guarantee is about ordering: no request can be served until it is done —
    // the socket does not exist yet — so a recovery commit is never half of one.
    // A recovery that git refuses is logged and returned, never thrown: a
    // workspace that cannot commit is still a workspace you can read.
    await recoverAtBoot?.();
    const address = await bind();
    // SPEC.md §7's restart rule, and it runs **after** the bind rather than
    // before: a restart is evidence of nothing about how quiet the corpus is —
    // the process that knew went away — so boot counts as the most recent
    // activity and the first automatic reflection is one whole window later,
    // never at the instant of start.
    reflect?.start();
    return address;
  };

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      // §4's clean stop, and it has to come *before* the acknowledgments below.
      // Closing the window relabels its commit, which moves its sha; the
      // committer announces that move and the tracker follows it
      // (`onWindowRewritten` → `observeRewrite`), so an acknowledgment enqueued
      // after this names the commit the history actually ends at. The other
      // order silently loses the relabel: sealing a session calls
      // `endSquashSession` — the published sha may no longer be amended — which
      // forgets the window, and the close that follows has nothing left to name.
      // Measured before this line existed: a shutdown after two user saves left
      // `doc edit: …` as the subject and enqueued a range naming the pre-rewrite
      // sha.
      await closeCommitWindow?.();
      // Then, and before `queue.close()` releases the parked long-polls: a
      // reader's edit session cannot outlive this process, so §4's close path
      // fires for every session still open and the acknowledgments go into the
      // queue while there is still a parked `corpus queue idle` to wake
      // (SERVER-052). Failures are the tracker's own to log — a shutdown never
      // fails because an acknowledgment could not be enqueued.
      await editSessions?.close();
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
    mutex: documentMutex,
    bus,
    selfWrites,
    semantic,
    indexMaintenance,
    indexAnnouncer,
    editSessions,
    commitOutOfBand,
    reflect,
    registerDisposer,
    start,
    close,
  };
}
