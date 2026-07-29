import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../client.js";
import { templateManifestPath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { workspaceOn } from "../../testing/stub-server.js";
import { readTemplateManifest } from "../../template/manifest.js";
import { generateToken, scaffoldWorkspace } from "../init/scaffold.js";
import { commitAll, initRepository } from "../init/git.js";
import { workspaceTopic } from "./index.js";
import { runWorkspaceUpgrade, upgradeCommand, type UpgradeReport } from "./upgrade.js";

/**
 * Real directories and a real git repository throughout. The decision matrix is
 * exhausted as a pure function in `template/plan.test.ts`; what is worth testing
 * here is the half that can only be wrong on disk — which bytes moved, which
 * did not, and what the one commit contains.
 *
 * The tool's own trees are scratch directories injected through the verb's
 * dependencies seam, and a "tool upgrade" is simulated by editing one of them
 * between runs — which is exactly what an `npm update` does to the installed
 * package.
 */

const execFileAsync = promisify(execFile);
const PREFIX = "corpus-s013-cli005-";
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${PREFIX}${label}-`));
  scratch.push(dir);
  return dir;
}

const git = async (repo: string, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd: repo, encoding: "utf8" });
  return stdout;
};

function write(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

function read(root: string, relative: string): string {
  return readFileSync(join(root, ...relative.split("/")), "utf8");
}

/**
 * A template tree in the tool's own shape (dotless `claude/`, `gitignore`). Its
 * ignore rules mirror the shipped template's: all of `.corpus/` is runtime state
 * except the install manifest, which is provenance and is tracked. A test that
 * needs the other branch of `isIgnored` overrides this file itself.
 */
function makeTemplate(): string {
  const root = tempDir("template");
  write(root, "claude/skills/orchestrate/SKILL.md", "orchestrate v1\n");
  write(root, "claude/skills/comment/SKILL.md", "comment v1\n");
  write(root, "claude/agents/.gitkeep", "");
  write(root, "gitignore", ".corpus/*\n!.corpus/template-manifest.json\n");
  write(root, "README.md", "readme v1\n");
  return root;
}

/** A plugin tree contributing one skill, the `source: "plugin:<dir>"` provenance. */
function makePlugins(): string {
  const root = tempDir("plugins");
  write(root, "todos/skills/todos/SKILL.md", "todos skill v1\n");
  return root;
}

interface Harness {
  readonly root: string;
  readonly context: WorkspaceCommandContext;
  stdout(): string;
  report(): UpgradeReport;
}

/**
 * A scaffolded workspace with a real git repository, installed from the given
 * fake tool trees — the same `scaffoldWorkspace` `corpus init` runs, so the
 * baseline manifest an upgrade reads is the real one rather than a fixture.
 */
async function makeWorkspace(templateRoot: string, pluginsRoot: string): Promise<string> {
  const root = tempDir("ws");
  scaffoldWorkspace({
    root,
    templateRoot,
    pluginsRoot,
    port: 9110,
    token: generateToken(),
    toolVersion: "0.1.0",
  });
  await initRepository(root);
  await commitAll({ dir: root, message: "workspace: initialize corpus workspace by user" });
  return root;
}

function harnessFor(
  root: string,
  options: { readonly flags?: Record<string, boolean>; readonly json?: boolean } = {},
): Harness {
  const workspace = { ...workspaceOn(9110), root, configPath: join(root, ".corpus/config.json") };
  const base = createTestContext({
    flags: options.flags ?? {},
    ...(options.json === undefined ? {} : { json: options.json }),
    version: "0.2.0",
  });
  return {
    root,
    stdout: () => base.stdout(),
    report: () => JSON.parse(base.stdout()) as UpgradeReport,
    context: {
      ...base.context,
      workspace,
      client: createClient({ workspace }),
      actor: "user",
    },
  };
}

/**
 * "The operator ran `npm update`" means the *tool's* trees changed, so both are
 * injected through the same seam `runInit` takes rather than being resolved out
 * of the installed package a test cannot move.
 */
function upgrade(
  harness: Harness,
  tool: { readonly template: string; readonly plugins: string },
): Promise<void> {
  return runWorkspaceUpgrade(harness.context, {
    templateRoot: tool.template,
    pluginsRoot: tool.plugins,
  });
}

describe("corpus workspace upgrade", () => {
  it("updates an untouched file and never an edited one", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);

    // The agent evolved one skill; the operator's tool then changed both.
    write(root, ".claude/skills/comment/SKILL.md", "comment v1\nplus the agent's own paragraph\n");
    await commitAll({ dir: root, message: "agent evolved the comment skill" });
    const editedBefore = read(root, ".claude/skills/comment/SKILL.md");
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");

    const harness = harnessFor(root);
    await upgrade(harness, { template, plugins });

    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v2\n");
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe(editedBefore);
    expect(harness.stdout()).toContain("update  .claude/skills/orchestrate/SKILL.md");
    expect(harness.stdout()).toContain("keep    .claude/skills/comment/SKILL.md");
    expect(harness.stdout()).toContain("only here");
  });

  it("keeps the edited file's original baseline, so a second upgrade still refuses it", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);

    write(root, ".claude/skills/comment/SKILL.md", "the agent's version\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
    await upgrade(harnessFor(root), { template, plugins });

    write(template, "claude/skills/comment/SKILL.md", "comment v3\n");
    const second = harnessFor(root);
    await upgrade(second, { template, plugins });

    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("the agent's version\n");
    expect(second.stdout()).toContain("keep    .claude/skills/comment/SKILL.md");
  });

  it("lands one attributed commit naming old → new version, touching only template paths", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    // A workspace whose `.gitignore` excludes the manifest — the other branch of
    // `isIgnored`, and what a workspace installed before the manifest became
    // provenance still looks like. The verb asks git rather than assuming.
    write(template, "gitignore", ".corpus/*\n");
    const root = await makeWorkspace(template, plugins);
    write(root, "data/docs/inbox/mine.md", "a real document\n");
    await commitAll({ dir: root, message: "a document of my own" });

    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    write(template, "README.md", "readme v2\n");
    const before = (await git(root, "rev-list", "--count", "HEAD")).trim();

    await upgrade(harnessFor(root), { template, plugins });

    expect((await git(root, "rev-list", "--count", "HEAD")).trim()).toBe(
      String(Number(before) + 1),
    );
    expect(await git(root, "log", "-1", "--format=%an <%ae>%n%s")).toBe(
      "user <user@corpus.local>\nworkspace: upgrade template files 0.1.0 → 0.2.0 by user\n",
    );
    const touched = (await git(root, "show", "--stat", "--name-only", "--format=", "HEAD"))
      .split("\n")
      .filter((line) => line !== "")
      .sort();
    // Only template-provenance paths — nothing under `data/`. The manifest is
    // updated but stays out of the commit, because this workspace's own
    // `.gitignore` excludes all of `.corpus/` without exception.
    expect(touched).toEqual([".claude/skills/orchestrate/SKILL.md", "README.md"]);
    expect(await git(root, "check-ignore", "--", ".corpus/template-manifest.json")).toContain(
      ".corpus/template-manifest.json",
    );
  });

  it("commits the manifest when the workspace does track it", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    // The shipped template's own rules: `.corpus/` ignored, the manifest
    // un-ignored. The verb asks git rather than assuming, so the manifest lands
    // in the same commit as the files it describes with no code change.
    const root = await makeWorkspace(template, plugins);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template, plugins });

    expect(harness.report().manifestCommitted).toBe(true);
    const touched = (await git(root, "show", "--stat", "--name-only", "--format=", "HEAD"))
      .split("\n")
      .filter((line) => line !== "")
      .sort();
    expect(touched).toEqual([
      ".claude/skills/orchestrate/SKILL.md",
      ".corpus/template-manifest.json",
    ]);
  });

  it("refreshes a plugin-sourced skill from the plugin, not the template", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);

    write(plugins, "todos/skills/todos/SKILL.md", "todos skill v2\n");
    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template, plugins });

    expect(read(root, ".claude/skills/todos/SKILL.md")).toBe("todos skill v2\n");
    const change = harness.report().changes.find((entry) => entry.path.includes("todos"));
    expect(change?.source).toBe("plugin:todos");
    const manifest = readTemplateManifest(templateManifestPath(root));
    expect(
      manifest?.files.find((file) => file.path === ".claude/skills/todos/SKILL.md")?.source,
    ).toBe("plugin:todos");
  });

  it("says `already up to date.` and makes no commit when nothing changed", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);
    const head = await git(root, "rev-parse", "HEAD");

    const harness = harnessFor(root);
    await upgrade(harness, { template, plugins });

    expect(harness.stdout()).toBe("already up to date.\n");
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("writes nothing under --dry-run, then performs exactly the printed plan", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    write(template, "claude/agents/reviewer.md", "a new persona\n");

    const head = await git(root, "rev-parse", "HEAD");
    const status = await git(root, "status", "--porcelain");
    const planned = harnessFor(root, { flags: { "dry-run": true }, json: true });
    await upgrade(planned, { template, plugins });

    expect(await git(root, "status", "--porcelain")).toBe(status);
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");
    const plan = planned.report();
    expect(plan.written).toEqual([]);
    expect(plan.manifestWritten).toBe(false);

    const applied = harnessFor(root, { json: true });
    await upgrade(applied, { template, plugins });
    expect([...applied.report().written].sort()).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/orchestrate/SKILL.md",
    ]);
    expect(
      applied
        .report()
        .changes.map((change) => change.action)
        .sort(),
    ).toEqual(["install", "update"]);
  });

  it("reports a deleted file and reinstalls it only under --restore", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);
    rmSync(join(root, ".claude/skills/comment/SKILL.md"));

    const reported = harnessFor(root, { json: true });
    await upgrade(reported, { template, plugins });
    expect(reported.report().changes[0]?.action).toBe("restore-candidate");
    expect(reported.report().written).toEqual([]);

    const restored = harnessFor(root, { flags: { restore: true }, json: true });
    await upgrade(restored, { template, plugins });
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("comment v1\n");
    const manifest = readTemplateManifest(templateManifestPath(root));
    expect(manifest?.files.some((file) => file.path === ".claude/skills/comment/SKILL.md")).toBe(
      true,
    );
  });

  it("reports a retired file, leaves its copy, and drops the manifest entry", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);
    rmSync(join(template, "README.md"));

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template, plugins });

    expect(harness.report().changes.map((change) => [change.path, change.action])).toEqual([
      ["README.md", "retired"],
    ]);
    expect(read(root, "README.md")).toBe("readme v1\n");
    const manifest = readTemplateManifest(templateManifestPath(root));
    expect(manifest?.files.some((file) => file.path === "README.md")).toBe(false);
  });

  it("overwrites nothing without a manifest, and writes a baseline under --adopt", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);
    rmSync(templateManifestPath(root));
    write(root, ".claude/skills/comment/SKILL.md", "edited, and nothing knows it\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    const head = await git(root, "rev-parse", "HEAD");

    const conservative = harnessFor(root, { json: true });
    await upgrade(conservative, { template, plugins });

    expect(conservative.report().withoutBaseline).toBe(true);
    expect(conservative.report().written).toEqual([]);
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);

    const adopted = harnessFor(root, { flags: { adopt: true }, json: true });
    await upgrade(adopted, { template, plugins });

    const manifest = readTemplateManifest(templateManifestPath(root));
    // Files that already match are tracked; the edited one is deliberately not,
    // because nothing can tell an old copy from an edited one.
    expect(manifest?.files.map((file) => file.path)).toContain(".gitignore");
    expect(manifest?.files.map((file) => file.path)).not.toContain(
      ".claude/skills/comment/SKILL.md",
    );
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("edited, and nothing knows it\n");
  });

  it("never writes under data/ or elsewhere in .corpus/", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = await makeWorkspace(template, plugins);
    write(root, "data/docs/inbox/mine.md", "untouched\n");
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    const config = read(root, ".corpus/config.json");

    await upgrade(harnessFor(root), { template, plugins });

    expect(read(root, "data/docs/inbox/mine.md")).toBe("untouched\n");
    expect(read(root, ".corpus/config.json")).toBe(config);
  });
});

describe("the workspace upgrade command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(
      collectRegistryProblems({ summary: "s.", commands: [], topics: [workspaceTopic] }),
    ).toEqual([]);
  });

  it("takes no arguments and exactly its three flags", () => {
    expect(upgradeCommand.args).toEqual([]);
    expect(upgradeCommand.flags.map((flag) => flag.name)).toEqual(["dry-run", "restore", "adopt"]);
    expect(upgradeCommand.requiresWorkspace).not.toBe(false);
  });

  it("states that it is a documented write exception, and why", () => {
    expect(upgradeCommand.description).toContain("§2.2 rule 4");
    expect(upgradeCommand.description).toContain("server stopped");
    expect(upgradeCommand.description).toContain("the rule is not soft");
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = upgradeCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"changes"');
    expect(machine?.description).toContain('"written"');
  });

  it("is the topic's only verb, reachable as `corpus workspace upgrade`", () => {
    expect(workspaceTopic.commands.map((command) => command.name)).toEqual(["upgrade"]);
  });
});
