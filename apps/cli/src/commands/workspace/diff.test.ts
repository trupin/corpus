import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../client.js";
import { ExitCode, isCliError } from "../../errors.js";
import { templateManifestPath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { workspaceOn } from "../../testing/stub-server.js";
import { generateToken, scaffoldWorkspace } from "../init/scaffold.js";
import {
  runWorkspaceDiff,
  workspaceDiffCommand,
  type WorkspaceConflictList,
  type WorkspaceDiffReport,
} from "./diff.js";
import { workspaceTopic } from "./index.js";

/**
 * Real directories throughout, and a real `corpus init` scaffold — so the
 * baseline the verb reads is the manifest `corpus init` actually writes rather
 * than a fixture that could disagree with it.
 *
 * No git and no server: this verb needs neither, and a test that set one up
 * would stop proving that. A "tool update" is simulated by editing the scratch
 * template between the scaffold and the run, which is what `npm update` does to
 * the installed package.
 */

const PREFIX = "corpus-cli027-";
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${PREFIX}${label}-`));
  scratch.push(dir);
  return dir;
}

function write(root: string, relative: string, contents: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

const SKILL_V1 = "# Comment\n\nask a question\nthen wait\n";

/** A template tree in the tool's own shape (dotless `claude/`, `gitignore`). */
function makeTemplate(): string {
  const root = tempDir("template");
  write(root, "claude/skills/orchestrate/SKILL.md", "orchestrate v1\n");
  write(root, "claude/skills/comment/SKILL.md", SKILL_V1);
  write(root, "claude/agents/.gitkeep", "");
  write(root, "gitignore", ".corpus/*\n!.corpus/template-manifest.json\n");
  write(root, "README.md", "readme v1\n");
  return root;
}

/** A plugin tree contributing one skill, carrying `source: "plugin:<dir>"`. */
function makePlugins(): string {
  const root = tempDir("plugins");
  write(root, "todos/skills/todos/SKILL.md", "todos skill v1\n");
  return root;
}

interface Harness {
  readonly root: string;
  readonly context: WorkspaceCommandContext;
  stdout(): string;
  json<T>(): T;
}

function makeWorkspace(templateRoot: string, pluginsRoot: string): string {
  const root = tempDir("ws");
  scaffoldWorkspace({
    root,
    templateRoot,
    pluginsRoot,
    port: 9120,
    token: generateToken(),
    toolVersion: "0.1.0",
  });
  return root;
}

function harnessFor(
  root: string,
  options: { readonly path?: string; readonly json?: boolean; readonly cwd?: string } = {},
): Harness {
  const workspace = { ...workspaceOn(9120), root, configPath: join(root, ".corpus/config.json") };
  const base = createTestContext({
    ...(options.path === undefined ? {} : { args: { path: options.path } }),
    ...(options.json === undefined ? {} : { json: options.json }),
    cwd: options.cwd ?? root,
    version: "0.3.0",
  });
  return {
    root,
    stdout: () => base.stdout(),
    json: <T>() => JSON.parse(base.stdout()) as T,
    context: { ...base.context, workspace, client: createClient({ workspace }), actor: "user" },
  };
}

function diff(
  harness: Harness,
  tool: { readonly template: string; readonly plugins: string },
): Promise<void> {
  return runWorkspaceDiff(harness.context, {
    templateRoot: tool.template,
    pluginsRoot: tool.plugins,
  });
}

const COMMENT_SKILL = ".claude/skills/comment/SKILL.md";

/** The workspace edited a skill; the tool then changed the same skill. */
function conflictingWorkspace(): { root: string; template: string; plugins: string } {
  const template = makeTemplate();
  const plugins = makePlugins();
  const root = makeWorkspace(template, plugins);

  write(root, COMMENT_SKILL, "# Comment\n\nask a question\nthen wait\nand log it\n");
  write(
    template,
    "claude/skills/comment/SKILL.md",
    "# Comment\n\nask a better question\nthen wait\n",
  );
  return { root, template, plugins };
}

describe("corpus workspace diff <path>", () => {
  it("shows what the tool changed under a file this workspace edited", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    const harness = harnessFor(root, { path: COMMENT_SKILL });

    await diff(harness, { template, plugins });

    const out = harness.stdout();
    expect(out).toContain("conflict — edited here and changed by the tool");
    expect(out).toContain(`--- workspace/${COMMENT_SKILL}`);
    expect(out).toContain(`+++ tool/${COMMENT_SKILL}`);
    expect(out).toContain("-ask a question");
    expect(out).toContain("+ask a better question");
    expect(out).toContain("-and log it");
    // Direction, so a merge cannot be applied backwards.
    expect(out).toContain("this diff reads workspace → tool");
  });

  it("names all three sides and which of them moved", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    const harness = harnessFor(root, { path: COMMENT_SKILL, json: true });

    await diff(harness, { template, plugins });
    const report = harness.json<WorkspaceDiffReport>();

    expect(report.action).toBe("keep-modified");
    expect(report.conflict).toBe(true);
    expect(report.baselineRecordedBy).toBe("0.1.0");
    expect(report.toolVersion).toBe("0.3.0");
    expect(report.baseline).toMatch(/^[0-9a-f]{64}$/);
    // The baseline is what makes the two-way diff readable: both sides moved
    // away from it, which is precisely what a conflict is.
    expect(report.workspace).toMatchObject({ present: true, matchesBaseline: false });
    expect(report.tool).toMatchObject({ present: true, matchesBaseline: false });
    expect(report.workspace.sha256).not.toBe(report.tool.sha256);
    expect(report.diff).toMatchObject({ from: "workspace", to: "tool", added: 1, removed: 2 });
    // Five lines here, four in the tool's copy: the workspace's added line is a
    // `-`, which is exactly the fact a backwards merge would destroy.
    expect(report.diff?.text).toContain("@@ -1,5 +1,4 @@");
  });

  it("emits exactly one JSON value and no human prose under --json", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    const harness = harnessFor(root, { path: COMMENT_SKILL, json: true });

    await diff(harness, { template, plugins });

    expect(harness.stdout().trimEnd().split("\n")).toHaveLength(1);
    expect(() => harness.json<WorkspaceDiffReport>()).not.toThrow();
  });

  it("says a clean file is clean, and exits successfully", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    const harness = harnessFor(root, { path: COMMENT_SKILL, json: true });

    await diff(harness, { template, plugins });
    const report = harness.json<WorkspaceDiffReport>();

    expect(report.action).toBe("current");
    expect(report.conflict).toBe(false);
    expect(report.diff).toBeNull();
    expect(report.workspace.sha256).toBe(report.tool.sha256);
  });

  it("distinguishes a file only the tool changed from a conflict", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    write(
      template,
      "claude/skills/comment/SKILL.md",
      "# Comment\n\nask a better question\nthen wait\n",
    );

    const harness = harnessFor(root, { path: COMMENT_SKILL });
    await diff(harness, { template, plugins });

    expect(harness.stdout()).toContain("not a conflict — this workspace never edited it");
    expect(harness.stdout()).toContain("+ask a better question");
  });

  it("distinguishes a file only this workspace changed from a conflict", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    write(root, COMMENT_SKILL, `${SKILL_V1}and log it\n`);

    const harness = harnessFor(root, { path: COMMENT_SKILL, json: true });
    await diff(harness, { template, plugins });

    expect(harness.json<WorkspaceDiffReport>()).toMatchObject({
      action: "keep-silent",
      conflict: false,
      tool: { matchesBaseline: true },
      workspace: { matchesBaseline: false },
    });
    // The workspace's own added line reads as a `-`: the diff says what taking
    // the tool's copy would cost, which here is the workspace's edit.
    expect(harness.json<WorkspaceDiffReport>().diff).toMatchObject({ added: 0, removed: 1 });
  });

  it("says a retired file is retired rather than diffing it against nothing", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    // The tool dropped the file; the workspace's copy stays.
    unlinkSync(join(template, "claude", "skills", "comment", "SKILL.md"));

    const harness = harnessFor(root, { path: COMMENT_SKILL, json: true });
    await diff(harness, { template, plugins });
    const report = harness.json<WorkspaceDiffReport>();

    expect(report.action).toBe("retired");
    expect(report.diff).toBeNull();
    expect(report.tool).toMatchObject({ present: false, sha256: null });
  });

  it("shows a file this workspace deleted as a whole-file addition", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    unlinkSync(join(root, ".claude", "skills", "comment", "SKILL.md"));

    const harness = harnessFor(root, { path: COMMENT_SKILL, json: true });
    await diff(harness, { template, plugins });
    const report = harness.json<WorkspaceDiffReport>();

    expect(report.action).toBe("restore-candidate");
    expect(report.workspace.present).toBe(false);
    expect(report.diff).toMatchObject({ removed: 0, added: 4 });
    expect(report.diff?.text).toContain("@@ -0,0 +1,4 @@");
  });

  it("carries plugin provenance through, and diffs against the plugin's copy", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    write(root, ".claude/skills/todos/SKILL.md", "todos skill, edited here\n");
    write(plugins, "todos/skills/todos/SKILL.md", "todos skill v2\n");

    const harness = harnessFor(root, { path: ".claude/skills/todos/SKILL.md", json: true });
    await diff(harness, { template, plugins });
    const report = harness.json<WorkspaceDiffReport>();

    expect(report.source).toBe("plugin:todos");
    expect(report.conflict).toBe(true);
    expect(report.diff?.text).toContain("+todos skill v2");
  });

  it("refuses a path the tool does not install, with the reason and a usage exit", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);
    write(root, "data/docs/inbox/mine.md", "a document of my own\n");

    const harness = harnessFor(root, { path: "data/docs/inbox/mine.md" });
    const error = await diff(harness, { template, plugins }).catch((cause: unknown) => cause);

    expect(isCliError(error)).toBe(true);
    if (!isCliError(error)) return;
    expect(error.exitCode).toBe(ExitCode.usageError);
    expect(error.message).toContain("is not a file the corpus tool installs");
    expect(error.hint).toContain("corpus doc diff");
    expect(harness.stdout()).toBe("");
  });

  it("suggests the near miss when a known path is misspelled", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);

    const harness = harnessFor(root, { path: ".claude/skills/comment/SKILL.MD" });
    const error = await diff(harness, { template, plugins }).catch((cause: unknown) => cause);

    expect(isCliError(error)).toBe(true);
    if (!isCliError(error)) return;
    expect(error.details).toMatchObject({ didYouMean: COMMENT_SKILL });
  });

  it("accepts a path relative to the directory the command was run from", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    const harness = harnessFor(root, {
      path: "comment/SKILL.md",
      cwd: join(root, ".claude", "skills"),
      json: true,
    });

    await diff(harness, { template, plugins });

    expect(harness.json<WorkspaceDiffReport>().path).toBe(COMMENT_SKILL);
  });

  it("says every verdict is a guess when the workspace has no manifest", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    unlinkSync(templateManifestPath(root));

    const harness = harnessFor(root, { path: COMMENT_SKILL });
    await diff(harness, { template, plugins });

    expect(harness.stdout()).toContain("conflict (no baseline)");
    expect(harness.stdout()).toContain("no .corpus/template-manifest.json");
    // Still shows the difference: without a baseline the verdict is uncertain,
    // but what the two copies say is not.
    expect(harness.stdout()).toContain("+ask a better question");
  });
});

describe("corpus workspace diff (no path)", () => {
  it("lists the paths currently in conflict without re-running an upgrade", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    write(root, ".claude/skills/todos/SKILL.md", "todos skill, edited here\n");
    write(plugins, "todos/skills/todos/SKILL.md", "todos skill v2\n");
    // Changed by the tool but untouched here: not a conflict, so not listed.
    write(template, "README.md", "readme v2\n");

    const harness = harnessFor(root, { json: true });
    await diff(harness, { template, plugins });
    const report = harness.json<WorkspaceConflictList>();

    expect(report.conflicts.map((file) => file.path)).toEqual([
      COMMENT_SKILL,
      ".claude/skills/todos/SKILL.md",
    ]);
    expect(report.conflicts.every((file) => file.conflict)).toBe(true);
    expect(report.conflicts[1]?.source).toBe("plugin:todos");
    // The listing carries the same three identities, so triage needs no second call.
    expect(report.conflicts[0]).toMatchObject({
      action: "keep-modified",
      workspace: { matchesBaseline: false },
      tool: { matchesBaseline: false },
    });
  });

  it("names each conflict and the verb that shows it, for a human", async () => {
    const { root, template, plugins } = conflictingWorkspace();
    const harness = harnessFor(root);

    await diff(harness, { template, plugins });

    expect(harness.stdout()).toContain("1 conflict — edited in this workspace and changed by");
    expect(harness.stdout()).toContain(`  ${COMMENT_SKILL}`);
    expect(harness.stdout()).toContain("corpus workspace diff <path>");
  });

  it("says so plainly, and successfully, when there is nothing in conflict", async () => {
    const template = makeTemplate();
    const plugins = makePlugins();
    const root = makeWorkspace(template, plugins);

    const harness = harnessFor(root, { json: true });
    await diff(harness, { template, plugins });

    expect(harness.json<WorkspaceConflictList>().conflicts).toEqual([]);
  });
});

describe("the registry entry", () => {
  it("is registered under the workspace topic and validates", () => {
    expect(workspaceTopic.commands).toContain(workspaceDiffCommand);
    expect(
      collectRegistryProblems({ summary: "s", commands: [], topics: [workspaceTopic] }),
    ).toEqual([]);
  });

  it("declares its path argument optional, so the listing mode is reachable", () => {
    expect(workspaceDiffCommand.args).toHaveLength(1);
    expect(workspaceDiffCommand.args[0]).toMatchObject({ name: "path", required: false });
  });

  it("needs a workspace but declares no flags of its own", () => {
    // Everything it needs — `--json`, `--workspace` — is global. A command flag
    // shadowing one of those is a registry error, and there is nothing else to add.
    expect(workspaceDiffCommand.flags).toEqual([]);
    expect(workspaceDiffCommand.requiresWorkspace).toBeUndefined();
  });
});
