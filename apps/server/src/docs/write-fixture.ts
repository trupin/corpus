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
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { sanitizeGitEnv } from "../git/index.js";
import { openProjection, populateFromFiles, type ProjectionDb } from "../projection/index.js";

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
}

const serverConfig = (workspaceRoot: string): ServerConfig => ({
  workspaceRoot,
  corpusDir: join(workspaceRoot, ".corpus"),
  dataDir: join(workspaceRoot, "data"),
  configPath: join(workspaceRoot, ".corpus", "config.json"),
  host: "127.0.0.1",
  port: 0,
  token: TOKEN,
  version: "9.9.9",
  logLevel: "silent",
  uiDistDir: undefined,
  warnings: [],
});

export function createWriteWorkspace(
  prefix: string,
  options: WriteWorkspaceOptions = {},
): WriteWorkspace {
  // Every fixture repository lives under the sprint's own scratch prefix, and
  // every git invocation below carries an explicit `cwd`: a `git commit` that
  // ran with the wrong working directory would commit into the Corpus repo.
  const root = mkdtempSync(join(tmpdir(), `corpus-s005-${prefix}-`));
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

  const config = serverConfig(workspaceRoot);
  const db = openProjection(config, { populate: false });

  const state = { clock: FIXTURE_NOW };
  const server = createServer(config, {
    projection: db,
    now: () => state.clock,
    heartbeatMs: 0,
  });

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
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return workspace;
}

/**
 * `POST /api/docs`, returning the created document, failing loudly on anything
 * else. The response is §14's mutation envelope — `{ doc, warnings }` — so the
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
