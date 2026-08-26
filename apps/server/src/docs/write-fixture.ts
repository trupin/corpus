// A real workspace, a real git repository and the real Hono app, for the write
// path's tests.
//
// Nothing here is a mock. Git behaviour — authorship, amends, hook rejection,
// environment inheritance — is the substance of SERVER-005, and a test that
// stubbed it would assert only that the stub was called. So every fixture is a
// temp directory with an actual `git init` inside it, driven through
// `app.request`, and every assertion reads one of the three real surfaces: the
// file on disk, `git log`, or the projection.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ALL_CONTRACT_ROUTES } from "@corpus/contract";
import { createServer, type CorpusServer } from "../app.js";
import { createContractPathMatcher } from "../middleware/route-path.js";
import { DEFAULT_ATTACHMENT_LIMITS, type AttachmentLimits } from "../attachments/index.js";
import type { ServerConfig } from "../config.js";
import type { StalenessThresholds } from "./staleness.js";
import { disableAutoMaintenance, sanitizeGitEnv } from "../git/index.js";
import {
  createProjectionQueueMirror,
  openProjection,
  populateFromFiles,
  type ProjectionDb,
} from "../projection/index.js";
import { documentKey } from "./key.js";

// ---------------------------------------------------------------------------
// SERVER-119: every response this fixture returns is checked against the
// statuses its operation declares.
//
// Three routes had shipped a status the contract did not declare —
// `GET /api/queue/idle`'s `422` (CONTRACT-058), `PUT /api/docs/{id}`'s `403`
// (CONTRACT-059), and three queue `409`s at once after SERVER-145
// (CONTRACT-083) — and all of them were found by a person sweeping by hand,
// once, while doing something else. The existing suite already *produced* each
// of them: `roster.test.ts` asserts the 422, `provenance.test.ts` asserts the
// 403, the queue suites assert the 409s. Nothing looked.
//
// **Why here and not in `packages/contract`.** CONTRACT-058 established that a
// check there cannot work: it may not import `apps/server`, and nothing in the
// document knows which statuses a handler reaches. CONTRACT-083 sharpened it —
// a queue `409` is triggered by the event's current status on the server, which
// appears in no request, in no response (`QueueEvent` publishes no `status`
// field) and in no declaration, so no sweep over `openapi.json` can derive that
// it is owed. The response seam is the only place the question is answerable.
//
// **What a green suite does not mean.** This turns the tests the repo already
// has into the cross-check; it cannot see anything they do not exercise:
//
// - a route with no integration test says nothing here;
// - a route the fixture never reaches with a given status says nothing about
//   that status;
// - the two **declared but unmounted** upgrade routes CONTRACT-058 found are
//   the mirror image of this check and are invisible to it — they are declared
//   statuses no handler returns, where this catches returned statuses no
//   declaration names. `app.test.ts`'s mounted-route sweep is what covers that
//   direction;
// - **seventeen suites build their own server** with `createServer` rather than
//   through this fixture, and are unchecked unless they call
//   {@link checkDeclaredStatuses} themselves. One does — `queue/routes.test.ts`,
//   because that is where CONTRACT-083's three `409`s were asserted green. The
//   other sixteen are a known gap, not an oversight: wiring them is sixteen more
//   files and this issue is deliberately one.
//
// A request whose path and method match no contract route is left alone, which
// is how the static UI shell, `/events` and a deliberately unrouted path stay
// testable.
// ---------------------------------------------------------------------------

interface ContractOperation {
  readonly method: string;
  readonly path: string;
  readonly matches: (path: string) => boolean;
  readonly statuses: ReadonlySet<number>;
}

/**
 * Literal paths before parameterized ones, so `/api/docs/tree` is resolved as
 * itself rather than as `/api/docs/{id}` with an odd id.
 */
const CONTRACT_OPERATIONS: readonly ContractOperation[] = ALL_CONTRACT_ROUTES.map((route) => ({
  method: route.method.toUpperCase(),
  path: route.path,
  matches: createContractPathMatcher(route.path),
  statuses: new Set(
    Object.keys(route.responses)
      .map(Number)
      .filter((status) => Number.isFinite(status)),
  ),
})).sort((a, b) => Number(a.path.includes("{")) - Number(b.path.includes("{")));

/**
 * What `Hono.request` accepts, taken from the method itself rather than
 * restated — a `lib.dom` `RequestInfo` is not in this workspace's globals, and a
 * hand-written union would drift from the framework's.
 */
type RequestTarget = Parameters<CorpusServer["app"]["request"]>[0];

