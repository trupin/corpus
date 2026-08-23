import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExitCode,
  isCliError,
  PartialFailureError,
  ServerUnreachableError,
  toProblem,
} from "../../errors.js";
import { INTERRUPT_SIGNALS, type InterruptSignal, type SignalTarget } from "../../signals.js";
import { upgradeLogPath } from "../../paths.js";
import { createTestContext, type TestContextOptions } from "../../registry/fixtures.js";
import { stubFetch } from "../../testing/fetch.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { commitAll, initRepository } from "../init/git.js";
import { generateToken, scaffoldWorkspace } from "../init/scaffold.js";
import { REPORT_MARKER } from "./journal.js";
import type { InstallMethod } from "./install.js";
import { runUpgrade, upgradeCommand, type UpgradeResult } from "./index.js";

/**
 * `corpus upgrade` end to end, against a real workspace, a real git repository
 * and a scripted release — and never against GitHub, npm, or anything installed
 * on the machine running the suite. The two effects that would be destructive
 * (the install and the server lifecycle) are injected; everything else is real,
 * because everything else is where this verb can be wrong: which files moved,
 * which were refused, what the report says, and what was written down.
 *
 * "The operator's npm replaced the package" is simulated the way the rest of the
 * CLI simulates it — by editing the tool-side template tree between the install
 * step and the sync — which is exactly what an install does to the directory the
 * running process resolves its template from.
 */

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `corpus-cli025-${label}-`));
  scratch.push(dir);
  return dir;
}

