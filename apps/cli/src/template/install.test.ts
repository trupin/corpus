import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALL_FILTERS as CONTRACT_FILTERS,
  INSTALL_RENAMES as CONTRACT_RENAMES,
  TEMPLATE_ROOT,
  installedPath as contractInstalledPath,
  listTemplateFiles as contractListTemplateFiles,
} from "../../../../scripts/workspace-template.js";
import { makeTempDir, removeTempDirs } from "../testing/temp.js";
import {
  INSTALL_FILTERS,
  INSTALL_RENAMES,
  installedPath,
  listTemplateFiles,
  planPluginSeedInstall,
  planTemplateInstall,
  templateSeedNames,
} from "./install.js";

/**
 * `docs/workspace-template.md` is the install contract,
 * `scripts/workspace-template.ts` its machine-readable half (itself pinned to the
 * prose by `scripts/workspace-template.test.ts`), and this module is the copy
 * `corpus init` actually executes. The CLI cannot import the loader at runtime —
 * `scripts/` ships in no tarball — so these tests are what keeps the third copy
 * honest.
 */

afterEach(removeTempDirs);

describe("the install contract", () => {
  it("declares the same renames and filters as the repo-side loader", () => {
    expect(INSTALL_RENAMES).toEqual(CONTRACT_RENAMES);
    expect(INSTALL_FILTERS).toEqual(CONTRACT_FILTERS);
  });

  it("maps every real template path exactly as the loader does", () => {
    const paths = contractListTemplateFiles(TEMPLATE_ROOT);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(installedPath(path) ?? null).toBe(contractInstalledPath(path));
    }
  });

  it("lists the bundled template's files in the same order as the loader", () => {
    expect(listTemplateFiles(TEMPLATE_ROOT)).toEqual(contractListTemplateFiles(TEMPLATE_ROOT));
  });
});

describe("installedPath", () => {
  it("renames the dotless directory and file to their dotted install names", () => {
    expect(installedPath("claude/skills/comment/SKILL.md")).toBe(".claude/skills/comment/SKILL.md");
    expect(installedPath("gitignore")).toBe(".gitignore");
  });

  it("drops .gitkeep at any depth", () => {
    expect(installedPath("data/threads/.gitkeep")).toBeUndefined();
    expect(installedPath("claude/agents/.gitkeep")).toBeUndefined();
  });

  it("leaves every other path untouched", () => {
    expect(installedPath("README.md")).toBe("README.md");
    expect(installedPath("data/docs/views/inbox.md")).toBe("data/docs/views/inbox.md");
  });

  it("does not rename a path that merely starts with a rename's name", () => {
    expect(installedPath("gitignore.sample")).toBe("gitignore.sample");
    expect(installedPath("claudecode/x.md")).toBe("claudecode/x.md");
  });
});

describe("planTemplateInstall", () => {
  it("pairs every surviving template file with its destination", () => {
    const root = makeTempDir("template");
    mkdirSync(join(root, "claude", "skills", "orchestrate"), { recursive: true });
    mkdirSync(join(root, "claude", "agents"), { recursive: true });
    writeFileSync(join(root, "claude", "skills", "orchestrate", "SKILL.md"), "s");
    writeFileSync(join(root, "claude", "agents", ".gitkeep"), "");
    writeFileSync(join(root, "gitignore"), "i");
    writeFileSync(join(root, "README.md"), "r");

    expect(planTemplateInstall(root)).toEqual([
      { from: "README.md", to: "README.md" },
      { from: "claude/skills/orchestrate/SKILL.md", to: ".claude/skills/orchestrate/SKILL.md" },
      { from: "gitignore", to: ".gitignore" },
    ]);
  });
});

/** A plugin tree: `types.yaml` plus whichever seed files the test wants on disk. */
function makePluginTree(
  plugins: Readonly<
    Record<string, { readonly types?: string; readonly seeds?: readonly string[] }>
  >,
): string {
  const root = makeTempDir("plugins");
  for (const [dir, plugin] of Object.entries(plugins)) {
    mkdirSync(join(root, dir), { recursive: true });
    if (plugin.types !== undefined) writeFileSync(join(root, dir, "types.yaml"), plugin.types);
    for (const seed of plugin.seeds ?? []) {
      const absolute = join(root, dir, ...seed.split("/"));
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, `# ${dir} ${seed}\n`);
    }
  }
  return root;
}

