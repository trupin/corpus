/**
 * Workspace construction, seeding plumbing, and the teardown that guarantees
 * isolation (INFRA-033).
 *
 * Every run gets a brand-new `corpus init` workspace in a temp directory, its
 * own server on a freshly allocated port, and a `corpus` shim on PATH pointing
 * at this tree's CLI build. Two safety rules are enforced here and nowhere
 * else can relax them:
 *
 * - **The harness acts only on workspaces it created.** `createWorkspace`
 *   writes a nonce marker beside the workspace, and every other operation
 *   verifies it before touching anything.
 * - **Port 8765 is never touched.** That is the operator's live server. The
 *   allocator refuses to hand it out, and every server this module starts or
 *   stops is addressed through its own workspace's CLI.
 *
 * The temp directory prefix is deliberately neutral (`corpus-`): the spawned
 * agent's working directory must not whisper that it is being observed
 * (rule 1 — see README.md).
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { QueueEventStatus } from "@corpus/contract";
import type { ComposerResult, CorpusResult, SeedContext, SeedSnapshot } from "./scenario.js";
import { readQueueState } from "./observe.js";

const execFileAsync = promisify(execFile);

/** The operator's live server. Nothing in the harness may ever address it. */
export const USER_SERVER_PORT = 8765;

/** Neutral on purpose — see the module doc. */
export const BASE_DIR_PREFIX = "corpus-";

/** The nonce marker `createWorkspace` writes beside the workspace. */
export const MARKER_FILE = ".corpus-run.json";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CLI_ENTRY = join(REPO_ROOT, "apps", "cli", "dist", "bin", "corpus.js");

/** How long one seeding/observation CLI call may take before it is a hang. */
const CLI_TIMEOUT_MS = 60_000;

/** `corpus health` retries while the just-started server comes up. */
const HEALTH_ATTEMPTS = 20;
const HEALTH_RETRY_MS = 500;

export interface RehearsalWorkspace {
  /** Holds `workspace/`, `bin/` and the marker. Removed whole on destroy. */
  readonly baseDir: string;
  readonly workspaceRoot: string;
  /** The `corpus` shim the agent (and the harness) runs. */
  readonly corpusBin: string;
  /** The bin directory prepended to the child's PATH. */
  readonly binDir: string;
  readonly port: number;
  readonly nonce: string;
}

export class RehearsalSafetyError extends Error {
  override readonly name = "RehearsalSafetyError";
}

/**
 * The child environment: the caller's, minus every `CORPUS_*` variable. A
 * leaked `CORPUS_WORKSPACE` or `CORPUS_FROM` from the developer's shell would
 * silently repoint or reattribute everything the run does.
 */
export function sanitizedEnv(binDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("CORPUS_")) continue;
    env[key] = value;
  }
  env.PATH = `${binDir}${delimiter}${env.PATH ?? ""}`;
  return env;
}

/** The shim script: exactly what an installed `corpus` bin is — process glue. */
export function shimContent(nodeBin: string, cliEntry: string): string {
  return `#!/bin/sh\nexec "${nodeBin}" "${cliEntry}" "$@"\n`;
}

/** An OS-assigned free localhost port, never {@link USER_SERVER_PORT}. */
export async function allocatePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolvePort, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close(() => reject(new Error("port allocation returned no address")));
          return;
        }
        server.close(() => resolvePort(address.port));
      });
    });
    if (port !== USER_SERVER_PORT) return port;
  }
}

/**
 * Verify the marker this fixture wrote. Every operation that touches a
 * workspace goes through this — the harness refuses to run against a
 * workspace it did not create.
 */
export async function assertRehearsalWorkspace(handle: RehearsalWorkspace): Promise<void> {
  if (handle.port === USER_SERVER_PORT) {
    throw new RehearsalSafetyError("refusing to act on port 8765 — that is the live server");
  }
  if (!handle.workspaceRoot.startsWith(handle.baseDir + "/")) {
    throw new RehearsalSafetyError(
      `workspace ${handle.workspaceRoot} is not inside its base ${handle.baseDir}`,
    );
  }
  const markerPath = join(handle.baseDir, MARKER_FILE);
  let raw: string;
  try {
    raw = await readFile(markerPath, "utf8");
  } catch (cause) {
    throw new RehearsalSafetyError(
      `no rehearsal marker at ${markerPath} — this harness did not create that workspace`,
      { cause },
    );
  }
  const marker: unknown = JSON.parse(raw);
  const nonce =
    typeof marker === "object" && marker !== null && "nonce" in marker ? marker.nonce : undefined;
  if (nonce !== handle.nonce) {
    throw new RehearsalSafetyError(
      `marker at ${markerPath} does not carry this run's nonce — refusing to act`,
    );
  }
}

