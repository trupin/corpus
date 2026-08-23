import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../client.js";
import { templateManifestPath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { registry } from "../../registry/index.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { workspaceOn } from "../../testing/stub-server.js";
import {
  readTemplateManifest,
  serializeManifest,
  sha256,
  type TemplateManifest,
} from "../../template/manifest.js";
import { generateToken, scaffoldWorkspace } from "../init/scaffold.js";
import { commitAll, initRepository } from "../init/git.js";
import { workspaceTopic } from "./index.js";
import { ensureMaintenanceSettings, MAINTENANCE_SETTINGS } from "./maintenance.js";
import {
  missingQueueMarkers,
  runWorkspaceUpgrade,
  upgradeCommand,
  type UpgradeReport,
} from "./upgrade.js";

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
  write(
    root,
    "gitignore",
    ".corpus/*\n!.corpus/template-manifest.json\n!.corpus/queue/\n.corpus/queue/*/*.json\n",
  );
  write(root, "README.md", "readme v1\n");
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
async function makeWorkspace(templateRoot: string): Promise<string> {
  const root = tempDir("ws");
  scaffoldWorkspace({
    root,
    templateRoot,
    port: 9110,
    token: generateToken(),
    toolVersion: "0.1.0",
  });
  await initRepository(root);
  // Faithful to what `corpus init` leaves behind since CLI-037, so the upgrade
  // tests below are not all shadowed by a one-off maintenance repair. The tests
  // that are *about* that repair start from a workspace without it.
  await ensureMaintenanceSettings(root);
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
    // The real surface, not the fixture one: the stale-citation scan (CLI-059)
    // judges a workspace's skills against the commands this build actually has,
    // and a fixture registry would make every command in them look removed.
    registry,
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
 * "The operator ran `npm update`" means the *tool's* template changed, so it is
 * injected through the same seam `runInit` takes rather than being resolved out
 * of the installed package a test cannot move.
 */
function upgrade(harness: Harness, tool: { readonly template: string }): Promise<void> {
  return runWorkspaceUpgrade(harness.context, { templateRoot: tool.template });
}

describe("corpus workspace upgrade", () => {
  it("updates an untouched file and never an edited one", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    // The agent evolved one skill; the operator's tool then changed both.
    write(root, ".claude/skills/comment/SKILL.md", "comment v1\nplus the agent's own paragraph\n");
    await commitAll({ dir: root, message: "agent evolved the comment skill" });
    const editedBefore = read(root, ".claude/skills/comment/SKILL.md");
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v2\n");
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe(editedBefore);
    expect(harness.stdout()).toContain("update  .claude/skills/orchestrate/SKILL.md");
    expect(harness.stdout()).toContain("keep    .claude/skills/comment/SKILL.md");
    expect(harness.stdout()).toContain("only here");
    // A conflict is unresolved work rather than a notice (SPEC.md §2.4), so it
    // names the verb that shows what moved upstream — and only a conflict does.
    expect(harness.stdout()).toContain(
      "unresolved — corpus workspace diff .claude/skills/comment/SKILL.md",
    );
    expect(harness.stdout()).not.toContain(
      "unresolved — corpus workspace diff .claude/skills/orchestrate/SKILL.md",
    );
  });

  it("reports an unchanged workspace as up to date, as a value and as a line", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template });
    expect(harness.report().upToDate).toBe(true);

    const human = harnessFor(root);
    await upgrade(human, { template });
    expect(human.stdout()).toContain("already up to date.");
  });

  it("keeps the edited file's original baseline, so a second upgrade still refuses it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, ".claude/skills/comment/SKILL.md", "the agent's version\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
    await upgrade(harnessFor(root), { template });

    write(template, "claude/skills/comment/SKILL.md", "comment v3\n");
    const second = harnessFor(root);
    await upgrade(second, { template });

    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("the agent's version\n");
    expect(second.stdout()).toContain("keep    .claude/skills/comment/SKILL.md");
  });

  it("lands one attributed commit naming old → new version, touching only template paths", async () => {
    const template = makeTemplate();
    // A workspace whose `.gitignore` excludes the manifest — the other branch of
    // `isIgnored`, and what a workspace installed before the manifest became
    // provenance still looks like. The verb asks git rather than assuming.
    write(template, "gitignore", ".corpus/*\n");
    const root = await makeWorkspace(template);
    write(root, "data/docs/inbox/mine.md", "a real document\n");
    await commitAll({ dir: root, message: "a document of my own" });

    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    write(template, "README.md", "readme v2\n");
    const before = (await git(root, "rev-list", "--count", "HEAD")).trim();

    await upgrade(harnessFor(root), { template });

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
    // The shipped template's own rules: `.corpus/` ignored, the manifest
    // un-ignored. The verb asks git rather than assuming, so the manifest lands
    // in the same commit as the files it describes with no code change.
    const root = await makeWorkspace(template);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template });

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

  it("says `already up to date.` and makes no commit when nothing changed", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const head = await git(root, "rev-parse", "HEAD");

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    // The migrations section prints in every run, including this one: a
    // workspace whose template files are current can still hold data written
    // for the release before this one (SPEC.md §2.4 rider 8, CLI-061).
    expect(harness.stdout()).toBe(
      "already up to date.\nmigrations: none — every document is written the way this tool reads it.\n",
    );
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("brings a workspace that predates CLI-037 under corpus's own git maintenance", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    // A workspace as `corpus init` made it before CLI-037: git's background
    // maintenance is on, which is the configuration SERVER-089 measured corrupt.
    for (const [name] of MAINTENANCE_SETTINGS) await git(root, "config", "--unset", name);
    const head = await git(root, "rev-parse", "HEAD");

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    for (const [name, value] of MAINTENANCE_SETTINGS) {
      expect((await git(root, "config", "--local", "--get", name)).trim()).toBe(value);
    }
    // Reported, and reported *before* "already up to date." — the template files
    // were current, and the sentence would otherwise be a lie about the one
    // thing that did change.
    expect(harness.stdout().split("\n")[0]).toContain("background maintenance");
    expect(harness.stdout()).toContain("already up to date.");
    // Repository configuration, not a workspace file: nothing to commit.
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("says nothing about maintenance on the next run, having nothing left to write", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    for (const [name] of MAINTENANCE_SETTINGS) await git(root, "config", "--unset", name);

    await upgrade(harnessFor(root), { template });
    const second = harnessFor(root, { json: true });
    await upgrade(second, { template });

    expect(second.report().maintenanceSettings).toEqual([]);
  });

  it("predicts the maintenance repair under --dry-run without writing it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    for (const [name] of MAINTENANCE_SETTINGS) await git(root, "config", "--unset", name);

    const harness = harnessFor(root, { flags: { "dry-run": true } });
    await upgrade(harness, { template });

    expect(harness.stdout()).toContain("would turn off");
    await expect(git(root, "config", "--local", "--get", "maintenance.auto")).rejects.toThrow();
  });

  it("writes nothing under --dry-run, then performs exactly the printed plan", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    write(template, "claude/agents/reviewer.md", "a new persona\n");

    const head = await git(root, "rev-parse", "HEAD");
    const status = await git(root, "status", "--porcelain");
    const planned = harnessFor(root, { flags: { "dry-run": true }, json: true });
    await upgrade(planned, { template });

    expect(await git(root, "status", "--porcelain")).toBe(status);
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");
    const plan = planned.report();
    expect(plan.written).toEqual([]);
    expect(plan.manifestWritten).toBe(false);

    const applied = harnessFor(root, { json: true });
    await upgrade(applied, { template });
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
    const root = await makeWorkspace(template);
    rmSync(join(root, ".claude/skills/comment/SKILL.md"));

    const reported = harnessFor(root, { json: true });
    await upgrade(reported, { template });
    expect(reported.report().changes[0]?.action).toBe("restore-candidate");
    expect(reported.report().written).toEqual([]);

    const restored = harnessFor(root, { flags: { restore: true }, json: true });
    await upgrade(restored, { template });
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("comment v1\n");
    const manifest = readTemplateManifest(templateManifestPath(root));
    expect(manifest?.files.some((file) => file.path === ".claude/skills/comment/SKILL.md")).toBe(
      true,
    );
  });

  it("reports a retired file, leaves its copy, and drops the manifest entry", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(join(template, "README.md"));

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template });

    expect(harness.report().changes.map((change) => [change.path, change.action])).toEqual([
      ["README.md", "retired"],
    ]);
    expect(read(root, "README.md")).toBe("readme v1\n");
    const manifest = readTemplateManifest(templateManifestPath(root));
    expect(manifest?.files.some((file) => file.path === "README.md")).toBe(false);
  });

  it("retires a file an older tool installed from a source this build no longer has", async () => {
    // The migration this phase has to get right: a workspace initialized by a
    // tool that installed files from somewhere other than the template carries
    // manifest entries this build can no longer produce an incoming copy for.
    // `source` names such an origin; no build still writes one, and the
    // fixture's value is deliberately arbitrary — what is under test is an
    // entry with no incoming copy, never a particular origin.
    // The `retired` cell is what must fire — report it, leave the file exactly
    // where it is, drop only the entry. A user's workspace files are not ours
    // to remove.
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, ".claude/skills/triage/SKILL.md", "triage skill v1\n");
    write(root, "data/docs/templates/meeting-template.md", "meeting template v1\n");
    const installed = readTemplateManifest(templateManifestPath(root));
    writeFileSync(
      templateManifestPath(root),
      serializeManifest({
        ...(installed as TemplateManifest),
        files: [
          ...(installed?.files ?? []),
          {
            path: ".claude/skills/triage/SKILL.md",
            sha256: sha256(Buffer.from("triage skill v1\n")),
            source: "starter:examples",
          },
          {
            path: "data/docs/templates/meeting-template.md",
            sha256: sha256(Buffer.from("meeting template v1\n")),
            source: "starter:examples",
          },
        ],
      } as TemplateManifest),
      "utf8",
    );
    await commitAll({ dir: root, message: "the workspace as an older tool left it" });

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template });

    expect(harness.report().changes.map((change) => [change.path, change.action])).toEqual([
      [".claude/skills/triage/SKILL.md", "retired"],
      ["data/docs/templates/meeting-template.md", "retired"],
    ]);
    // The files stay, byte for byte, and only the entries go.
    expect(read(root, ".claude/skills/triage/SKILL.md")).toBe("triage skill v1\n");
    expect(read(root, "data/docs/templates/meeting-template.md")).toBe("meeting template v1\n");
    expect(harness.report().written).toEqual([]);
    const manifest = readTemplateManifest(templateManifestPath(root));
    expect(manifest?.files.some((file) => file.path.includes("triage"))).toBe(false);
    expect(manifest?.files.some((file) => file.path.includes("meeting"))).toBe(false);
  });

  it("overwrites nothing without a manifest, and writes a baseline under --adopt", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(templateManifestPath(root));
    write(root, ".claude/skills/comment/SKILL.md", "edited, and nothing knows it\n");
    write(template, "claude/skills/comment/SKILL.md", "comment v2\n");
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    const head = await git(root, "rev-parse", "HEAD");

    const conservative = harnessFor(root, { json: true });
    await upgrade(conservative, { template });

    expect(conservative.report().withoutBaseline).toBe(true);
    expect(conservative.report().written).toEqual([]);
    expect(read(root, ".claude/skills/orchestrate/SKILL.md")).toBe("orchestrate v1\n");
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);

    const adopted = harnessFor(root, { flags: { adopt: true }, json: true });
    await upgrade(adopted, { template });

    const manifest = readTemplateManifest(templateManifestPath(root));
    // Files that already match are tracked; the edited one is deliberately not,
    // because nothing can tell an old copy from an edited one.
    expect(manifest?.files.map((file) => file.path)).toContain(".gitignore");
    expect(manifest?.files.map((file) => file.path)).not.toContain(
      ".claude/skills/comment/SKILL.md",
    );
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("edited, and nothing knows it\n");
  });

  it("neither installs nor records a template file the workspace has never had, under --adopt", async () => {
    // CLI-014. A pre-manifest workspace that is *missing* one of the tool's
    // files: `--adopt` applies no plan, so recording the incoming sha claimed a
    // path that is not on disk, and the run after that read the absence as a
    // user deletion. The recording is per file — the ones that do match are
    // still adopted.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(templateManifestPath(root));
    rmSync(join(root, ".claude/skills/comment/SKILL.md"));
    write(root, "README.md", "the operator's own readme\n");

    const adopted = harnessFor(root, { flags: { adopt: true } });
    await upgrade(adopted, { template });

    // The plan names it as pending, never as something this run did.
    expect(adopted.stdout()).toContain("pending .claude/skills/comment/SKILL.md");
    expect(adopted.stdout()).not.toContain("install .claude");
    expect(adopted.stdout()).toContain("--adopt installs nothing");
    expect(existsSync(join(root, ".claude/skills/comment/SKILL.md"))).toBe(false);

    // The manifest matches the disk, file by file: the untouched ones adopted,
    // the edited one left unknown, the absent one absent.
    const baseline = readTemplateManifest(templateManifestPath(root));
    const recorded = baseline?.files.map((file) => file.path) ?? [];
    expect(recorded).toContain(".claude/skills/orchestrate/SKILL.md");
    expect(recorded).not.toContain("README.md");
    expect(recorded).not.toContain(".claude/skills/comment/SKILL.md");

    // And the next ordinary run installs it, rather than calling it deleted.
    const second = harnessFor(root, { json: true });
    await upgrade(second, { template });

    expect(second.report().changes).toContainEqual(
      expect.objectContaining({ path: ".claude/skills/comment/SKILL.md", action: "install" }),
    );
    expect(second.report().written).toContain(".claude/skills/comment/SKILL.md");
    expect(read(root, ".claude/skills/comment/SKILL.md")).toBe("comment v1\n");
    expect(
      readTemplateManifest(templateManifestPath(root))?.files.map((file) => file.path),
    ).toContain(".claude/skills/comment/SKILL.md");
  });

  it("calls a missing file pending even in the plan that precedes --adopt", async () => {
    // The same honesty one step earlier: no run writes a workspace file without
    // a baseline, so `install` would be a claim about a command the operator has
    // not reached yet.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(templateManifestPath(root));
    rmSync(join(root, ".claude/skills/comment/SKILL.md"));

    const planned = harnessFor(root);
    await upgrade(planned, { template });

    expect(planned.stdout()).toContain("pending .claude/skills/comment/SKILL.md");
    expect(planned.stdout()).toContain("nothing is written without a baseline");
    expect(planned.stdout()).toContain("nothing was written.");
    expect(existsSync(templateManifestPath(root))).toBe(false);
  });

  it("never writes under data/ or elsewhere in .corpus/", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, "data/docs/inbox/mine.md", "untouched\n");
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");
    const config = read(root, ".corpus/config.json");

    await upgrade(harnessFor(root), { template });

    expect(read(root, "data/docs/inbox/mine.md")).toBe("untouched\n");
    expect(read(root, ".corpus/config.json")).toBe(config);
  });

  it("heals a queue skeleton that predates a status, and commits the marker", async () => {
    // The SHARED-003 ledger item (sprint-017 Adjudication 10): `corpus init`
    // writes one `.gitkeep` per status, but a workspace created before a status
    // existed never gains its directory — so the state has nowhere to live on a
    // fresh checkout.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(join(root, ".corpus", "queue", "deferred"), { recursive: true, force: true });
    expect(existsSync(join(root, ".corpus", "queue", "deferred"))).toBe(false);

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template });

    expect(harness.report().queueSkeleton).toEqual([".corpus/queue/deferred/.gitkeep"]);
    expect(existsSync(join(root, ".corpus", "queue", "deferred", ".gitkeep"))).toBe(true);
    // Tracked, not merely present: the marker exists so a clone carries the directory.
    expect(await git(root, "ls-files", "--", ".corpus/queue/deferred/.gitkeep")).toContain(
      ".gitkeep",
    );

    // Idempotent: a second run has nothing to do at all.
    const second = harnessFor(root);
    await upgrade(second, { template });
    expect(second.stdout()).toContain("already up to date.\n");
  });

  it("creates but does not stage a marker the workspace's own .gitignore excludes", async () => {
    // An old workspace may ignore all of `.corpus/`. `git add` of an ignored
    // path fails the whole command, so the repair must not turn into a crash —
    // and the operator's ignore rules are theirs, not this verb's to override.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".gitignore", ".corpus/*\n");
    await commitAll({ dir: root, message: "the operator narrowed .gitignore" });
    rmSync(join(root, ".corpus", "queue", "deferred"), { recursive: true, force: true });

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    // Created — the repair still happens — but kept out of the commit rather
    // than forced past the operator's own ignore rules, and said out loud.
    expect(existsSync(join(root, ".corpus", "queue", "deferred", ".gitkeep"))).toBe(true);
    expect(await git(root, "show", "--name-only", "--format=", "HEAD")).not.toContain(
      ".corpus/queue/deferred/.gitkeep",
    );
    expect(harness.stdout()).toContain("excluded by this workspace's .gitignore");
  });

  it("checks every status the contract declares, not a hardcoded list", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    for (const status of QUEUE_EVENT_STATUSES) {
      rmSync(join(root, ".corpus", "queue", status), { recursive: true, force: true });
    }

    expect(missingQueueMarkers(root)).toEqual(
      QUEUE_EVENT_STATUSES.map((status) => `.corpus/queue/${status}/.gitkeep`),
    );

    const harness = harnessFor(root, { json: true });
    await upgrade(harness, { template });

    for (const status of QUEUE_EVENT_STATUSES) {
      expect(existsSync(join(root, ".corpus", "queue", status, ".gitkeep"))).toBe(true);
    }
    expect(harness.report().commit).not.toBeNull();
  });

  it("reports a missing marker under --dry-run and writes nothing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(join(root, ".corpus", "queue", "deferred"), { recursive: true, force: true });

    const harness = harnessFor(root, { flags: { "dry-run": true } });
    await upgrade(harness, { template });

    expect(harness.stdout()).toContain("pending .corpus/queue/deferred/.gitkeep");
    expect(existsSync(join(root, ".corpus", "queue", "deferred"))).toBe(false);
    expect(harness.stdout()).not.toContain("excluded by this workspace's .gitignore");
  });

  it("predicts the marker it would create but not commit, instead of promising the repair", async () => {
    // Wave-3 audit, TEST 31. `queueSkeletonIgnored` was hard-coded empty on the
    // plan path, so `--dry-run` against an old `.gitignore` printed a repair the
    // real run then declined to commit — the one thing a plan may not do.
    // `check-ignore --no-index` answers about a path that does not exist yet,
    // which is why the prediction can be made at all.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".gitignore", ".corpus/*\n");
    await commitAll({ dir: root, message: "the operator narrowed .gitignore" });
    rmSync(join(root, ".corpus", "queue", "deferred"), { recursive: true, force: true });

    const planned = harnessFor(root, { flags: { "dry-run": true }, json: true });
    await upgrade(planned, { template });

    expect(planned.report().queueSkeletonIgnored).toEqual([".corpus/queue/deferred/.gitkeep"]);
    expect(existsSync(join(root, ".corpus", "queue", "deferred"))).toBe(false);

    const spoken = harnessFor(root, { flags: { "dry-run": true } });
    await upgrade(spoken, { template });
    expect(spoken.stdout()).toContain("excluded by this workspace's .gitignore");
    // A plan says "would be", never "was": nothing has happened yet.
    expect(spoken.stdout()).toContain("would be created but not committed");

    // And the real run agrees with the plan it printed.
    const real = harnessFor(root, { json: true });
    await upgrade(real, { template });
    expect(real.report().queueSkeletonIgnored).toEqual([".corpus/queue/deferred/.gitkeep"]);
  });

  it("heals the skeleton even without a baseline, where no template file may be written", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    rmSync(templateManifestPath(root));
    rmSync(join(root, ".corpus", "queue", "deferred"), { recursive: true, force: true });

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    // A directory is either there or it is not — nothing about it needs a
    // baseline, and an empty marker overwrites nothing.
    expect(existsSync(join(root, ".corpus", "queue", "deferred", ".gitkeep"))).toBe(true);
    expect(existsSync(templateManifestPath(root))).toBe(false);
    expect(harness.stdout()).toContain("no template file was written");
  });
});

