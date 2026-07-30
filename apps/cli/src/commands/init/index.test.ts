import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../../errors.js";
import { createTestContext } from "../../registry/fixtures.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { ephemeralPort, makeTempDir, removeTempDirs, withListener } from "../../testing/temp.js";
import { readWorkspaceConfig } from "../../workspace.js";
import { runGit, USER_IDENTITY } from "./git.js";
import { initCommand, runInit, type InitDependencies, type InitReport } from "./index.js";

/**
 * `corpus init` against real directories, a real `git`, and the real bundled
 * template — the whole point of the command is what ends up on disk, and a
 * mocked filesystem would test the mock.
 */

afterEach(removeTempDirs);

interface RunOptions {
  readonly cwd: string;
  readonly path?: string;
  readonly port?: number;
  readonly json?: boolean;
  readonly dependencies?: InitDependencies;
}

async function init(options: RunOptions): Promise<InitReport> {
  const harness = createTestContext({
    cwd: options.cwd,
    ...(options.path === undefined ? {} : { args: { path: options.path } }),
    ...(options.port === undefined ? {} : { flags: { port: options.port } }),
    version: "9.9.9",
  });
  return runInit(harness.context, options.dependencies ?? {});
}

async function initWithFreePort(cwd: string, path?: string): Promise<InitReport> {
  return init({ cwd, ...(path === undefined ? {} : { path }), port: await ephemeralPort() });
}

async function log(root: string, format: string): Promise<string> {
  const { stdout } = await runGit(["log", `--format=${format}`], root);
  return stdout.trim();
}