async function runCorpus(
  handle: RehearsalWorkspace,
  args: readonly string[],
): Promise<CorpusResult> {
  await assertRehearsalWorkspace(handle);
  try {
    const { stdout, stderr } = await execFileAsync(handle.corpusBin, [...args], {
      cwd: handle.workspaceRoot,
      env: sanitizedEnv(handle.binDir),
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      code: typeof failed.code === "number" ? failed.code : 1,
      stdout: typeof failed.stdout === "string" ? failed.stdout : "",
      stderr: typeof failed.stderr === "string" ? failed.stderr : String(error),
    };
  }
}

/**
 * The composer's target, read from the workspace's own config — the same file
 * the CLI resolves its port and bearer token from (`.corpus/config.json`).
 */
const ComposerConfigSchema = z.looseObject({
  token: z.string().min(1),
  port: z.number().int().optional(),
  host: z.string().optional(),
});

export interface ComposerTarget {
  readonly origin: string;
  readonly token: string;
}

/**
 * Where a composer request goes, and the credential it carries. Refuses the
 * live server's port outright: a workspace config naming 8765 cannot belong to
 * a workspace this harness created, whatever the marker says.
 */
export async function readComposerTarget(workspaceRoot: string): Promise<ComposerTarget> {
  const raw = await readFile(join(workspaceRoot, ".corpus", "config.json"), "utf8");
  const config = ComposerConfigSchema.parse(JSON.parse(raw));
  const port = config.port ?? USER_SERVER_PORT;
  if (port === USER_SERVER_PORT) {
    throw new RehearsalSafetyError(
      `refusing to address port ${String(port)} — that is the live server, not a rehearsal workspace`,
    );
  }
  return { origin: `http://${config.host ?? "127.0.0.1"}:${String(port)}`, token: config.token };
}

/**
 * The person's composer, as one HTTP request to the workspace's own server —
 * `SeedContext.composer`'s documentation says why this surface exists at all.
 * No `x-corpus-author` header, so the server's default — `user` — attributes
 * it, exactly as the UI's composer is attributed.
 */
async function composerRequest(
  handle: RehearsalWorkspace,
  path: string,
  body: unknown,
): Promise<ComposerResult> {
  await assertRehearsalWorkspace(handle);
  const target = await readComposerTarget(handle.workspaceRoot);
  const response = await fetch(`${target.origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    // A non-JSON answer stays observable through `status`; the body was not it.
  }
  return { status: response.status, json };
}

/** What a scenario's `seed` receives: the workspace, through the product only. */
export function seedContext(handle: RehearsalWorkspace): SeedContext {
  return {
    workspaceRoot: handle.workspaceRoot,
    corpus: (args) => runCorpus(handle, args),
    composer: (path, body) => composerRequest(handle, path, body),
  };
}

/** `corpus <args>` for the harness's own bookkeeping (health, doc check, stop). */
export function corpusCli(
  handle: RehearsalWorkspace,
  args: readonly string[],
): Promise<CorpusResult> {
  return runCorpus(handle, args);
}

/**
 * Build a fresh workspace: temp base, shim, marker, `corpus init`, server up,
 * health green. Fails loudly when the CLI build is missing — the harness
 * rehearses this tree's build, never an installed corpus.
 */
export async function createWorkspace(): Promise<RehearsalWorkspace> {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`no CLI build at ${CLI_ENTRY} — run \`npm run build\` first`);
  }
  const baseDir = await mkdtemp(join(tmpdir(), BASE_DIR_PREFIX));
  const binDir = join(baseDir, "bin");
  await mkdir(binDir);
  const corpusBin = join(binDir, "corpus");
  await writeFile(corpusBin, shimContent(process.execPath, CLI_ENTRY), "utf8");
  await chmod(corpusBin, 0o755);
  const nonce = randomBytes(16).toString("hex");
  await writeFile(join(baseDir, MARKER_FILE), `${JSON.stringify({ nonce })}\n`, "utf8");

  const port = await allocatePort();
  const handle: RehearsalWorkspace = {
    baseDir,
    workspaceRoot: join(baseDir, "workspace"),
    corpusBin,
    binDir,
    port,
    nonce,
  };

  // `init` runs from the base (the workspace does not exist yet), so it cannot
  // go through `runCorpus`, whose safety check anchors on the final handle.
  await execFileAsync(corpusBin, ["init", "workspace", "--port", String(port)], {
    cwd: baseDir,
    env: sanitizedEnv(binDir),
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch((error: unknown) => {
    throw new Error(`corpus init failed in ${baseDir}`, { cause: error });
  });

  const started = await runCorpus(handle, ["server", "start"]);
  if (started.code !== 0) {
    throw new Error(`corpus server start failed (exit ${started.code}): ${started.stderr}`);
  }
  let healthy = false;
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS && !healthy; attempt += 1) {
    const health = await runCorpus(handle, ["health"]);
    healthy = health.code === 0;
    if (!healthy) await new Promise((r) => setTimeout(r, HEALTH_RETRY_MS));
  }
  if (!healthy) {
    throw new Error(`workspace server on port ${port} never answered corpus health`);
  }
  return handle;
}

/** How long to wait for the server to commit the seed's own writes. */
const SEED_COMMIT_WAIT_MS = 90_000;
const CLEAN_TREE_POLL_MS = 1_000;

/**
 * Wait for `git status --porcelain` to come back empty. The server gathers a
 * party's writes into one commit while its window is open, so a write's commit
 * can land seconds after the CLI call returns. True when the tree came clean
 * within the budget.
 */
export async function waitForCleanTree(workspaceRoot: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
    });
    if (status.trim() === "") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, CLEAN_TREE_POLL_MS));
  }
}