function write(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

function read(root: string, relative: string): string {
  return readFileSync(join(root, ...relative.split("/")), "utf8");
}

function makeTemplate(): string {
  const root = tempDir("template");
  write(root, "claude/skills/orchestrate/SKILL.md", "orchestrate v1\n");
  write(root, "claude/skills/comment/SKILL.md", "comment v1\n");
  write(root, "claude/agents/.gitkeep", "");
  write(
    root,
    "gitignore",
    ".corpus/*\n!.corpus/template-manifest.json\n!.corpus/queue/\n.corpus/queue/*/*.json\n",
  );
  write(root, "README.md", "readme v1\n");
  return root;
}

async function makeWorkspace(templateRoot: string): Promise<string> {
  const root = tempDir("ws");
  scaffoldWorkspace({
    root,
    templateRoot,
    port: 9210,
    token: generateToken(),
    toolVersion: "0.3.0",
  });
  await initRepository(root);
  await commitAll({ dir: root, message: "workspace: initialize corpus workspace by user" });
  return root;
}

const TARBALL = Buffer.from("corpus tarball bytes");
const DIGEST = "5b6d2b6a2a4e7f1f3a5f04e2a3d9f7d1e2c4b6a8d0f2e4c6a8b0d2f4e6c8a0b2";

/** The bytes and the digest that actually agree, computed once. */
async function digestOf(bytes: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

interface ReleaseFixture {
  readonly assets?: readonly string[];
  readonly version?: string;
  /** Serve a digest that does not match the tarball. */
  readonly corruptChecksum?: boolean;
  /** Answer nothing at all, as an offline machine does. */
  readonly offline?: boolean;
}

async function releaseFetch(fixture: ReleaseFixture = {}): Promise<typeof globalThis.fetch> {
  const version = fixture.version ?? "0.4.0";
  const names = fixture.assets ?? [`corpus-${version}.tgz`, `corpus-${version}.tgz.sha256`];
  const digest = fixture.corruptChecksum === true ? DIGEST : await digestOf(TARBALL);

  return stubFetch((url) => {
    if (fixture.offline === true) throw new TypeError("fetch failed");
    if (url.endsWith("/releases/latest")) {
      return Response.json({
        tag_name: `v${version}`,
        html_url: `https://github.test/releases/v${version}`,
        assets: names.map((name) => ({
          name,
          browser_download_url: `https://example.test/${name}`,
        })),
      });
    }
    if (url.endsWith(".sha256")) return new Response(`${digest}  corpus-${version}.tgz\n`);
    return new Response(new Uint8Array(TARBALL));
  });
}

/**
 * A real, writable npm prefix in a temporary directory. The writability check is
 * a genuine `access(W_OK)` against the real filesystem — the refusal it produces
 * is the one that keeps `sudo` out of the upgrade — so the fixture has to be a
 * directory that really exists and that this user really owns.
 */
function npmGlobal(): InstallMethod & { kind: "npm-global" } {
  const prefix = tempDir("prefix");
  const globalRoot = join(prefix, "lib", "node_modules");
  mkdirSync(globalRoot, { recursive: true });
  return {
    kind: "npm-global",
    packageRoot: join(globalRoot, "corpus"),
    packageName: "corpus",
    prefix,
    globalRoot,
  };
}

interface Harness {
  readonly stdout: () => string;
  readonly result: () => UpgradeResult;
  readonly lifecycle: string[];
  readonly installs: string[];
}

interface RunOptions extends ReleaseFixture {
  readonly root: string | null;
  readonly template: string;
  readonly json?: boolean;
  readonly flags?: TestContextOptions["flags"];
  readonly serverRunning?: boolean;
  /** Runs when the install "happens" — the seam for "the new tool ships this". */
  readonly onInstall?: () => void;
  readonly undetectable?: boolean;
  readonly installMethod?: InstallMethod;
}

async function run(options: RunOptions): Promise<Harness> {
  const base = createTestContext({
    flags: options.flags ?? {},
    json: options.json ?? true,
    cwd: options.root ?? tempDir("nowhere"),
    version: "0.3.0",
  });
  const lifecycle: string[] = [];
  const installs: string[] = [];

  await runUpgrade(base.context, {
    fetch: await releaseFetch(options),
    template: { templateRoot: options.template },
    installMethod:
      options.undetectable === true
        ? {
            kind: "undetectable",
            packageRoot: "/home/me/code/corpus/apps/cli",
            reason: "a source checkout",
          }
        : (options.installMethod ?? npmGlobal()),
    npm: (npmOptions) => {
      installs.push(npmOptions.tarballPath);
      options.onInstall?.();
      return Promise.resolve({ command: "npm install --global …", output: "" });
    },
    serverRunning: () => Promise.resolve(options.serverRunning ?? false),
    stopServer: () => {
      lifecycle.push("stop");
      return Promise.resolve();
    },
    startServer: () => {
      lifecycle.push("start");
      return Promise.resolve();
    },
  });

  return {
    lifecycle,
    installs,
    stdout: () => base.stdout(),
    result: () => JSON.parse(base.stdout()) as UpgradeResult,
  };
}

describe("corpus upgrade --check", () => {
  it("reports the release and writes absolutely nothing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");

    const harness = await run({ root, template, flags: { check: true } });
    const result = harness.result();

    expect(result.mode).toBe("check");
    expect(result.check).toMatchObject({
      installed: "0.3.0",
      latest: "0.4.0",
      upgradeAvailable: true,
      verifiable: true,
      reachable: true,
      notesUrl: "https://github.test/releases/v0.4.0",
    });
    expect(result.tool.installed).toBe(false);
    expect(harness.installs).toEqual([]);
    // Side-effect free means side-effect free: no install, no template write,
    // and not even the report file.
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");
    expect(existsSync(upgradeLogPath(root))).toBe(false);
    expect(result.reportPath).toBeNull();
  });

  it("says which template changes are pending, without applying them", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");

    const result = (await run({ root, template, flags: { check: true } })).result();
    expect(result.template?.dryRun).toBe(true);
    expect(result.template?.changes.map((change) => change.path)).toContain(
      ".claude/skills/orchestrate/SKILL.md",
    );
  });

  it("lists a conflict as unresolved work with the command that shows it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".claude/skills/comment/SKILL.md", "comment v1\nthe agent's own paragraph\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");

    const result = (await run({ root, template, flags: { check: true } })).result();
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict?.path).toBe(".claude/skills/comment/SKILL.md");
    expect(conflict?.detail).toContain("modified here");
    expect(conflict?.resolve).toBe("corpus workspace diff .claude/skills/comment/SKILL.md");
  });

  it("exits 0 and says so when GitHub cannot be reached", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const harness = await run({
      root,
      template,
      flags: { check: true },
      offline: true,
      json: false,
    });
    expect(harness.stdout()).toContain("could not check");
  });

  it("warns that a newer release is not installable from here", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const harness = await run({
      root,
      template,
      flags: { check: true },
      json: false,
      undetectable: true,
    });
    expect(harness.stdout()).toContain("NOT installable here");
  });

  it("warns that a newer release publishes no checksum", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const harness = await run({
      root,
      template,
      flags: { check: true },
      json: false,
      assets: ["corpus-0.4.0.tgz"],
    });
    expect(harness.stdout()).toContain("NOT installable");
    expect(harness.stdout()).toContain("nothing was downloaded, installed or written (--check).");
  });
});