/**
 * SPEC.md §2.4 rider 8 (signed 2026-08-22), CLI-061: the report ends with the
 * data migrations the workspace needs, as commands, and performs none of them.
 * The detector's own cases live in `src/migrations/`; what is tested here is the
 * half only this verb can be wrong about — that the section is reached, that it
 * survives an otherwise up-to-date run, and that nothing on disk moved.
 */
describe("corpus workspace upgrade reports data migrations", () => {
  /** A workspace written before Phase 41: pinned views, and no board document. */
  function seedPrePhase41(root: string): void {
    write(
      root,
      "data/docs/views/attention.md",
      "---\nid: doc_seedattention\ntype: view\ntitle: Attention\npinned: true\norder: 1\n---\n",
    );
    write(
      root,
      "data/docs/views/inbox.md",
      "---\nid: doc_seedinbox\ntype: view\ntitle: Inbox\npinned: true\norder: 2\n---\n",
    );
  }

  it("names the views, the board to build, and the unsets, and writes nothing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);
    const before = read(root, "data/docs/views/attention.md");

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    const stdout = harness.stdout();
    expect(stdout).toContain("1 data migration");
    expect(stdout).toContain("views-to-board:");
    expect(stdout).toContain(
      "Run the commands below, or ask the agent to. Nothing here was performed",
    );
    expect(stdout).toContain(
      'corpus doc create --type board --title "Board" --folder boards ' +
        "--columns doc_seedattention,doc_seedinbox --default-open true",
    );
    expect(stdout).toContain("corpus doc edit doc_seedattention --unset pinned --unset order");
    expect(stdout).toContain("corpus doc edit doc_seedinbox --unset pinned --unset order");

    // Reported, never performed: the files are byte-for-byte what they were.
    expect(read(root, "data/docs/views/attention.md")).toBe(before);
    expect(existsSync(join(root, "data", "docs", "boards"))).toBe(false);
  });

  it("reports the migration even when the template files are already current", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    expect(harness.stdout()).toContain("already up to date.");
    expect(harness.stdout()).toContain("views-to-board:");
  });

  it("carries the migrations under --json, and an empty array when none fires", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    const withMigration = harnessFor(root, { json: true });
    await upgrade(withMigration, { template });
    const migrations = withMigration.report().migrations;
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.id).toBe("views-to-board");
    expect(migrations[0]?.statement).toContain("no longer read");
    expect(migrations[0]?.commands).toEqual([
      'corpus doc create --type board --title "Board" --folder boards ' +
        "--columns doc_seedattention,doc_seedinbox --default-open true",
      "corpus doc edit doc_seedattention --unset pinned --unset order",
      "corpus doc edit doc_seedinbox --unset pinned --unset order",
    ]);
    expect(migrations[0]?.optional).toEqual([]);

    const plain = await makeWorkspace(template);
    const none = harnessFor(plain, { json: true });
    await upgrade(none, { template });
    expect(none.report().migrations).toEqual([]);
  });

  it("looks under the workspace's own dataDir, not a hardcoded `data/`", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(
      root,
      "corpus-data/docs/views/attention.md",
      "---\nid: doc_relocated\ntype: view\ntitle: Attention\npinned: true\n---\n",
    );

    const harness = harnessFor(root);
    const relocated = { ...harness.context.workspace, dataDir: "corpus-data" };
    await runWorkspaceUpgrade(
      { ...harness.context, workspace: relocated },
      { templateRoot: template },
    );

    expect(harness.stdout()).toContain(
      "corpus doc edit doc_relocated --unset pinned --unset order",
    );
  });

  it("says the section is empty rather than dropping it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    expect(harness.stdout()).toContain("migrations: none");
  });

  it("goes quiet once the commands it printed have been carried out", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    seedPrePhase41(root);

    // Exactly what the printed commands produce, applied by hand: a board that
    // lists both views, and the two views with the dead keys gone.
    write(
      root,
      "data/docs/boards/board.md",
      "---\nid: doc_board\ntype: board\ntitle: Board\ndefault-open: true\n" +
        "columns:\n  - doc_seedattention\n  - doc_seedinbox\n---\n",
    );
    write(
      root,
      "data/docs/views/attention.md",
      "---\nid: doc_seedattention\ntype: view\ntitle: Attention\n---\n",
    );
    write(
      root,
      "data/docs/views/inbox.md",
      "---\nid: doc_seedinbox\ntype: view\ntitle: Inbox\n---\n",
    );

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    expect(harness.stdout()).toContain("migrations: none");
    expect(harness.stdout()).not.toContain("views-to-board");
  });
});