/** The path a fixture request names, with any query string and origin removed. */
const requestPath = (input: RequestTarget): string => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const withoutQuery = raw.split("?")[0] ?? raw;
  const withoutHash = withoutQuery.split("#")[0] ?? withoutQuery;
  const scheme = withoutHash.indexOf("://");
  if (scheme === -1) return withoutHash;
  const afterOrigin = withoutHash.indexOf("/", scheme + 3);
  return afterOrigin === -1 ? "/" : withoutHash.slice(afterOrigin);
};

const requestMethod = (input: RequestTarget, init: RequestInit | undefined): string =>
  (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

/**
 * The one status this cannot ask a route about, exempt for everyone rather than
 * per test — and the reasoning, because a blanket exemption is the thing
 * SERVER-119 asks not to be reached for lightly.
 *
 * `500` is the envelope `app.onError` puts on **any** unhandled throw, on any
 * route, and no route in `packages/contract` declares it. The seven tests that
 * reach it here all inject a filesystem failure on purpose and then assert
 * SPEC.md §11's promise — the bytes survive, the folder is restored, the order
 * does not half-apply. They are asserting recovery, not an interface.
 *
 * Two reasons it is a global exemption and not seven opt-outs. Whether a
 * mutating route should *declare* `500` is a contract question, in another
 * domain, over roughly sixty routes — a check in `apps/server` must not
 * pre-judge it by making the suite red until someone does. And exempting it
 * costs this check nothing against the class it exists for: CONTRACT-058's
 * `422`, CONTRACT-059's `403` and CONTRACT-083's three `409`s are all statuses a
 * handler *chose*, and every one of them is still caught.
 *
 * If the contract ever declares `500`, delete this and the check tightens by
 * itself.
 */
const FRAMEWORK_ENVELOPE_STATUS = 500;

/**
 * Nesting depth of {@link withUndeclaredStatus}. A counter rather than a boolean
 * so nesting cannot end the suspension early.
 */
let suspensions = 0;
/** Undeclared statuses seen while suspended, so a stale opt-out is detectable. */
let suspendedHits = 0;

/**
 * Runs `body` with the declared-status check suspended, for a call that
 * deliberately reaches a response no operation declares.
 *
 * `reason` is required and is not decoration: it appears in the failure when the
 * opt-out turns out to be unnecessary. An opt-out that stops being needed is a
 * hole nobody is watching, so this **fails** rather than passing quietly —
 * which is what keeps the escape hatch from spreading.
 *
 * Suspension is process-wide for its duration, so a `.concurrent` test in the
 * same file could shelter under someone else's opt-out. Nothing in the suite is
 * concurrent today, and the alternative — threading a flag through every
 * request helper — would put the escape hatch on the hot path of every call.
 */
export async function withUndeclaredStatus<T>(reason: string, body: () => Promise<T>): Promise<T> {
  const before = suspendedHits;
  suspensions += 1;
  let result: T;
  try {
    result = await body();
  } finally {
    suspensions -= 1;
  }
  if (suspendedHits === before) {
    throw new Error(
      `withUndeclaredStatus("${reason}") saw no undeclared status, so the opt-out is stale. ` +
        "Remove it — leaving it in place hides the next one.",
    );
  }
  return result;
}

/**
 * Throws when a response carries a status its operation does not declare, in
 * words that name the fix — which is a contract change, in another domain.
 */
export function assertDeclaredStatus(
  input: RequestTarget,
  init: RequestInit | undefined,
  status: number,
): void {
  if (status === FRAMEWORK_ENVELOPE_STATUS) return;
  const method = requestMethod(input, init);
  const path = requestPath(input);
  const operation = CONTRACT_OPERATIONS.find(
    (candidate) => candidate.method === method && candidate.matches(path),
  );
  if (operation === undefined || operation.statuses.has(status)) return;
  if (suspensions > 0) {
    suspendedHits += 1;
    return;
  }
  const declared = [...operation.statuses].sort((a, b) => a - b).join(", ");
  const message =
    `${method} ${operation.path} answered ${status}, which the contract does not declare ` +
    `(it declares ${declared}). The request was ${method} ${path}.\n` +
    "Fix it in one of two ways: declare the status on that route in " +
    "packages/contract/src/routes/ — a contract change, so route it to contract-dev — " +
    "or stop returning it. Do not loosen this check.";
  // Printed as well as thrown, because a caller can swallow the throw and the
  // reader then loses the only sentence that says what to do. `roster.test.ts`
  // is exactly that: its park helper is `done.catch(() => new Response(null,
  // { status: 499 }))`, so the whole suite reports `expected 499 to be 422` and
  // nothing else. This runs only on a real violation, so it is never noise.
  console.error(message);
  throw new Error(message);
}

/**
 * Installs the check on one server, in place.
 *
 * {@link createWriteWorkspace} does it for every fixture it builds, which is
 * most of the integration suite. Seventeen files call `createServer` themselves
 * and are **not** covered unless they ask — `queue/routes.test.ts` does, because
 * it is where CONTRACT-083's three undeclared `409`s were asserted and the
 * reason this issue's case is made from three instances rather than one.
 *
 * The seam is `app.request` rather than the fixture's four helpers, because
 * suites reach past those (`roster.test.ts` builds its park directly, and it is
 * one of the two known-answer cases).
 */
export function checkDeclaredStatuses(server: CorpusServer): void {
  const dispatch = server.app.request.bind(server.app);
  server.app.request = async (input, init, env, executionCtx): Promise<Response> => {
    const response = await dispatch(input, init, env, executionCtx);
    assertDeclaredStatus(input, init, response.status);
    return response;
  };
}

/**
 * Two routes a fixture must never actually call, and what happens if it does.
 *
 * `POST /api/upgrade` spawns a **real detached `corpus upgrade`** (SERVER-050).
 * In a source checkout the CLI is exactly where the trigger looks, so a sweep
 * that walks declared routes starts an installer on the machine running the
 * suite — with `npm install -g` in its future and no test watching it. That is
 * not hypothetical: `json-body.test.ts`'s mutating sweep and
 * `write-fixture.test.ts` both hit this path the moment the routes were mounted,
 * and the only reason nothing was installed is that the running version happened
 * to equal the latest release.
 *
 * `GET /api/upgrade/check` reaches GitHub. A unit suite that makes a real
 * network request is a suite that fails on a train.
 *
 * So the fixture refuses both, by path, before dispatch. Neither is untested —
 * `upgrade/routes.test.ts` builds its own server with a `spawn` that records and
 * a `fetch` that answers — and a refusal here is a sentence naming that file,
 * rather than a mystery in someone's npm prefix.
 */
const REFUSED_IN_A_FIXTURE: ReadonlyMap<string, string> = new Map([
  ["POST /api/upgrade", "it spawns a real, detached `corpus upgrade` on this machine"],
  ["GET /api/upgrade/check", "it makes a real request to the GitHub Releases API"],
]);

/**
 * Installs the refusal on one server, in place. Wraps `app.request` for
 * {@link checkDeclaredStatuses}'s reason: suites reach past the fixture's four
 * helpers, so the helpers are the wrong seam.
 */
export function refuseRealWorldRoutes(server: CorpusServer): void {
  const dispatch = server.app.request.bind(server.app);
  server.app.request = async (input, init, env, executionCtx): Promise<Response> => {
    const key = `${requestMethod(input, init)} ${requestPath(input)}`;
    const why = REFUSED_IN_A_FIXTURE.get(key);
    if (why !== undefined) {
      throw new Error(
        `${key} must not be called from a fixture: ${why}. ` +
          "Test the upgrade routes in apps/server/src/upgrade/routes.test.ts, which builds a " +
          "server with an injected `spawn` and `fetch`. If a sweep reached this path, exclude " +
          "it there rather than removing this guard.",
      );
    }
    return dispatch(input, init, env, executionCtx);
  };
}

export const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
export const AUTH: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
export const JSON_HEADERS: Record<string, string> = { ...AUTH, "content-type": "application/json" };

/** Fixed so every stamped instant in a test is a deliberate value, not a wall clock. */
export const FIXTURE_NOW = Date.parse("2026-07-27T09:00:00Z");

export interface WriteWorkspace {
  readonly root: string;
  readonly db: ProjectionDb;
  readonly server: CorpusServer;
  /** Milliseconds the injected clock reports; assign to advance it. */
  clock: number;
  advance(ms: number): void;
  request(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  put(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  del(path: string, headers?: Record<string, string>): Promise<Response>;
  read(relativePath: string): string;
  write(relativePath: string, content: string): void;
  exists(relativePath: string): boolean;
  git(...args: string[]): string;
  /** `git log` newest-first in the given `--format`, one entry per line. */
  log(format: string): string[];
  head(): string;
  reproject(): void;
  close(): void;
}

export interface WriteWorkspaceOptions {
  /** Skip `git init`, for the "a workspace without git still works" cases. */
  readonly git?: boolean | undefined;
  /** Configure a repository identity, so the committer is not the fallback. */
  readonly identity?: boolean | undefined;
  /**
   * Sprint label in the scratch directory's name, so a failed run's leftovers
   * say which issue created them. Defaults to the sprint that wrote this
   * fixture; SERVER-006's thread suites pass their own.
   */
  readonly sprint?: string | undefined;
  /**
   * Attachment caps, for the suites that prove the limit is read from
   * configuration rather than hard-coded (SERVER-010). Defaults to the shipped
   * values, so no other fixture has to know they exist.
   */
  readonly attachments?: AttachmentLimits | undefined;
  /**
   * SPEC.md §4's edit-acknowledgment window (SERVER-052). Shortened by the
   * suites that have to watch a session *idle out*, which at the shipped three
   * minutes no test can wait for. Omitted, the server resolves the default, so
   * no other fixture has to know the window exists.
   */
  readonly editAckIdleMs?: number | undefined;
  /**
   * SPEC.md §7's quiet window in minutes (SERVER-137). Shortened — or set to
   * `0` — by the suites that watch the automatic path; omitted, the server
   * resolves the shipped default and nothing arms inside a test, because these
   * fixtures never call `start()`.
   */
  readonly reflectQuietMinutes?: number | undefined;
  /**
   * SPEC.md §5's staleness ramp (SERVER-133). Passed by the suite that proves
   * the ramp is read from configuration rather than hard-coded; omitted, the
   * server resolves the shipped 30/90/180 and no other fixture has to know the
   * block exists.
   */
  readonly staleness?: StalenessThresholds | undefined;
}

const serverConfig = (
  workspaceRoot: string,
  attachments: AttachmentLimits,
  editAckIdleMs: number | undefined,
  reflectQuietMinutes: number | undefined,
  staleness: StalenessThresholds | undefined,
): ServerConfig => ({
  ...(editAckIdleMs === undefined ? {} : { editAcknowledgment: { idleMs: editAckIdleMs } }),
  ...(reflectQuietMinutes === undefined ? {} : { reflect: { quiet: reflectQuietMinutes } }),
  ...(staleness === undefined ? {} : { staleness }),
  workspaceRoot,
  corpusDir: join(workspaceRoot, ".corpus"),
  attachments,
  dataDir: join(workspaceRoot, "data"),
  configPath: join(workspaceRoot, ".corpus", "config.json"),
  host: "127.0.0.1",
  port: 0,
  token: TOKEN,
  version: "9.9.9",
  logLevel: "silent",
  uiDistDir: undefined,
  embedding: { kind: "absent" },
  warnings: [],
});

export function createWriteWorkspace(
  prefix: string,
  options: WriteWorkspaceOptions = {},
): WriteWorkspace {
  // Every fixture repository lives under the sprint's own scratch prefix, and
  // every git invocation below carries an explicit `cwd`: a `git commit` that
  // ran with the wrong working directory would commit into the Corpus repo.
  const root = mkdtempSync(join(tmpdir(), `corpus-${options.sprint ?? "s005"}-${prefix}-`));
  const workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs", "inbox"), { recursive: true });
  mkdirSync(join(workspaceRoot, "data", "threads"), { recursive: true });
  mkdirSync(join(workspaceRoot, ".corpus"), { recursive: true });

  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: workspaceRoot,
      env: sanitizeGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  if (options.git !== false) {
    git("init", "--initial-branch=main");
    disableAutoMaintenance(git);
    if (options.identity !== false) {
      git("config", "user.name", "Workspace Owner");
      git("config", "user.email", "owner@example.test");
    }
    writeFileSync(join(workspaceRoot, ".gitignore"), ".corpus/\n", "utf8");
    git("add", "-A", "--", ".gitignore");
    git(
      "-c",
      "user.name=Seed",
      "-c",
      "user.email=seed@example.test",
      "commit",
      "-m",
      "seed the workspace",
    );
  }

  const config = serverConfig(
    workspaceRoot,
    options.attachments ?? DEFAULT_ATTACHMENT_LIMITS,
    options.editAckIdleMs,
    options.reflectQuietMinutes,
    options.staleness,
  );
  const db = openProjection(config, { populate: false });

  const state = { clock: FIXTURE_NOW };
  const server = createServer(config, {
    projection: db,
    now: () => state.clock,
    heartbeatMs: 0,
  });
  checkDeclaredStatuses(server);
  refuseRealWorldRoutes(server);
  // What `attachProjection` does in production: the queue's `events` table is a
  // mirror bound after construction, so without this an enqueue lands on disk
  // and never reaches the projection — a difference a thread test would
  // otherwise mistake for a missing write.
  server.queue.attachMirror(createProjectionQueueMirror(db));

  const write = (relativePath: string, content: string): void => {
    const abs = join(workspaceRoot, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  };

  const workspace: WriteWorkspace = {
    root: workspaceRoot,
    db,
    server,
    get clock() {
      return state.clock;
    },
    set clock(value: number) {
      state.clock = value;
    },
    advance(ms) {
      state.clock += ms;
    },
    async request(path, init = { headers: AUTH }) {
      return server.app.request(path, init);
    },
    async post(path, body, headers = {}) {
      return server.app.request(path, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...headers },
        body: JSON.stringify(body),
      });
    },
    async put(path, body, headers = {}) {
      return server.app.request(path, {
        method: "PUT",
        headers: { ...JSON_HEADERS, ...headers },
        body: JSON.stringify(body),
      });
    },
    async del(path, headers = {}) {
      return server.app.request(path, { method: "DELETE", headers: { ...AUTH, ...headers } });
    },
    read: (relativePath) => readFileSync(join(workspaceRoot, relativePath), "utf8"),
    write,
    exists: (relativePath) => existsSync(join(workspaceRoot, relativePath)),
    git,
    log: (format) =>
      git("log", `--format=${format}`)
        .split("\n")
        .filter((line) => line !== ""),
    head: () => git("rev-parse", "HEAD").trim(),
    reproject: () => {
      populateFromFiles(db);
    },
    close() {
      // Disarms SPEC.md §7's quiet window before the handle it would query goes
      // away. These fixtures never call `server.close()`, so its disposers do
      // not run, and a timer armed by a write in this test must not fire
      // against a closed database in the next one.
      server.reflect?.stop();
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return workspace;
}

/**
 * The key of the document stored at `relativePath` (SPEC.md §7), for the tests
 * that call a write verb **in process** and so never see a read response to take
 * one from.
 *
 * It calls the server's own derivation rather than restating it: a fixture that
 * hashed the bytes its own way would pass against a server that published a key
 * it does not check. Everything that goes over HTTP uses {@link readDocKey}.
 */
export const keyOnDisk = (ws: WriteWorkspace, relativePath: string): string =>
  documentKey(ws.read(relativePath));

/**
 * The key `GET /api/docs/{id}` currently hands out (SPEC.md §7) — what a
 * body-replacing `PUT` has to present back.
 *
 * Read over HTTP rather than derived from the file, deliberately: a fixture that
 * hashed the bytes itself would be a second implementation of the derivation,
 * and every keyed test would then pass against a server that published a
 * different key from the one it checks.
 */
export async function readDocKey(ws: WriteWorkspace, id: string): Promise<string> {
  const response = await ws.request(`/api/docs/${id}`, { headers: AUTH });
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.status !== 200) {
    throw new Error(`read failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  const key = payload["key"];
  if (typeof key !== "string") throw new Error(`no key on ${id}: ${JSON.stringify(payload)}`);
  return key;
}

/**
 * `PUT /api/docs/{id}` the way a well-behaved client writes: read the document,
 * then present the key it carried (SPEC.md §7).
 *
 * Fills the key in only when the patch does not already name one, so a test
 * about the mechanism itself — a stale key, an absent one — still says exactly
 * what it sends by calling `ws.put` or passing `key` explicitly.
 */
export async function putDoc(
  ws: WriteWorkspace,
  id: string,
  patch: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const keyed =
    patch["body"] === undefined || patch["key"] !== undefined
      ? patch
      : { ...patch, key: await readDocKey(ws, id) };
  return ws.put(`/api/docs/${id}`, keyed, headers);
}

/**
 * `POST /api/docs`, returning the created document, failing loudly on anything
 * else. The response is §11's mutation envelope — `{ doc, warnings }` — so the
 * document is unwrapped here and `warnings` handed back beside it for the tests
 * that assert on it.
 */
export async function createDoc(
  ws: WriteWorkspace,
  body: Record<string, unknown>,
  actor?: "user" | "agent",
): Promise<{
  id: string;
  path: string;
  body: Record<string, unknown>;
  warnings: { code: string; detail: string }[];
}> {
  const response = await ws.post(
    "/api/docs",
    body,
    actor === undefined ? {} : { "x-corpus-author": actor },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.status !== 201) {
    throw new Error(`create failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  const doc = payload["doc"] as Record<string, unknown>;
  const frontmatter = doc["frontmatter"] as { id: string };
  return {
    id: frontmatter.id,
    path: doc["path"] as string,
    body: doc,
    warnings: payload["warnings"] as { code: string; detail: string }[],
  };
}