describe("corpus upgrade", () => {
  it("installs, syncs the template, restarts, and reports all three", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    const harness = await run({
      root,
      template,
      serverRunning: true,
      // The install is what makes the new template appear on disk, so the sync
      // that follows compares against the *new* tool's files.
      onInstall: () => {
        write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
      },
    });
    const result = harness.result();

    expect(result.tool).toMatchObject({
      installed: true,
      from: "0.3.0",
      to: "0.4.0",
      method: "npm-global",
    });
    expect(result.tool.tarball?.name).toBe("corpus-0.4.0.tgz");
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v2\n");
    expect(result.template?.written).toContain(".claude/skills/orchestrate/SKILL.md");
    expect(result.template?.commit).not.toBeNull();
    expect(result.server).toMatchObject({ wasRunning: true, stopped: true, restarted: true });
    // Stopped before the install, restarted after the sync: the server that
    // comes back is the same generation as the files on disk.
    expect(harness.lifecycle).toEqual(["stop", "start"]);
    expect(result.conflicts).toEqual([]);
  });

  it("reports the version the installed package declares, not the one the release claimed", async () => {
    // The release's tag and the tarball's own manifest are two claims. Only the
    // second one is what the operator ends up running, so it is the one read
    // back — and a disagreement is said out loud rather than papered over.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const method = npmGlobal();
    mkdirSync(method.packageRoot, { recursive: true });

    const harness = await run({
      root,
      template,
      installMethod: method,
      json: false,
      onInstall: () => {
        writeFileSync(
          join(method.packageRoot, "package.json"),
          JSON.stringify({ name: "corpus", version: "0.4.1" }),
          "utf8",
        );
      },
    });
    expect(harness.stdout()).toContain("installed 0.4.1");
    expect(harness.stdout()).toContain(
      "the release was published as 0.4.0 but its package declares",
    );
  });

  it("leaves a stopped server stopped", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const harness = await run({ root, template, serverRunning: false });
    expect(harness.lifecycle).toEqual([]);
    expect(harness.result().server).toMatchObject({ wasRunning: false, restarted: false });
  });

  it("never overwrites an edited file, and reports it as unresolved work", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".claude/skills/comment/SKILL.md", "comment v1\nthe agent's own paragraph\n");
    await commitAll({ dir: root, message: "agent evolved the comment skill" });
    const edited = read(root, ".claude/skills/comment/SKILL.md");

    const harness = await run({
      root,
      template,
      onInstall: () => {
        write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
        write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
      },
    });
    const result = harness.result();

    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe(edited);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict?.path).toBe(".claude/skills/comment/SKILL.md");
    expect(conflict?.detail).toContain("only here");
    expect(conflict?.resolve).toBe("corpus workspace diff .claude/skills/comment/SKILL.md");
    // Distinct from what merely happened: the file that *was* updated is in
    // `template.written`, and the conflict is not.
    expect(result.template?.written).toEqual([".claude/skills/orchestrate/SKILL.md"]);
  });

  it("sets the conflicts apart in the human report too", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".claude/skills/comment/SKILL.md", "edited here\n");
    await commitAll({ dir: root, message: "agent evolved the comment skill" });

    const harness = await run({
      root,
      template,
      json: false,
      onInstall: () => {
        write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
      },
    });
    expect(harness.stdout()).toContain("1 conflict to resolve");
    expect(harness.stdout()).toContain("corpus workspace diff .claude/skills/comment/SKILL.md");
    expect(harness.stdout()).toContain("nothing was overwritten and nothing was merged");
  });

  it("writes the whole report where it can be read after the server restarts", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".claude/skills/comment/SKILL.md", "edited here\n");
    await commitAll({ dir: root, message: "agent evolved the comment skill" });

    const harness = await run({
      root,
      template,
      serverRunning: true,
      onInstall: () => {
        write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
      },
    });
    expect(harness.result().reportPath).toBe(".corpus/upgrade.log");

    const log = readFileSync(upgradeLogPath(root), "utf8");
    expect(log).toContain("corpus upgrade 0.3.0 → 0.4.0");
    expect(log).toContain("installed 0.4.0");
    expect(log).toContain("corpus workspace diff .claude/skills/comment/SKILL.md");
    const last = log.trimEnd().split("\n").at(-1) ?? "";
    const recorded = JSON.parse(last.slice(REPORT_MARKER.length + 1)) as UpgradeResult;
    expect(recorded.conflicts).toHaveLength(1);
    expect(recorded.tool.installed).toBe(true);
    expect(recorded.server).toMatchObject({ wasRunning: true, restarted: true });
  });

  it("touches nothing when the installed version is already the latest", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");

    const harness = await run({ root, template, version: "0.3.0", serverRunning: true });
    const result = harness.result();

    expect(result.tool.installed).toBe(false);
    expect(harness.installs).toEqual([]);
    expect(harness.lifecycle).toEqual([]);
    // The pending template change is *reported*, not applied: the operator asked
    // to upgrade the tool, and there was no tool upgrade to perform.
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");
    expect(result.template?.dryRun).toBe(true);
    expect(result.template?.changes).toHaveLength(1);
  });

  it("upgrades the tool outside a workspace, and says what it skipped", async () => {
    const template = makeTemplate();
    const harness = await run({ root: null, template });
    const result = harness.result();

    expect(result.tool.installed).toBe(true);
    expect(result.workspace).toBeNull();
    expect(result.workspaceDetail).toContain("no template sync and no server restart");
    expect(result.template).toBeNull();
    expect(result.reportPath).toBeNull();
  });
});

