import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Health } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import type { CliClient } from "../../client.js";
import { ExitCode, ServerUnreachableError, exitCodeFor, isCliError } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import type { Workspace } from "../../workspace.js";
import { commitAll, initRepository } from "../init/git.js";
import { writePidfile } from "../server/daemon.js";
import { workspaceTopic } from "./index.js";
import {
  maintainCommand,
  renderMaintainReport,
  runWorkspaceMaintain,
  toReport,
} from "./maintain.js";
import { readRepositoryObjects } from "./maintenance.js";

/**
 * The verb, over a real repository. Its two jobs are to *refuse* while the sole
 * writer is up and to report the object store honestly; both are only testable
 * against a repository that has one.
 */

const execFileAsync = promisify(execFile);
const PREFIX = "corpus-cli037-verb-";
const scratch: string[] = [];
const PORT = 9137;

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = async (repo: string, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd: repo, encoding: "utf8" });
  return stdout;
};

async function makeWorkspace(commits = 1): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), PREFIX));
  scratch.push(root);
  mkdirSync(join(root, ".corpus"), { recursive: true });
  writeFileSync(join(root, "seed.md"), "seed\n", "utf8");
  await initRepository(root);
  for (let i = 0; i < commits; i++) {
    writeFileSync(join(root, `note-${String(i)}.md`), `note ${String(i)}\n`, "utf8");
    await commitAll({ dir: root, message: `note ${String(i)}` });
  }
  return root;
}

function workspaceAt(root: string): Workspace {
  return {
    root,
    configPath: join(root, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: PORT,
    token: "t",
    dataDir: "data",
    baseUrl: `http://127.0.0.1:${String(PORT)}`,
  };
}

/** A client that answers health as this workspace's server, or not at all. */
function client(health: Health | undefined): CliClient {
  return {
    baseUrl: `http://127.0.0.1:${String(PORT)}`,
    api: undefined as never,
    untimedApi: undefined as never,
    request: <T>() =>
      health === undefined
        ? Promise.reject(new ServerUnreachableError("nothing there"))
        : Promise.resolve(health as T),
  };
}

interface Harness {
  readonly context: WorkspaceCommandContext;
  stdout(): string;
}

function harnessFor(
  root: string,
  options: {
    readonly flags?: Record<string, boolean>;
    readonly json?: boolean;
    readonly health?: Health;
  } = {},
): Harness {
  const base = createTestContext({
    flags: options.flags ?? {},
    ...(options.json === undefined ? {} : { json: options.json }),
  });
  return {
    stdout: () => base.stdout(),
    context: {
      ...base.context,
      workspace: workspaceAt(root),
      client: client(options.health),
      actor: "user",
    },
  };
}

describe("corpus workspace maintain", () => {
  it("refuses while this workspace's server is running, and changes nothing", async () => {
    const root = await makeWorkspace();
    writePidfile(serverPidfilePath(root), {
      pid: process.pid,
      port: PORT,
      startedAt: new Date().toISOString(),
      version: "1.0.0",
    });
    const before = await readRepositoryObjects(root);

    const harness = harnessFor(root, {
      health: { status: "ok", version: "1.0.0", uptimeSeconds: 1, workspace: root },
      flags: { force: true },
    });
    const error = await runWorkspaceMaintain(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.refused);
    expect(isCliError(error) && error.changed).toBe(false);
    expect(String(error)).toContain("only writer");
    // Nothing was configured and nothing was packed: the settings are still absent.
    await expect(git(root, "config", "--local", "--get", "maintenance.auto")).rejects.toThrow();
    expect(await readRepositoryObjects(root)).toEqual(before);
  });

  it("runs when the server is stopped, applying the settings and reporting the store", async () => {
    const root = await makeWorkspace(3);

    const harness = harnessFor(root);
    await runWorkspaceMaintain(harness.context);

    expect((await git(root, "config", "--local", "--get", "maintenance.auto")).trim()).toBe(
      "false",
    );
    const out = harness.stdout();
    expect(out).toContain("loose objects");
    expect(out).toContain("packs at");
    expect(out).toContain("nothing to pack yet");
  });

  it("packs on --force and says what it packed", async () => {
    const root = await makeWorkspace(3);

    const harness = harnessFor(root, { flags: { force: true } });
    await runWorkspaceMaintain(harness.context);

    expect(harness.stdout()).toContain("git: packed");
    expect((await readRepositoryObjects(root)).packs).toBe(1);
  });

  it("packs nothing under --settings-only", async () => {
    const root = await makeWorkspace(3);

    const harness = harnessFor(root, { flags: { "settings-only": true } });
    await runWorkspaceMaintain(harness.context);

    expect((await readRepositoryObjects(root)).packs).toBe(0);
    expect((await git(root, "config", "--local", "--get", "gc.auto")).trim()).toBe("0");
  });

  it("emits one machine-readable value carrying both sides of the run", async () => {
    const root = await makeWorkspace(3);

    const harness = harnessFor(root, { json: true, flags: { force: true } });
    await runWorkspaceMaintain(harness.context);

    const report = JSON.parse(harness.stdout()) as Record<string, unknown>;
    expect(report).toMatchObject({ workspace: root, packed: true, threshold: 6700, due: false });
    expect(report["settings"]).toEqual(["maintenance.auto", "gc.auto"]);
    expect(report["after"]).toMatchObject({ loose: 0, packs: 1 });
  });

  it("reports a stale pidfile as stopped rather than refusing forever", async () => {
    const root = await makeWorkspace();
    // A pid that cannot be alive: `kill -9` leaves exactly this behind, and a
    // workspace must not become unmaintainable because of it.
    writePidfile(serverPidfilePath(root), {
      pid: 0x7fffffff,
      port: PORT,
      startedAt: new Date().toISOString(),
      version: "1.0.0",
    });

    await runWorkspaceMaintain(harnessFor(root).context);

    expect((await git(root, "config", "--local", "--get", "maintenance.auto")).trim()).toBe(
      "false",
    );
  });
});

describe("the maintain report", () => {
  it("shows the state after packing, not the state that provoked it", () => {
    const lines = renderMaintainReport(
      toReport("/ws", {
        settings: [],
        before: { loose: 7001, packed: 0, packs: 0 },
        after: { loose: 0, packed: 7001, packs: 1 },
        packed: true,
        threshold: 6700,
      }),
    );

    expect(lines[0]?.trim()).toBe("loose objects   0");
    expect(lines.join("\n")).toContain("git: packed 7001 loose objects");
  });

  it("explains a run that was due but told not to pack", () => {
    const lines = renderMaintainReport(
      toReport("/ws", {
        settings: [],
        before: { loose: 7001, packed: 0, packs: 0 },
        after: null,
        packed: false,
        threshold: 6700,
      }),
    );

    expect(lines.join("\n")).toContain("--settings-only");
  });
});

describe("the maintain command spec", () => {
  it("is a valid registry command reachable as `corpus workspace maintain`", () => {
    expect(
      collectRegistryProblems({ summary: "s", commands: [], topics: [workspaceTopic] }),
    ).toEqual([]);
    expect(workspaceTopic.commands).toContain(maintainCommand);
  });

  it("says why git's own maintenance is off, not merely that it is", () => {
    expect(maintainCommand.description).toContain("git 2.29");
    expect(maintainCommand.description).toContain("sole writer");
    expect(maintainCommand.description).toContain("§4");
  });

  it("offers no flag that overrides the refusal to run beside a live server", () => {
    expect(maintainCommand.flags.map((flag) => flag.name)).toEqual(["force", "settings-only"]);
    expect(maintainCommand.description).toContain("no flag to override");
  });
});