const declaring = (seedTemplate: string): string =>
  `types:\n  - type: todo\n    label: Todo\n    seedTemplate: ${seedTemplate}\n`;

describe("planPluginSeedInstall", () => {
  it("installs a declared seed template beside the workspace's own templates", () => {
    const root = makePluginTree({
      todos: { types: declaring("seeds/todo-template.md"), seeds: ["seeds/todo-template.md"] },
    });

    expect(planPluginSeedInstall(root, new Set())).toEqual({
      files: [
        {
          plugin: "todos",
          from: "todos/seeds/todo-template.md",
          to: "data/docs/templates/todo-template.md",
        },
      ],
      warnings: [],
    });
  });

  it("installs nothing for a plugin that declares no seedTemplate, whatever is in seeds/", () => {
    const root = makePluginTree({
      todos: { types: "types:\n  - type: todo\n    label: Todo\n", seeds: ["seeds/stray.md"] },
    });

    expect(planPluginSeedInstall(root, new Set())).toEqual({ files: [], warnings: [] });
  });

  it("is silent about a plugin with no types.yaml at all", () => {
    const root = makePluginTree({ todos: { seeds: ["seeds/todo-template.md"] } });

    expect(planPluginSeedInstall(root, new Set())).toEqual({ files: [], warnings: [] });
  });

  it("warns naming the plugin and the path when the declared file is missing", () => {
    const root = makePluginTree({ todos: { types: declaring("seeds/does-not-exist.md") } });

    const plan = planPluginSeedInstall(root, new Set());
    expect(plan.files).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("todos");
    expect(plan.warnings[0]).toContain("seeds/does-not-exist.md");
  });

  it("lets a core template win a name collision", () => {
    const root = makePluginTree({
      todos: { types: declaring("seeds/note.md"), seeds: ["seeds/note.md"] },
    });

    const plan = planPluginSeedInstall(root, new Set(["note.md"]));
    expect(plan.files).toEqual([]);
    expect(plan.warnings[0]).toContain("can never replace a core template");
  });

  it("gives a collision between two plugins to the first in directory order", () => {
    const root = makePluginTree({
      alpha: { types: declaring("seeds/shared.md"), seeds: ["seeds/shared.md"] },
      beta: { types: declaring("seeds/shared.md"), seeds: ["seeds/shared.md"] },
    });

    const plan = planPluginSeedInstall(root, new Set());
    expect(plan.files.map((file) => file.plugin)).toEqual(["alpha"]);
    expect(plan.warnings[0]).toContain("already installed by plugin alpha");
  });

  it("refuses a declaration that points outside the plugin directory", () => {
    const root = makePluginTree({ todos: { types: declaring("../../etc/passwd") } });

    const plan = planPluginSeedInstall(root, new Set());
    expect(plan.files).toEqual([]);
    expect(plan.warnings[0]).toContain("outside the plugin directory");
  });

  it("warns rather than throwing on a types.yaml it cannot use", () => {
    const root = makePluginTree({
      broken: { types: "types:\n  - seedTemplate: seeds/x.md\n" },
      unparseable: { types: "types: [\n" },
    });

    const plan = planPluginSeedInstall(root, new Set());
    expect(plan.files).toEqual([]);
    expect(plan.warnings).toHaveLength(2);
  });

  it("installs nothing when there is no plugins root", () => {
    expect(planPluginSeedInstall(undefined, new Set())).toEqual({ files: [], warnings: [] });
    expect(planPluginSeedInstall("/nowhere/at/all", new Set())).toEqual({
      files: [],
      warnings: [],
    });
  });

  it("reserves exactly the template's own template documents", () => {
    expect(
      templateSeedNames([
        { from: "data/docs/templates/note.md", to: "data/docs/templates/note.md" },
        { from: "data/docs/views/inbox.md", to: "data/docs/views/inbox.md" },
      ]),
    ).toEqual(new Set(["note.md"]));
  });

  it("installs what the shipped todos plugin declares, whatever that file contains", () => {
    // Deliberately no assertion about the template's *content*: this issue
    // installs whatever the plugin ships (sprint-017 TEST-518), and pinning the
    // body here would couple it to the plugin's own storage work.
    const plan = planPluginSeedInstall(join(import.meta.dirname, "../../../../plugins"), new Set());
    expect(plan.files).toContainEqual({
      plugin: "todos",
      from: "todos/seeds/todo-template.md",
      to: "data/docs/templates/todo-template.md",
    });
  });
});