describe("corpus upgrade refuses rather than guessing", () => {
  async function refusal(options: RunOptions): Promise<{ code: string; exitCode: number }> {
    const error: unknown = await run(options).catch((cause: unknown) => cause);
    if (!isCliError(error)) throw new Error(`expected a CliError, got ${String(error)}`);
    return { code: error.code, exitCode: error.exitCode };
  }

  it("refuses a release that publishes no checksum, and installs nothing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    expect(await refusal({ root, template, assets: ["corpus-0.4.0.tgz"] })).toEqual({
      code: "upgrade_unverifiable",
      exitCode: ExitCode.refused,
    });
  });

  it("refuses a tarball whose bytes do not match the published checksum", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    expect(await refusal({ root, template, corruptChecksum: true })).toEqual({
      code: "upgrade_checksum_mismatch",
      exitCode: ExitCode.refused,
    });
  });

  it("refuses when it cannot tell how this copy was installed", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    expect(await refusal({ root, template, undetectable: true })).toEqual({
      code: "upgrade_install_method_unknown",
      exitCode: ExitCode.refused,
    });
  });

  it("refuses a full run it could not check", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    expect(await refusal({ root, template, offline: true })).toEqual({
      code: "upgrade_unreachable",
      exitCode: ExitCode.refused,
    });
  });

  it("records the refusal in the report file, which is a detached run's only witness", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    await run({ root, template, assets: ["corpus-0.4.0.tgz"] }).catch(() => undefined);

    const log = readFileSync(upgradeLogPath(root), "utf8");
    expect(log).toContain("failed: release 0.4.0 cannot be verified");
    expect(log).toContain(`${REPORT_MARKER} {"error"`);
  });

  it("refuses an npm prefix it cannot write to, rather than elevating itself", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    expect(
      await refusal({
        root,
        template,
        installMethod: {
          kind: "npm-global",
          packageRoot: "/nonexistent/lib/node_modules/corpus",
          packageName: "corpus",
          prefix: "/nonexistent",
          globalRoot: "/nonexistent/lib/node_modules",
        },
      }),
    ).toEqual({ code: "upgrade_prefix_unwritable", exitCode: ExitCode.refused });
  });

  it("brings the server back when the install itself fails, and does not call that a refusal", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const lifecycle: string[] = [];

    const base = createTestContext({ json: false, cwd: root, version: "0.3.0" });
    const failure: unknown = await runUpgrade(base.context, {
      fetch: await releaseFetch(),
      template: { templateRoot: template },
      installMethod: npmGlobal(),
      npm: () => {
        throw new PartialFailureError("the install command failed", {
          code: "upgrade_install_failed",
          details: { command: "npm install --global …" },
        });
      },
      serverRunning: () => Promise.resolve(true),
      stopServer: () => {
        lifecycle.push("stop");
        return Promise.resolve();
      },
      startServer: () => {
        lifecycle.push("start");
        return Promise.resolve();
      },
    }).catch((cause: unknown) => cause);

    expect(isCliError(failure) && failure.code).toBe("upgrade_install_failed");
    expect(lifecycle).toEqual(["stop", "start"]);
    // No template file was touched: the sync never ran.
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");

    // The honesty CLI-030 is about: this path stopped the server and handed the
    // package to npm, so exit 7's "nothing was changed" would be a lie. The
    // caller gets the fact three ways — exit code, `changed`, and the state of
    // its own board without having to run a second command.
    if (!isCliError(failure)) throw new Error("expected a CliError");
    expect(failure.exitCode).toBe(ExitCode.partialFailure);
    expect(toProblem(failure)).toMatchObject({
      code: "upgrade_install_failed",
      changed: true,
      details: {
        command: "npm install --global …",
        server: { wasRunning: true, stopped: true, restarted: true, detail: null },
      },
    });
  });

  it("reports a stop that failed before npm was ever spawned as itself", async () => {
    // Nothing had changed yet, so laundering it into an 8 would be the same
    // false claim in the other direction.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const installs: string[] = [];

    const base = createTestContext({ json: false, cwd: root, version: "0.3.0" });
    const failure: unknown = await runUpgrade(base.context, {
      fetch: await releaseFetch(),
      template: { templateRoot: template },
      installMethod: npmGlobal(),
      npm: (options) => {
        installs.push(options.tarballPath);
        return Promise.resolve({ command: "npm install --global …", output: "" });
      },
      serverRunning: () => Promise.resolve(true),
      stopServer: () => Promise.reject(new ServerUnreachableError("pid 4711 will not die")),
      startServer: () => Promise.resolve(),
    }).catch((cause: unknown) => cause);

    expect(isCliError(failure) && failure.exitCode).toBe(ExitCode.serverUnreachable);
    expect(isCliError(failure) && failure.changed).toBeUndefined();
    expect(installs).toEqual([]);
  });

  it("does not stop the server for an upgrade it is about to refuse", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const harness = await run({
      root,
      template,
      serverRunning: true,
      assets: ["corpus-0.4.0.tgz"],
    }).catch(() => undefined);
    expect(harness).toBeUndefined();
    // Nothing was written, so nothing had to be restarted.
    expect(existsSync(join(root, ".corpus", "server.pid"))).toBe(false);
  });
});