describe("corpus init", () => {
  it("creates the §4 tree, the config, the template and one commit", async () => {
    const root = makeTempDir("init");
    const port = await ephemeralPort();
    const report = await init({ cwd: root, port });

    expect(report).toMatchObject({ workspace: root, port, repository: "initialized" });

    const config = readWorkspaceConfig(join(root, ".corpus", "config.json"));
    expect(config.port).toBe(port);
    expect(config.token).toHaveLength(43);

    expect(existsSync(join(root, ".claude", "skills", "comment", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".corpus", "queue", "pending", ".gitkeep"))).toBe(true);
    expect(existsSync(join(root, ".corpus", "template-manifest.json"))).toBe(true);

    expect(await log(root, "%an <%ae>|%s")).toBe(
      `${USER_IDENTITY.name} <${USER_IDENTITY.email}>|workspace: initialize corpus workspace by user`,
    );
    expect((await runGit(["rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim()).toBe("main");
  });

  it("tracks the queue skeleton and the install manifest, and nothing else under .corpus", async () => {
    const root = makeTempDir("init-tracked");
    await initWithFreePort(root);

    const { stdout: tracked } = await runGit(["ls-files"], root);
    const corpusFiles = tracked.split("\n").filter((path) => path.startsWith(".corpus"));
    expect(corpusFiles.sort()).toEqual([
      ".corpus/queue/abandoned/.gitkeep",
      ".corpus/queue/failed/.gitkeep",
      ".corpus/queue/in-progress/.gitkeep",
      ".corpus/queue/pending/.gitkeep",
      ".corpus/queue/processed/.gitkeep",
      // Install provenance, not runtime state: the template un-ignores it, and
      // `scaffoldWorkspace` writes it before the first commit stages the tree.
      ".corpus/template-manifest.json",
    ]);

    // The template's own .gitignore is what does this — init never writes one.
    for (const runtime of [
      ".corpus/config.json",
      ".corpus/cache.db",
      ".corpus/server.pid",
      ".corpus/server.log",
    ]) {
      const { stdout } = await runGit(["check-ignore", runtime], root);
      expect(stdout.trim()).toBe(runtime);
    }

    const { stdout: status } = await runGit(["status", "--porcelain"], root);
    expect(status.trim()).toBe("");
  });

  it("leaves a clone with the queue skeleton intact", async () => {
    const root = makeTempDir("init-clone");
    await initWithFreePort(root);
    const clone = join(makeTempDir("init-clone-target"), "clone");
    await runGit(["clone", root, clone], root);

    for (const status of ["pending", "in-progress", "processed", "failed", "abandoned"]) {
      expect(existsSync(join(clone, ".corpus", "queue", status))).toBe(true);
    }
  });

  it("gives two workspaces different tokens and different ports", async () => {
    const a = makeTempDir("init-a");
    const b = makeTempDir("init-b");
    const reportA = await initWithFreePort(a);
    const reportB = await initWithFreePort(b);

    expect(reportA.port).not.toBe(reportB.port);
    expect(readWorkspaceConfig(reportA.configPath).token).not.toBe(
      readWorkspaceConfig(reportB.configPath).token,
    );
  });

  it("creates a target that does not exist yet", async () => {
    const parent = makeTempDir("init-parent");
    const report = await initWithFreePort(parent, "notes/inner");
    expect(report.workspace).toBe(join(parent, "notes", "inner"));
    expect(existsSync(join(parent, "notes", "inner", "data", "docs"))).toBe(true);
  });

  it("refuses a target that is a file", async () => {
    const parent = makeTempDir("init-file");
    writeFileSync(join(parent, "notes"), "not a directory");
    await expect(init({ cwd: parent, path: "notes" })).rejects.toBeInstanceOf(UsageError);
  });

  it("refuses to clobber a workspace, changing nothing", async () => {
    const root = makeTempDir("init-clobber");
    await initWithFreePort(root);
    const before = readFileSync(join(root, ".corpus", "config.json"), "utf8");

    await expect(initWithFreePort(root)).rejects.toThrow(/already a Corpus workspace/);

    expect(readFileSync(join(root, ".corpus", "config.json"), "utf8")).toBe(before);
    expect((await log(root, "%h")).split("\n")).toHaveLength(1);
  });

  it("refuses a directory that already holds documents", async () => {
    const root = makeTempDir("init-has-docs");
    mkdirSync(join(root, "data", "docs"), { recursive: true });
    writeFileSync(join(root, "data", "docs", "note.md"), "mine");
    await expect(initWithFreePort(root)).rejects.toThrow(/already a Corpus workspace/);
  });

  it("reuses an existing repository instead of re-initializing it", async () => {
    const root = makeTempDir("init-existing-repo");
    await runGit(["init", "-b", "trunk"], root);
    writeFileSync(join(root, "notes.txt"), "one");
    await runGit(["add", "--all", "--", "."], root);
    await runGit(["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-m", "first"], root);

    const report = await initWithFreePort(root);
    expect(report.repository).toBe("reused");
    expect((await log(root, "%s")).split("\n")).toHaveLength(2);
    expect((await runGit(["rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim()).toBe("trunk");
  });

  it("fails before creating anything when git is missing", async () => {
    const root = makeTempDir("init-no-git");
    await expect(
      init({
        cwd: root,
        dependencies: { git: () => Promise.reject(new Error("spawn git ENOENT")) },
      }),
    ).rejects.toThrow(/`git` was not found on PATH/);
    expect(readdirSync(root)).toEqual([]);
  });

  it("fails loudly on an occupied --port, leaving the target empty", async () => {
    const root = makeTempDir("init-port-taken");
    const port = await ephemeralPort();
    await withListener(port, async () => {
      await expect(init({ cwd: root, port })).rejects.toThrow(/already in use/);
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it("unwinds everything it created when the commit fails", async () => {
    const root = makeTempDir("init-unwind");
    const failing = (args: readonly string[], cwd: string) =>
      args.includes("commit")
        ? Promise.reject(Object.assign(new Error("git failed"), { stderr: "fatal: hook refused" }))
        : runGit(args, cwd);

    await expect(
      init({ cwd: root, port: await ephemeralPort(), dependencies: { git: failing } }),
    ).rejects.toThrow(/initial commit failed: fatal: hook refused/);

    expect(readdirSync(root)).toEqual([]);
    // …and the directory is usable again with no manual cleanup.
    await expect(initWithFreePort(root)).resolves.toMatchObject({ repository: "initialized" });
  });

  it("warns when the new workspace nests inside an existing one", async () => {
    const outer = makeTempDir("init-outer");
    await initWithFreePort(outer);
    const report = await initWithFreePort(outer, "sub/inner");

    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain(outer);
    expect(report.warnings[0]).toContain("nearest ancestor wins");
  });

  it("never prints the token", async () => {
    const root = makeTempDir("init-json");
    const harness = createTestContext({
      cwd: root,
      flags: { port: await ephemeralPort() },
      json: true,
    });
    await initCommand.handler(harness.context);

    const token = readWorkspaceConfig(join(root, ".corpus", "config.json")).token;
    expect(harness.stdout()).not.toContain(token);
    expect(JSON.parse(harness.stdout())).toMatchObject({ workspace: root });
  });

  it("is a valid registry entry that runs without a workspace", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [initCommand], topics: [] })).toEqual(
      [],
    );
    expect(initCommand.requiresWorkspace).toBe(false);
  });

  it("prints a human summary naming the port and what happened to the repository", async () => {
    const root = makeTempDir("init-human");
    const harness = createTestContext({ cwd: root, flags: { port: await ephemeralPort() } });
    await initCommand.handler(harness.context);

    expect(harness.stdout()).toContain(`Initialized Corpus workspace at ${root}`);
    expect(harness.stdout()).toContain("git: initialized on main");
    expect(harness.stdout()).toContain("Next: corpus server start");
    // Success is quiet on stderr: nothing warns, nothing leaks git's chatter.
    expect(harness.stderr()).toBe("");
  });
});