/**
 * Record the boundary the scorer measures from: HEAD, its tree, and the queue
 * as seeded.
 *
 * The clean-tree wait is load-bearing: a HEAD read before the seed's own
 * `user` commit lands would put that commit on the run's side of the boundary
 * and the authorship invariant would flag the seed itself (measured
 * 2026-09-01). The tree hash is recorded because the boundary commit will not
 * stay put: the server closes a commit window lazily, so the agent's first
 * write *amends* the seed's commit into its "editing session" relabel — same
 * content, new hash, after the boundary. Waiting does not help (measured: the
 * relabel arrived mid-run with a 35 s post-seed settle wait in place); the
 * scorer recognises the relabel by this tree instead.
 */
export async function snapshotSeed(handle: RehearsalWorkspace): Promise<SeedSnapshot> {
  await assertRehearsalWorkspace(handle);
  if (!(await waitForCleanTree(handle.workspaceRoot, SEED_COMMIT_WAIT_MS))) {
    throw new Error(
      `the seed's writes were still uncommitted after ${String(SEED_COMMIT_WAIT_MS)} ms`,
    );
  }
  const rev = async (spec: string): Promise<string> => {
    const { stdout } = await execFileAsync("git", ["rev-parse", spec], {
      cwd: handle.workspaceRoot,
    });
    return stdout.trim();
  };
  const head = await rev("HEAD");
  const headTree = await rev("HEAD^{tree}");
  // A root commit has no parent; the empty string is the honest reading, and
  // the scorer's predicate then never matches, which fails closed.
  const headParent = await rev("HEAD^").catch(() => "");
  const queue = await readQueueState(handle.workspaceRoot);
  const idsOf = (status: QueueEventStatus): readonly string[] =>
    queue.byStatus[status].map((event) => event.id);
  // Spelled out so that a status added to the contract is a compile error here
  // rather than a hole in the seed snapshot.
  return {
    head,
    headTree,
    headParent,
    queue: {
      pending: idsOf("pending"),
      "in-progress": idsOf("in-progress"),
      deferred: idsOf("deferred"),
      processed: idsOf("processed"),
      failed: idsOf("failed"),
      abandoned: idsOf("abandoned"),
    },
  };
}

/** Stop the workspace's server. Best-effort: an already-stopped server is fine. */
export async function stopServer(handle: RehearsalWorkspace): Promise<void> {
  await runCorpus(handle, ["server", "stop"]);
}

/** Remove the whole base directory. Refuses anything without our marker. */
export async function destroyWorkspace(handle: RehearsalWorkspace): Promise<void> {
  await assertRehearsalWorkspace(handle);
  await rm(handle.baseDir, { recursive: true, force: true });
}