describe("when the tool moves and the workspace cannot follow", () => {
  it("says so plainly, restarts the server anyway, and still fails", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const lifecycle: string[] = [];

    const base = createTestContext({ json: false, cwd: root, version: "0.3.0" });
    const failure: unknown = await runUpgrade(base.context, {
      fetch: await releaseFetch(),
      // A template root that vanishes with the install is what a half-written
      // package looks like from here.
      template: { templateRoot: join(template, "gone") },
      installMethod: npmGlobal(),
      npm: () => Promise.resolve({ command: "npm install --global …", output: "" }),
      serverRunning: () => Promise.resolve(true),
      stopServer: () => {
        lifecycle.push("stop");
        return Promise.resolve();
      },
      startServer: () => {
        lifecycle.push("start");
        return Promise.resolve();
      },
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(Error);
    expect(base.stdout()).toContain("were NOT updated");
    expect(base.stdout()).toContain("corpus workspace upgrade");
    // The server comes back regardless: a broken sync is a reason to tell
    // somebody, not a reason to leave the board down.
    expect(lifecycle).toEqual(["stop", "start"]);
    const log = readFileSync(upgradeLogPath(root), "utf8");
    expect(log).toContain("were NOT updated");

    // The tool *did* move, so this is a partial failure and not an "unexpected
    // exception" (exit 1 said nothing about the installed version having
    // changed under the caller's feet).
    if (!isCliError(failure)) throw new Error("expected a CliError");
    expect(failure.exitCode).toBe(ExitCode.partialFailure);
    expect(toProblem(failure)).toMatchObject({
      code: "upgrade_template_failed",
      changed: true,
      details: { toolVersion: "0.4.0", server: { stopped: true, restarted: true } },
    });
  });
});

/**
 * The window between "the server is down" and "the server is back" is the one
 * place `corpus upgrade` cannot be interrupted safely, and a `finally` does not
 * run on SIGINT (CLI-030). The target is injected, so nothing here touches the
 * real process's listener table.
 */
describe("when it is interrupted mid-install", () => {
  function fakeSignals(): SignalTarget & { fire: (signal: InterruptSignal) => void } {
    const listeners = new Map<InterruptSignal, Set<() => void>>();
    return {
      on(signal, listener) {
        const set = listeners.get(signal) ?? new Set<() => void>();
        set.add(listener);
        listeners.set(signal, set);
      },
      off(signal, listener) {
        listeners.get(signal)?.delete(listener);
      },
      fire(signal) {
        for (const listener of [...(listeners.get(signal) ?? [])]) listener();
      },
    };
  }

  it.each(INTERRUPT_SIGNALS)(
    "puts the server back and exits 8 rather than dying silently (%s)",
    async (signal) => {
      const template = makeTemplate();
      const root = await makeWorkspace(template);
      const signals = fakeSignals();
      const lifecycle: string[] = [];

      const base = createTestContext({ json: false, cwd: root, version: "0.3.0" });
      const failure: unknown = await runUpgrade(base.context, {
        fetch: await releaseFetch(),
        template: { templateRoot: template },
        installMethod: npmGlobal(),
        signals,
        // A long install, ended by the interrupt exactly as the real npm child
        // is ended by its abort signal.
        npm: (options) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new Error("npm was killed"));
            });
            signals.fire(signal);
          }),
        serverRunning: () => Promise.resolve(true),
        stopServer: () => {
          lifecycle.push("stop");
          return Promise.resolve();
        },
        startServer: () => {
          lifecycle.push("start");
          return Promise.resolve();
        },
      }).catch((cause: unknown) => cause);

      if (!isCliError(failure)) throw new Error(`expected a CliError, got ${String(failure)}`);
      expect(failure.exitCode).toBe(ExitCode.partialFailure);
      expect(toProblem(failure)).toMatchObject({
        code: "upgrade_interrupted",
        changed: true,
        details: { signal, server: { wasRunning: true, stopped: true, restarted: true } },
      });
      // The whole point: the board comes back.
      expect(lifecycle).toEqual(["stop", "start"]);
      expect(base.stdout()).toContain(`${signal} received`);

      // A detached run's only witness records it too.
      const log = readFileSync(upgradeLogPath(root), "utf8");
      expect(log).toContain(`${signal} received`);
      expect(log).toContain(`${REPORT_MARKER} {"error"`);
    },
  );

  it("handles the first interrupt and gets out of the way, so a second one is the operator's", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const signals = fakeSignals();

    const base = createTestContext({ json: false, cwd: root, version: "0.3.0" });
    await runUpgrade(base.context, {
      fetch: await releaseFetch(),
      template: { templateRoot: template },
      installMethod: npmGlobal(),
      signals,
      npm: (options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new Error("npm was killed"));
          });
          signals.fire("SIGINT");
          // In the real process this second one is Node's default and kills
          // corpus; through the injected target it reaches nothing at all,
          // which is the same fact observed from in here.
          signals.fire("SIGINT");
          signals.fire("SIGTERM");
        }),
      serverRunning: () => Promise.resolve(true),
      stopServer: () => Promise.resolve(),
      startServer: () => Promise.resolve(),
    }).catch(() => undefined);

    expect(base.stdout().match(/received — stopping the install/g)).toHaveLength(1);
  });

  it("does not fail a run whose install had already finished when the signal arrived", async () => {
    // The opposite lie: an upgrade that completed is not a partial failure, and
    // reporting one would send an agent chasing an undo that never happened.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const signals = fakeSignals();

    const base = createTestContext({ json: false, cwd: root, version: "0.3.0" });
    await runUpgrade(base.context, {
      fetch: await releaseFetch(),
      template: { templateRoot: template },
      installMethod: npmGlobal(),
      signals,
      npm: () => {
        // Delivered just as npm returns: too late to stop anything.
        signals.fire("SIGINT");
        write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
        return Promise.resolve({ command: "npm install --global …", output: "" });
      },
      serverRunning: () => Promise.resolve(true),
      stopServer: () => Promise.resolve(),
      startServer: () => Promise.resolve(),
    });

    expect(base.stdout()).toContain("arrived after the install finished");
    // It really did finish: the new tool's file was synced into the workspace.
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v2\n");
    expect(readFileSync(upgradeLogPath(root), "utf8")).toContain(`${REPORT_MARKER} {"mode"`);
  });
});

