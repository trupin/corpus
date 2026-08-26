import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UpgradeCheckSchema, UpgradeStartedSchema } from "@corpus/contract";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import { createServer } from "../app.js";
import { silentLogger } from "../logger.js";
import type { ServerConfig } from "../config.js";
import type { SpawnFn } from "./trigger.js";
import { checkForUpgrade, workspaceRelative } from "./routes.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let root: string;
let workspaceRoot: string;
let packageRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-upgrade-routes-"));
  workspaceRoot = join(root, "ws");
  packageRoot = join(root, "pkg");
  mkdirSync(join(workspaceRoot, ".corpus"), { recursive: true });
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(join(packageRoot, "dist", "corpus.js"), "// fixture\n", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(): ServerConfig {
  return {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "0.24.0",
    logLevel: "silent",
    uiDistDir: undefined,
    embedding: { kind: "absent" },
    warnings: [],
  };
}

/** A releases API that answers with one release carrying the pair INFRA-016 publishes. */
function githubServing(payload: unknown, status = 200): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

function release(version: string, assets: readonly string[]): unknown {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/trupin/corpus/releases/tag/v${version}`,
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://example.invalid/${name}`,
    })),
  };
}

const NEWER = release("0.25.0", ["corpus-0.25.0.tgz", "corpus-0.25.0.tgz.sha256"]);

interface Harness {
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly spawned: { command: string; args: readonly string[] }[];
}

function harness(
  overrides: {
    readonly fetch?: typeof globalThis.fetch;
    readonly packageRoot?: string;
    readonly spawnPid?: number;
  } = {},
): Harness {
  const spawned: { command: string; args: readonly string[] }[] = [];
  const spawn: SpawnFn = (command, args) => {
    spawned.push({ command, args });
    return { pid: overrides.spawnPid ?? 9001, unref: () => undefined } as unknown as ReturnType<
      typeof spawn
    >;
  };
  const { app } = createServer(makeConfig(), {
    logger: silentLogger,
    packageRoot: overrides.packageRoot ?? packageRoot,
    env: {},
    fetch: overrides.fetch ?? githubServing(NEWER),
    spawn,
    isAlive: () => true,
  });
  return {
    request: async (path, init) => app.request(path, init),
    spawned,
  };
}

describe("GET /api/upgrade/check", () => {
  it("answers the contract's shape, with both verdicts, for a newer verifiable release", async () => {
    const response = await harness().request("/api/upgrade/check", { headers: AUTH });
    expect(response.status).toBe(200);

    const body = UpgradeCheckSchema.parse(await response.json());
    expect(body).toEqual({
      installed: "0.24.0",
      latest: "0.25.0",
      upgradeAvailable: true,
      verifiable: true,
      notesUrl: "https://github.com/trupin/corpus/releases/tag/v0.25.0",
      reachable: true,
      detail: null,
    });
  });

  it("says a newer release without a checksum is not an upgrade target", async () => {
    const response = await harness({
      fetch: githubServing(release("0.25.0", ["corpus-0.25.0.tgz"])),
    }).request("/api/upgrade/check", { headers: AUTH });

    const body = UpgradeCheckSchema.parse(await response.json());
    // The two verdicts disagreeing is the case the schema exists to make
    // representable: a client must explain rather than offer an action the
    // upgrade will refuse.
    expect(body.upgradeAvailable).toBe(true);
    expect(body.verifiable).toBe(false);
    expect(body.detail).toContain("published checksum");
  });

  it("reports an unreachable GitHub as a 200, never a 5xx", async () => {
    const offline = (() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as unknown as typeof globalThis.fetch;
    const response = await harness({ fetch: offline }).request("/api/upgrade/check", {
      headers: AUTH,
    });

    expect(response.status).toBe(200);
    const body = UpgradeCheckSchema.parse(await response.json());
    expect(body.reachable).toBe(false);
    // `installed` is a fact about this process and survives a failed look.
    expect(body.installed).toBe("0.24.0");
    expect(body.latest).toBeNull();
    expect(body.upgradeAvailable).toBe(false);
    expect(body.detail).toContain("ENOTFOUND");
  });

  it("says so plainly when the distribution has published nothing", async () => {
    const response = await harness({ fetch: githubServing({}, 404) }).request(
      "/api/upgrade/check",
      { headers: AUTH },
    );
    const body = UpgradeCheckSchema.parse(await response.json());
    expect(body.reachable).toBe(true);
    expect(body.detail).toContain("no releases yet");
  });

  it("refuses without a token", async () => {
    expect((await harness().request("/api/upgrade/check")).status).toBe(401);
  });

  it("keeps nothing between calls — every check is one request", async () => {
    let calls = 0;
    const counting = (() => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(NEWER), { headers: { "content-type": "application/json" } }),
      );
    }) as unknown as typeof globalThis.fetch;

    const app = harness({ fetch: counting });
    await app.request("/api/upgrade/check", { headers: AUTH });
    await app.request("/api/upgrade/check", { headers: AUTH });
    // §2.4: never in the background, and equally never from a cache that would
    // let a client remember an answer. Two asks, two looks.
    expect(calls).toBe(2);
  });
});

