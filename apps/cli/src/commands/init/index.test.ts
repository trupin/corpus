import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, UsageError } from "../../errors.js";
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
  readonly workspace?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly force?: boolean;
  readonly port?: number;
  readonly json?: boolean;
  readonly dependencies?: InitDependencies;
}

async function init(options: RunOptions): Promise<InitReport> {
  const harness = createTestContext({
    cwd: options.cwd,
    ...(options.path === undefined ? {} : { args: { path: options.path } }),
    flags: {
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
      ...(options.force === undefined ? {} : { force: options.force }),
    },
    ...(options.env === undefined ? {} : { env: options.env }),
    version: "9.9.9",
  });
  return runInit(harness.context, options.dependencies ?? {});
}

async function initWithFreePort(
  cwd: string,
  path?: string,
  extra: Omit<RunOptions, "cwd" | "path" | "port"> = {},
): Promise<InitReport> {
  return init({
    cwd,
    ...(path === undefined ? {} : { path }),
    ...extra,
    port: await ephemeralPort(),
  });
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
    expect(corpusFiles.sort()).toEqual(
      [
        // One `.gitkeep` per status the contract declares — `deferred` included
        // (CONTRACT-021). Derived rather than listed, so the day the enum grows
        // this asserts the new directory instead of ignoring it.
        ...QUEUE_EVENT_STATUSES.map((status) => `.corpus/queue/${status}/.gitkeep`),
        // Install provenance, not runtime state: the template un-ignores it, and
        // `scaffoldWorkspace` writes it before the first commit stages the tree.
        ".corpus/template-manifest.json",
      ].sort(),
    );

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

    for (const status of QUEUE_EVENT_STATUSES) {
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

  /**
   * The reuse-not-reinitialize branch is real behaviour and stays covered, but
   * the directory it runs in — a non-empty git repository — is exactly what
   * CLI-013 makes init refuse. So it is `--force` now, with the refusal pinned
   * by its sibling below (sprint-015 Open Conflict 2: rewrite, never delete).
   */
  async function makeRepoWithCommit(label: string): Promise<string> {
    const root = makeTempDir(label);
    await runGit(["init", "-b", "trunk"], root);
    writeFileSync(join(root, "notes.txt"), "one");
    await runGit(["add", "--all", "--", "."], root);
    await runGit(["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-m", "first"], root);
    return root;
  }

  it("reuses an existing repository instead of re-initializing it, under --force", async () => {
    const root = await makeRepoWithCommit("init-existing-repo");

    const report = await initWithFreePort(root, undefined, { force: true });
    expect(report.repository).toBe("reused");
    expect((await log(root, "%s")).split("\n")).toHaveLength(2);
    expect((await runGit(["rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim()).toBe("trunk");
  });

  it("refuses that same repository without --force, touching nothing", async () => {
    const root = await makeRepoWithCommit("init-existing-repo-refused");
    const before = readdirSync(root).sort();
    const head = await log(root, "%H");

    await expect(initWithFreePort(root)).rejects.toThrow(/refusing to initialize/);

    expect(readdirSync(root).sort()).toEqual(before);
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("one");
    expect(await log(root, "%H")).toBe(head);
    expect(existsSync(join(root, ".corpus"))).toBe(false);
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

  /**
   * CLI-037. Every `git commit` since git 2.29 ends by spawning a detached
   * `git maintenance run --auto`, which repacks the object store at a moment of
   * its own choosing — measured on git 2.54 racing the server's commits into a
   * permanently corrupt repository. A workspace must not be created in that
   * configuration, and the settings must be in place *before* the very first
   * commit, which is itself a commit that would spawn one.
   */
  it("creates a repository git will not maintain behind our back", async () => {
    const root = makeTempDir("init-maintenance");
    const report = await initWithFreePort(root);

    expect(report.maintenanceSettings).toEqual(["maintenance.auto", "gc.auto"]);
    expect((await runGit(["config", "--local", "--get", "maintenance.auto"], root)).stdout.trim())
      // The one that is the fix: it short-circuits the dispatcher, so no child
      // is spawned at all.
      .toBe("false");
    expect((await runGit(["config", "--local", "--get", "gc.auto"], root)).stdout.trim()).toBe("0");
  });

  it("configures a repository it reused under --force too", async () => {
    const root = await makeRepoWithCommit("init-existing-repo-maintenance");

    const report = await initWithFreePort(root, undefined, { force: true });

    expect(report.repository).toBe("reused");
    expect(report.maintenanceSettings).toEqual(["maintenance.auto", "gc.auto"]);
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

/**
 * CLI-013. `--workspace` was parsed into init's flag set by `mergedFlags` and
 * then discarded, so naming a target scaffolded the *current* directory instead
 * — destructive three times, once inside this repository. Precedence is
 * `positional ?? --workspace ?? CORPUS_WORKSPACE ?? cwd`.
 */
describe("corpus init — where it initializes", () => {
  it("honours --workspace when no positional is given, leaving the cwd untouched", async () => {
    const cwd = makeTempDir("target-cwd");
    const named = makeTempDir("target-named");

    const report = await initWithFreePort(cwd, undefined, { workspace: named });

    expect(report.workspace).toBe(named);
    expect(existsSync(join(named, ".corpus", "config.json"))).toBe(true);
    expect(existsSync(join(named, "data", "docs"))).toBe(true);
    expect(existsSync(join(named, "data", "threads"))).toBe(true);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("honours CORPUS_WORKSPACE, the same chain every other command resolves", async () => {
    const cwd = makeTempDir("env-cwd");
    const named = makeTempDir("env-named");

    const report = await initWithFreePort(cwd, undefined, { env: { CORPUS_WORKSPACE: named } });

    expect(report.workspace).toBe(named);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("lets --workspace win over CORPUS_WORKSPACE", async () => {
    const cwd = makeTempDir("both-cwd");
    const flagTarget = makeTempDir("both-flag");
    const envTarget = makeTempDir("both-env");

    const report = await initWithFreePort(cwd, undefined, {
      workspace: flagTarget,
      env: { CORPUS_WORKSPACE: envTarget },
    });

    expect(report.workspace).toBe(flagTarget);
    expect(readdirSync(envTarget)).toEqual([]);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("lets the positional win over a disagreeing --workspace, and says so", async () => {
    const cwd = makeTempDir("conflict-cwd");
    const positional = makeTempDir("conflict-positional");
    const flagTarget = makeTempDir("conflict-flag");

    const report = await initWithFreePort(cwd, positional, { workspace: flagTarget });

    expect(report.workspace).toBe(positional);
    // Documented precedence, never a silent pick: the loser is named.
    expect(report.warnings.some((warning) => warning.includes(flagTarget))).toBe(true);
    expect(readdirSync(flagTarget)).toEqual([]);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("does not warn when the positional and --workspace name the same directory", async () => {
    const cwd = makeTempDir("agree-cwd");
    const target = makeTempDir("agree-target");

    const report = await initWithFreePort(cwd, target, { workspace: target });

    expect(report.workspace).toBe(target);
    expect(report.warnings).toEqual([]);
  });

  it("still defaults to the cwd when nothing names a target", async () => {
    const cwd = makeTempDir("default-cwd");
    const report = await initWithFreePort(cwd);
    expect(report.workspace).toBe(cwd);
  });
});

/**
 * CLI-013's guard. Every case here asserts the target is *byte-identical*
 * afterwards, because `CreatedPaths.unwind()` cannot restore an overwritten
 * file — refusing before the first write is the only shape that holds.
 */
describe("corpus init — refusing somebody else's directory", () => {
  function listing(root: string): readonly string[] {
    return readdirSync(root).sort();
  }

  it("refuses a directory holding unrelated files, naming what it found", async () => {
    const root = makeTempDir("guard-files");
    writeFileSync(join(root, "notes.txt"), "mine");
    writeFileSync(join(root, "todo.md"), "mine too");

    const error = await initWithFreePort(root).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(ExitCode.usageError);
    expect((error as UsageError).code).toBe("usage_error");
    expect((error as UsageError).message).toContain("2 entries");
    expect((error as UsageError).message).toContain("notes.txt");
    expect((error as UsageError).message).toContain("todo.md");
    expect((error as UsageError).hint).toContain("--force");

    expect(listing(root)).toEqual(["notes.txt", "todo.md"]);
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("mine");
  });

  it("names a git repository as its own kind of evidence", async () => {
    const root = makeTempDir("guard-repo");
    await runGit(["init", "-b", "main"], root);

    await expect(initWithFreePort(root)).rejects.toThrow(/it is a git repository/);
    expect(listing(root)).toEqual([".git"]);
  });

  it("catches a linked worktree, whose .git is a file rather than a directory", async () => {
    const origin = makeTempDir("guard-worktree-origin");
    await runGit(["init", "-b", "main"], origin);
    writeFileSync(join(origin, "seed.txt"), "seed");
    await runGit(["add", "--all", "--", "."], origin);
    await runGit(["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-m", "seed"], origin);
    const worktree = join(makeTempDir("guard-worktree"), "linked");
    await runGit(["worktree", "add", "-b", "side", worktree], origin);
    expect(statSync(join(worktree, ".git")).isDirectory()).toBe(false);

    await expect(initWithFreePort(worktree)).rejects.toThrow(/linked git worktree/);
    expect(existsSync(join(worktree, ".corpus"))).toBe(false);
  });

  it("refuses an EMPTY directory inside a repository, naming the enclosing repository", async () => {
    const repo = makeTempDir("guard-enclosing");
    await runGit(["init", "-b", "main"], repo);
    const inner = join(repo, "sub");
    mkdirSync(inner);

    // The one case a non-empty check alone would miss: initializing here would
    // create a nested repository inside somebody else's checkout.
    await expect(initWithFreePort(inner)).rejects.toThrow(
      new RegExp(`sits inside the git repository at ${repo}`),
    );
    expect(listing(inner)).toEqual([]);
  });

  it("refuses a target that does not exist yet inside a repository", async () => {
    const repo = makeTempDir("guard-enclosing-missing");
    await runGit(["init", "-b", "main"], repo);

    await expect(initWithFreePort(repo, "not/created/yet")).rejects.toThrow(
      /sits inside the git repository/,
    );
    expect(existsSync(join(repo, "not"))).toBe(false);
  });

  it("refuses before the first write — git is never even probed", async () => {
    const root = makeTempDir("guard-ordering");
    writeFileSync(join(root, "notes.txt"), "mine");
    const invocations: string[][] = [];
    // Any write is preceded by `requireGit`, which is preceded by
    // `created.mkdir(target)`'s guard. A runner that records every call proves
    // the refusal happened before the first of the three.
    const recordingGit = (args: readonly string[]) => {
      invocations.push([...args]);
      return Promise.reject(new Error("git must not run: the guard should have refused already"));
    };

    await expect(
      init({ cwd: root, port: await ephemeralPort(), dependencies: { git: recordingGit } }),
    ).rejects.toBeInstanceOf(UsageError);

    expect(invocations).toEqual([]);
    expect(listing(root)).toEqual(["notes.txt"]);
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("mine");
  });

  it("proceeds under --force and reports both the evidence and what it overwrote", async () => {
    const root = makeTempDir("guard-force");
    writeFileSync(join(root, "README.md"), "years of my notes");
    writeFileSync(join(root, "notes.txt"), "mine");

    const report = await initWithFreePort(root, undefined, { force: true });

    expect(report.workspace).toBe(root);
    expect(report.warnings.some((w) => w.startsWith("--force:"))).toBe(true);
    const overwrote = report.warnings.find((w) => w.includes("overwrote"));
    expect(overwrote).toContain("README.md");
    expect(overwrote).toContain("cannot be restored");
    // …and the files it did not install are still the operator's.
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("mine");
    expect(existsSync(join(root, ".corpus", "config.json"))).toBe(true);
  });

  it("--force does not override the refusal to touch an existing workspace", async () => {
    const root = makeTempDir("force-vs-workspace");
    await initWithFreePort(root);
    const config = readFileSync(join(root, ".corpus", "config.json"), "utf8");

    await expect(initWithFreePort(root, undefined, { force: true })).rejects.toThrow(
      /already a Corpus workspace/,
    );

    expect(readFileSync(join(root, ".corpus", "config.json"), "utf8")).toBe(config);
    expect((await log(root, "%h")).split("\n")).toHaveLength(1);
  });

  it("--force does not override a directory that already holds documents", async () => {
    const root = makeTempDir("force-vs-docs");
    mkdirSync(join(root, "data", "docs"), { recursive: true });
    writeFileSync(join(root, "data", "docs", "note.md"), "mine");

    await expect(initWithFreePort(root, undefined, { force: true })).rejects.toThrow(
      /already a Corpus workspace/,
    );
    expect(readFileSync(join(root, "data", "docs", "note.md"), "utf8")).toBe("mine");
    expect(existsSync(join(root, ".corpus"))).toBe(false);
  });

  it("still only warns when nesting inside an existing workspace (Adjudication 8)", async () => {
    const outer = makeTempDir("nested-workspace");
    await initWithFreePort(outer);

    // The outer workspace is a git repository, so the enclosing-repository
    // evidence would fire here if it were not deliberately suppressed for a
    // Corpus workspace: nesting is confusing, not destructive.
    const report = await initWithFreePort(outer, "sub/inner");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("nearest ancestor wins");
  });
});