/**
 * SPEC.md §2.4 rider 8 (signed 2026-08-22), CLI-061. `corpus upgrade` hoists the
 * migrations out of the nested template report for the same reason it hoists the
 * conflicts: an agent must be able to see what it still owes without walking
 * into a sub-object. The detector's own cases are in `src/migrations/`.
 */
describe("corpus upgrade reports the data migrations a workspace needs", () => {
  /** A workspace written before Phase 41: a pinned view, and no board document. */
  function seedPrePhase41(root: string): void {
    write(
      root,
      "data/docs/views/attention.md",
      "---\nid: doc_seedattention\ntype: view\ntitle: Attention\npinned: true\norder: 1\n---\n",
    );
  }

  it("names the migration after a full upgrade, and performs none of it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);
    const before = read(root, "data/docs/views/attention.md");

    const result = (await run({ root, template })).result();

    expect(result.migrations).toHaveLength(1);
    const [migration] = result.migrations;
    expect(migration?.id).toBe("views-to-board");
    expect(migration?.statement).toContain("no longer read");
    expect(migration?.commands).toEqual([
      'corpus doc create --type board --title "Board" --folder boards ' +
        "--columns doc_seedattention --default-open true",
      "corpus doc edit doc_seedattention --unset pinned --unset order",
    ]);
    expect(migration?.optional).toEqual([]);
    expect(read(root, "data/docs/views/attention.md")).toBe(before);
    expect(existsSync(join(root, "data", "docs", "boards"))).toBe(false);
  });

  it("does not fail the run: a migration is the agent's work, not the upgrade's", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    // Reaching `result()` at all means `runUpgrade` returned rather than throwing.
    const result = (await run({ root, template })).result();
    expect(result.tool.installed).toBe(true);
    expect(result.migrations).toHaveLength(1);
  });

  it("reports it under --check too, against the tool installed now", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    const result = (await run({ root, template, flags: { check: true } })).result();
    expect(result.migrations.map((migration) => migration.id)).toEqual(["views-to-board"]);
  });

  it("reports it when the tool is already the latest release", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    const result = (await run({ root, template, version: "0.3.0" })).result();
    expect(result.tool.installed).toBe(false);
    expect(result.migrations.map((migration) => migration.id)).toEqual(["views-to-board"]);
  });

  it("prints the block and writes it into the report file", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    const harness = await run({ root, template, json: false });

    expect(harness.stdout()).toContain("1 data migration");
    expect(harness.stdout()).toContain(
      "corpus doc edit doc_seedattention --unset pinned --unset order",
    );
    // The report file is a detached run's only witness (§2.4), so it carries the
    // migrations exactly as stdout did.
    const log = read(root, ".corpus/upgrade.log");
    expect(log).toContain("views-to-board:");
    expect(log).toContain("corpus doc edit doc_seedattention --unset pinned --unset order");
  });

  it("looks under the workspace's own dataDir, on every path that reports", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const config = JSON.parse(read(root, ".corpus/config.json")) as Record<string, unknown>;
    write(root, ".corpus/config.json", JSON.stringify({ ...config, dataDir: "corpus-data" }));
    write(
      root,
      "corpus-data/docs/views/attention.md",
      "---\nid: doc_relocated\ntype: view\ntitle: Attention\npinned: true\n---\n",
    );

    const ids = (result: UpgradeResult): readonly string[] =>
      result.migrations.flatMap((migration) => migration.commands);

    // The install path, the `--check` path and the already-current path each
    // build the sync request themselves, so each is asked separately.
    expect(ids((await run({ root, template })).result())).toContain(
      "corpus doc edit doc_relocated --unset pinned --unset order",
    );
    expect(ids((await run({ root, template, flags: { check: true } })).result())).toContain(
      "corpus doc edit doc_relocated --unset pinned --unset order",
    );
    expect(ids((await run({ root, template, version: "0.3.0" })).result())).toContain(
      "corpus doc edit doc_relocated --unset pinned --unset order",
    );
  });

  it("says the section is empty when nothing fires", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    const harness = await run({ root, template, json: false });
    expect(harness.stdout()).toContain("migrations: none");
    expect(
      (await run({ root: await makeWorkspace(template), template })).result().migrations,
    ).toEqual([]);
  });

  it("claims nothing about migrations when it ran outside a workspace", async () => {
    const template = makeTemplate();
    // No workspace means no files were read, and "none" would be a claim about
    // documents nothing looked at.
    const harness = await run({ root: null, template, json: false });
    expect(harness.stdout()).not.toContain("migrations:");
    expect((await run({ root: null, template })).result().migrations).toEqual([]);
  });
});

describe("the registry entry", () => {
  it("declares a valid command", () => {
    expect(
      collectRegistryProblems({ summary: "test", commands: [upgradeCommand], topics: [] }),
    ).toEqual([]);
  });

  it("runs without a workspace, because the tool is installed once per machine", () => {
    expect(upgradeCommand.requiresWorkspace).toBe(false);
  });
});