describe("corpus workspace upgrade reports stale command references", () => {
  /** A workspace whose own skill teaches a verb this build does not have. */
  async function withStaleSkill(): Promise<{ harness: Harness; template: string; root: string }> {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(
      root,
      ".claude/skills/orchestrate/SKILL.md",
      ["orchestrate v1", "", "```bash", "corpus skill rollback orchestrate", "```", ""].join("\n"),
    );
    await commitAll({ dir: root, message: "agent evolved the orchestrate skill" });
    return { harness: harnessFor(root), template, root };
  }

  it("names the skill, the line, the command and what to do instead", async () => {
    const { harness, template } = await withStaleSkill();
    await upgrade(harness, { template });

    const out = harness.stdout();
    expect(out).toContain("1 stale command reference");
    expect(out).toContain(".claude/skills/orchestrate/SKILL.md:4: `corpus skill rollback`");
    expect(out).toContain("corpus skill rollback orchestrate");
    expect(out).toContain("`corpus skill --help=brief` lists the verbs `corpus skill` has.");
    expect(out).toContain("corpus workspace diff <path>");
  });

  it("reports it even when every template file is already current", async () => {
    // The "already up to date." short-circuit is about template *files*, and an
    // edited skill is exactly the file that is never up to date by that measure.
    const { harness, template } = await withStaleSkill();
    await upgrade(harness, { template });
    const second = harnessFor(harness.root);
    await upgrade(second, { template });

    expect(second.stdout()).toContain("already up to date.");
    expect(second.stdout()).toContain("1 stale command reference");
  });

  it("says nothing at all when there is nothing to say", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(template, "claude/skills/orchestrate/SKILL.md", "orchestrate v2\n");

    const harness = harnessFor(root);
    await upgrade(harness, { template });
    expect(harness.stdout()).not.toContain("stale command reference");
  });

  it("carries the findings in --json and changes no exit code", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(
      root,
      ".claude/skills/comment/SKILL.md",
      ["comment v1", "", "```bash", "corpus skill rollback comment", "```", ""].join("\n"),
    );
    await commitAll({ dir: root, message: "agent evolved the comment skill" });

    const harness = harnessFor(root, { json: true });
    await expect(upgrade(harness, { template })).resolves.toBeUndefined();
    expect(harness.report().staleCitations).toEqual([
      {
        path: ".claude/skills/comment/SKILL.md",
        line: 4,
        command: "skill rollback",
        text: "corpus skill rollback comment",
        hint: "`corpus skill --help=brief` lists the verbs `corpus skill` has.",
      },
    ]);
  });

  it("is scanned after the sync, so a citation the sync repaired is not reported", async () => {
    // The workspace never touched this file, so the upgrade overwrites it with
    // the tool's own copy — and the citation is gone before the scan runs.
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, ".claude/skills/orchestrate/SKILL.md", "orchestrate v1\n");
    write(
      template,
      "claude/skills/orchestrate/SKILL.md",
      ["orchestrate v2", "", "```bash", "corpus queue idle", "```", ""].join("\n"),
    );

    // Prove the pre-sync state would have been reported, so the assertion below
    // is about ordering rather than about there being nothing to find.
    write(
      root,
      ".claude/skills/comment/SKILL.md",
      ["comment v1", "", "```bash", "corpus skill rollback comment", "```", ""].join("\n"),
    );
    await commitAll({ dir: root, message: "agent evolved the comment skill" });
    write(
      template,
      "claude/skills/comment/SKILL.md",
      ["comment v2", "", "```bash", "corpus queue idle", "```", ""].join("\n"),
    );

    const harness = harnessFor(root);
    await upgrade(harness, { template });

    const out = harness.stdout();
    expect(out).toContain("update  .claude/skills/orchestrate/SKILL.md");
    // The edited one was kept, so its dead verb is still there and still said.
    expect(out).toContain("keep    .claude/skills/comment/SKILL.md");
    expect(out).toContain(".claude/skills/comment/SKILL.md:4: `corpus skill rollback`");
    expect(out).not.toContain(".claude/skills/orchestrate/SKILL.md:4:");
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

  it("is reachable as `corpus workspace upgrade`, alongside the verb that shows its conflicts", () => {
    // Pinned rather than "contains": a new workspace verb is a change to the
    // command surface and shows up here as a failing diff (SPEC.md §2.3).
    expect(workspaceTopic.commands.map((command) => command.name)).toEqual([
      "upgrade",
      "diff",
      "maintain",
    ]);
  });
});
