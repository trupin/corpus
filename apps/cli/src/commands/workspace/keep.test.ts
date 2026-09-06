import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../client.js";
import { ExitCode, isCliError } from "../../errors.js";
import { templateManifestPath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { registry } from "../../registry/index.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";
import { workspaceOn } from "../../testing/stub-server.js";
import { readTemplateManifest, sha256 } from "../../template/manifest.js";
import { commitAll, initRepository } from "../init/git.js";
import { generateToken, scaffoldWorkspace } from "../init/scaffold.js";
import { recoverBaselineBytes } from "./baseline.js";
import { runWorkspaceKeep, runWorkspaceUnkeep } from "./keep.js";
import { ensureMaintenanceSettings } from "./maintenance.js";
import { runWorkspaceUpgrade, type UpgradeReport } from "./upgrade.js";

/**
 * The keep-mark end to end against real scaffolds and real upgrades (CLI-081):
 * what matters here is the composition — a mark set by one verb changing what
 * another one reports, writes and records — so every test drives the real
 * `runWorkspaceUpgrade` over a real manifest rather than asserting on the
 * mark in isolation.
 */

const PREFIX = "corpus-cli081-";
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

function read(root: string, relative: string): string {
  return readFileSync(join(root, ...relative.split("/")), "utf8");
}

const BOARD = "data/docs/boards/attention.md";
const BOARD_TEMPLATE_PATH = "data/docs/boards/attention.md";

function makeTemplate(): string {
  const root = tempDir("template");
  write(root, "claude/skills/comment/SKILL.md", "comment v1\n");
  write(root, BOARD_TEMPLATE_PATH, "board v1\n");
  write(root, "gitignore", ".corpus/*\n!.corpus/template-manifest.json\n!.corpus/queue/\n");
  write(root, "README.md", "readme v1\n");
  return root;
}

async function makeWorkspace(templateRoot: string): Promise<string> {
  const root = tempDir("ws");
  scaffoldWorkspace({
    root,
    templateRoot,
    port: 9130,
    token: generateToken(),
    toolVersion: "0.1.0",
  });
  await initRepository(root);
  await ensureMaintenanceSettings(root);
  await commitAll({ dir: root, message: "workspace: initialize corpus workspace by user" });
  return root;
}

interface Harness {
  readonly context: WorkspaceCommandContext;
  stdout(): string;
}

function harnessFor(
  root: string,
  options: { readonly path?: string; readonly json?: boolean } = {},
): Harness {
  const workspace = { ...workspaceOn(9130), root, configPath: join(root, ".corpus/config.json") };
  const base = createTestContext({
    ...(options.path === undefined ? {} : { args: { path: options.path } }),
    ...(options.json === undefined ? {} : { json: options.json }),
    version: "0.2.0",
    registry,
  });
  return {
    stdout: () => base.stdout(),
    context: { ...base.context, workspace, client: createClient({ workspace }), actor: "user" },
  };
}

function upgrade(
  root: string,
  template: string,
  options: { readonly json?: boolean; readonly flags?: Record<string, boolean> } = {},
): Promise<Harness> {
  const workspace = { ...workspaceOn(9130), root, configPath: join(root, ".corpus/config.json") };
  const base = createTestContext({
    flags: options.flags ?? {},
    ...(options.json === undefined ? {} : { json: options.json }),
    version: "0.2.0",
    registry,
  });
  const harness: Harness = {
    stdout: () => base.stdout(),
    context: { ...base.context, workspace, client: createClient({ workspace }), actor: "user" },
  };
  return runWorkspaceUpgrade(harness.context, { templateRoot: template }).then(() => harness);
}

function keptFlag(root: string, path: string): true | undefined {
  const manifest = readTemplateManifest(templateManifestPath(root));
  return manifest?.files.find((entry) => entry.path === path)?.kept;
}

function baselineSha(root: string, path: string): string | undefined {
  const manifest = readTemplateManifest(templateManifestPath(root));
  return manifest?.files.find((entry) => entry.path === path)?.sha256;
}

describe("corpus workspace keep", () => {
  it("stops the upgrade reporting a customized file, and still names it", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    // The README-invited customization: two columns added by hand.
    write(root, BOARD, "board v1\nplus two hand-added columns\n");
    write(template, BOARD_TEMPLATE_PATH, "board v2\n");

    const before = await upgrade(root, template);
    expect(before.stdout()).toContain(`keep    ${BOARD}`);

    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);
    expect(keptFlag(root, BOARD)).toBe(true);

    const after = await upgrade(root, template);
    expect(after.stdout()).not.toContain(`keep    ${BOARD}`);
    expect(after.stdout()).toContain("1 kept file deliberately diverged, skipped by this report");
    // SPEC.md §2.4 has the upgrade name each divergent file, so the path is
    // printed — quietly, with no verdict column and no `unresolved —` line
    // (PR #75 review). Named, not nagged.
    expect(after.stdout()).toContain(`  kept: ${BOARD}`);
    expect(after.stdout()).not.toContain(`unresolved — corpus workspace diff ${BOARD}`);
    // The file is the workspace's: never written while kept.
    expect(read(root, BOARD)).toBe("board v1\nplus two hand-added columns\n");
  });

  it("names every kept file in the upgrade report, in path order", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, BOARD, "board custom\n");
    write(root, ".claude/skills/comment/SKILL.md", "comment custom\n");
    write(root, "README.md", "readme custom\n");
    for (const path of [BOARD, ".claude/skills/comment/SKILL.md", "README.md"]) {
      await runWorkspaceKeep(harnessFor(root, { path }).context);
    }

    write(template, BOARD_TEMPLATE_PATH, "board v2\n");
    const run = await upgrade(root, template);
    expect(run.stdout()).toContain("3 kept files deliberately diverged, skipped by this report");
    // Every one of them, sorted, one compact line apiece — including the two
    // whose divergence the tool has not moved past, because the operator's
    // question is "what is silenced", not "what changed upstream".
    const named = run
      .stdout()
      .split("\n")
      .filter((line) => line.startsWith("  kept: "));
    expect(named).toEqual([
      "  kept: .claude/skills/comment/SKILL.md",
      "  kept: README.md",
      `  kept: ${BOARD}`,
    ]);

    const list = harnessFor(root);
    await runWorkspaceKeep(list.context);
    expect(list.stdout()).toContain("3 kept files in this workspace");
    expect(list.stdout()).toContain(`  ${BOARD}`);
    expect(list.stdout()).toContain("  README.md");
  });

  it("names the kept files on an otherwise up-to-date run too", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, BOARD, "board custom\n");
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);
    write(template, BOARD_TEMPLATE_PATH, "board v2\n");
    // First run advances the kept baseline; the second has nothing left to do.
    await upgrade(root, template);

    const idle = await upgrade(root, template);
    expect(idle.stdout()).toContain("already up to date.");
    expect(idle.stdout()).toContain(`  kept: ${BOARD}`);
  });

  it("advances the kept baseline to each incoming copy without writing the file", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, BOARD, "board custom\n");
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);

    write(template, BOARD_TEMPLATE_PATH, "board v2\n");
    await upgrade(root, template);
    expect(baselineSha(root, BOARD)).toBe(sha256(Buffer.from("board v2\n", "utf8")));
    expect(read(root, BOARD)).toBe("board custom\n");

    write(template, BOARD_TEMPLATE_PATH, "board v3\n");
    await upgrade(root, template);
    expect(baselineSha(root, BOARD)).toBe(sha256(Buffer.from("board v3\n", "utf8")));
    expect(read(root, BOARD)).toBe("board custom\n");
    // The mark survives every advance.
    expect(keptFlag(root, BOARD)).toBe(true);
  });

  it("stores the advanced baseline's bytes, so a later merge still has its base", async () => {
    // The advanced baseline is the tool's bytes, which no workspace commit
    // holds — without the store, the first live merge after a keep-advance was
    // refused as unrecoverable (E2E, 2026-09-06).
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, BOARD, "board custom\n");
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);
    write(template, BOARD_TEMPLATE_PATH, "board v2\n");
    await upgrade(root, template);

    const recovered = await recoverBaselineBytes(
      root,
      BOARD,
      sha256(Buffer.from("board v2\n", "utf8")),
    );
    expect(recovered?.toString("utf8")).toBe("board v2\n");
  });

  it("un-keeps against the current template, not the one in force when the file was kept", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, BOARD, "board custom\n");
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);

    // Two upgrades advance the baseline while kept.
    write(template, BOARD_TEMPLATE_PATH, "board v2\n");
    await upgrade(root, template);
    write(template, BOARD_TEMPLATE_PATH, "board v3\n");
    await upgrade(root, template);

    await runWorkspaceUnkeep(harnessFor(root, { path: BOARD }).context);
    expect(keptFlag(root, BOARD)).toBeUndefined();

    // Against the unchanged v3 template the divergence is local-only: silent,
    // because the baseline is current — not a resurrected v1 conflict.
    const quiet = await upgrade(root, template, { json: true });
    const quietReport = JSON.parse(quiet.stdout()) as UpgradeReport;
    expect(quietReport.changes).toEqual([]);

    // The moment the template moves again, the conflict reports — and the diff
    // it names is against v4, the newest template.
    write(template, BOARD_TEMPLATE_PATH, "board v4\n");
    const loud = await upgrade(root, template);
    expect(loud.stdout()).toContain(`keep    ${BOARD}`);
  });

  it("keeps a restore-candidate unrestored and unreported: the workspace owns its absence too", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    write(root, BOARD, "board custom\n");
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);
    rmSync(join(root, ...BOARD.split("/")));

    const run = await upgrade(root, template, { flags: { restore: true } });
    expect(run.stdout()).not.toContain("deleted");
    expect(keptFlag(root, BOARD)).toBe(true);
    expect(() => read(root, BOARD)).toThrow();
  });

  it("refuses a path the manifest does not track, naming it, and writes nothing", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    const before = read(root, ".corpus/template-manifest.json");

    const harness = harnessFor(root, { path: "data/docs/notes/mine.md" });
    const failure = await runWorkspaceKeep(harness.context).catch((error: unknown) => error);
    expect(isCliError(failure) && failure.exitCode).toBe(ExitCode.usageError);
    expect(isCliError(failure) && failure.message).toContain("data/docs/notes/mine.md");
    expect(isCliError(failure) && failure.message).toContain("not template-tracked");
    expect(read(root, ".corpus/template-manifest.json")).toBe(before);
  });

  it("keeps and un-keeps idempotently, saying when nothing changed", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);
    const again = harnessFor(root, { path: BOARD });
    await runWorkspaceKeep(again.context);
    expect(again.stdout()).toContain("already kept");

    await runWorkspaceUnkeep(harnessFor(root, { path: BOARD }).context);
    const unkeptTwice = harnessFor(root, { path: BOARD });
    await runWorkspaceUnkeep(unkeptTwice.context);
    expect(unkeptTwice.stdout()).toContain("is not kept");
    expect(keptFlag(root, BOARD)).toBeUndefined();
  });

  it("refuses to keep in a workspace with no manifest, and lists an empty set instead", async () => {
    const root = tempDir("bare");
    const failure = await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context).catch(
      (error: unknown) => error,
    );
    expect(isCliError(failure) && failure.exitCode).toBe(ExitCode.refused);
    expect(isCliError(failure) && failure.code).toBe("no_baseline");

    const list = harnessFor(root);
    await runWorkspaceKeep(list.context);
    expect(list.stdout()).toContain("no kept files");
  });

  it("resolves a path relative to the invoking directory, like `workspace diff` does", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);

    const workspace = { ...workspaceOn(9130), root, configPath: join(root, ".corpus/config.json") };
    const base = createTestContext({
      args: { path: "attention.md" },
      cwd: join(root, "data", "docs", "boards"),
      version: "0.2.0",
      registry,
    });
    await runWorkspaceKeep({
      ...base.context,
      workspace,
      client: createClient({ workspace }),
      actor: "user",
    });
    expect(keptFlag(root, BOARD)).toBe(true);
  });

  it("emits the listing as one JSON value under --json", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);

    const list = harnessFor(root, { json: true });
    await runWorkspaceKeep(list.context);
    expect(JSON.parse(list.stdout())).toMatchObject({
      kept: [BOARD],
      path: null,
      changed: false,
    });
  });

  it("reports kept paths in the upgrade's own --json output", async () => {
    const template = makeTemplate();
    const root = await makeWorkspace(template);
    write(root, BOARD, "board custom\n");
    await runWorkspaceKeep(harnessFor(root, { path: BOARD }).context);
    write(template, BOARD_TEMPLATE_PATH, "board v2\n");

    const run = await upgrade(root, template, { json: true });
    const report = JSON.parse(run.stdout()) as UpgradeReport;
    expect(report.kept).toEqual([BOARD]);
    expect(report.changes.map((change) => change.path)).not.toContain(BOARD);
  });
});