describe("POST /api/upgrade", () => {
  it("spawns the CLI, answers 202 before it finishes, and names the log", async () => {
    const app = harness();
    const response = await app.request("/api/upgrade", { method: "POST", headers: AUTH });

    expect(response.status).toBe(202);
    expect(UpgradeStartedSchema.parse(await response.json())).toEqual({
      started: true,
      // Workspace-relative, with forward slashes: the client rendering it is a
      // browser and cannot see this server's disk.
      logPath: ".corpus/upgrade.log",
    });
    // The report, not the console log: the CLI owns the report and writes it as
    // it goes, and it is what `UpgradeStarted.logPath` describes.
    expect(app.spawned).toHaveLength(1);
    expect(app.spawned[0]?.args.at(-1)).toBe("upgrade");
  });

  it("refuses a second trigger with 409 and spawns nothing", async () => {
    const app = harness();
    await app.request("/api/upgrade", { method: "POST", headers: AUTH });
    const second = await app.request("/api/upgrade", { method: "POST", headers: AUTH });

    expect(second.status).toBe(409);
    const body = (await second.json()) as { code: string; message: string };
    expect(body.code).toBe("conflict");
    expect(body.message).toContain("upgrade.log");
    expect(app.spawned).toHaveLength(1);
  });

  it("answers 500 naming where it looked when the CLI is missing", async () => {
    const app = harness({ packageRoot: join(root, "gone") });
    const response = await app.request("/api/upgrade", { method: "POST", headers: AUTH });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).toContain("corpus.js");
    expect(app.spawned).toHaveLength(0);
  });

  it("refuses without a token, and starts nothing", async () => {
    const app = harness();
    expect((await app.request("/api/upgrade", { method: "POST" })).status).toBe(401);
    expect(app.spawned).toHaveLength(0);
  });
});

describe("checkForUpgrade", () => {
  it("reads the fork overrides both consumers share", async () => {
    let asked = "";
    const recording = ((url: string) => {
      asked = url;
      return Promise.resolve(
        new Response(JSON.stringify(NEWER), { headers: { "content-type": "application/json" } }),
      );
    }) as unknown as typeof globalThis.fetch;

    await checkForUpgrade({
      version: "0.24.0",
      workspaceRoot,
      corpusDir: join(workspaceRoot, ".corpus"),
      packageRoot,
      env: { CORPUS_RELEASES_API: "https://mirror.invalid", CORPUS_RELEASES_REPO: "someone/fork" },
      fetch: recording,
    });
    expect(asked).toBe("https://mirror.invalid/repos/someone/fork/releases/latest");
  });
});

describe("workspaceRelative", () => {
  it("renders a path under the workspace with forward slashes", () => {
    expect(workspaceRelative(join("a", "b"), join("a", "b", ".corpus", "upgrade.log"))).toBe(
      ".corpus/upgrade.log",
    );
  });
});
