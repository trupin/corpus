import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolvePluginsRoot, resolveTemplateRoot } from "../../paths.js";
import { planTemplateInstall } from "./template.js";
import {
  generateToken,
  planPluginSkillInstall,
  scaffoldWorkspace,
  templateSkillNames,
} from "./scaffold.js";

/**
 * The plugin-skills half of `corpus init` (SPEC.md §10, sprint-012
 * Adjudication 11): plugin skills copy into `.claude/skills/`, record in the
 * template manifest with a `source: "plugin:<dir>"` marker, and can never
 * replace a core template skill.
 */

const scratch: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `corpus-s012-plugins001-${prefix}-`));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function pluginsRootWith(skills: Record<string, Record<string, string>>): string {
  const root = tempDir("proot");
  for (const [plugin, files] of Object.entries(skills)) {
    for (const [rel, content] of Object.entries(files)) {
      const target = join(root, plugin, "skills", ...rel.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content);
    }
  }
  return root;
}

const RESERVED = new Set(["orchestrate", "comment"]);

describe("planPluginSkillInstall", () => {
  it("returns empty for no root or a plugin without skills", () => {
    expect(planPluginSkillInstall(undefined, RESERVED)).toEqual({ files: [], warnings: [] });
    const root = tempDir("noskills");
    mkdirSync(join(root, "quiet"));
    expect(planPluginSkillInstall(root, RESERVED)).toEqual({ files: [], warnings: [] });
  });

  it("plans every file of every skill into .claude/skills/<name>/", () => {
    const root = pluginsRootWith({
      fx: { "notes/SKILL.md": "# notes\n", "notes/extra/help.md": "help\n" },
    });
    const plan = planPluginSkillInstall(root, RESERVED);
    expect(plan.files).toEqual([
      { plugin: "fx", from: "fx/skills/notes/SKILL.md", to: ".claude/skills/notes/SKILL.md" },
      {
        plugin: "fx",
        from: "fx/skills/notes/extra/help.md",
        to: ".claude/skills/notes/extra/help.md",
      },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("skips a skill colliding with a core template skill, naming the collision", () => {
    const root = pluginsRootWith({ fx: { "orchestrate/SKILL.md": "# hijack\n" } });
    const plan = planPluginSkillInstall(root, RESERVED);
    expect(plan.files).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("orchestrate");
    expect(plan.warnings[0]).toContain("never replace a core skill");
  });

  it("first plugin in directory order wins a cross-plugin collision", () => {
    const root = pluginsRootWith({
      alpha: { "shared/SKILL.md": "# alpha\n" },
      beta: { "shared/SKILL.md": "# beta\n" },
    });
    const plan = planPluginSkillInstall(root, RESERVED);
    expect(plan.files.map((file) => file.plugin)).toEqual(["alpha"]);
    expect(plan.warnings[0]).toContain("beta");
    expect(plan.warnings[0]).toContain("alpha");
  });
});

describe("templateSkillNames", () => {
  it("derives the reserved set from the real template plan", () => {
    const names = templateSkillNames(planTemplateInstall(resolveTemplateRoot()));
    expect(names.has("orchestrate")).toBe(true);
    expect(names.has("comment")).toBe(true);
  });
});

describe("scaffoldWorkspace with a plugins root", () => {
  it("copies plugin skills and records them with a source marker", () => {
    const pluginsRoot = pluginsRootWith({ fx: { "notes/SKILL.md": "# fixture skill\n" } });
    const root = tempDir("ws");
    const result = scaffoldWorkspace({
      root,
      templateRoot: resolveTemplateRoot(),
      pluginsRoot,
      port: 9072,
      token: generateToken(),
      toolVersion: "0.0.0-test",
    });

    expect(result.installedPluginSkills).toEqual([".claude/skills/notes/SKILL.md"]);
    expect(readFileSync(join(root, ".claude", "skills", "notes", "SKILL.md"), "utf8")).toBe(
      "# fixture skill\n",
    );
    // Template skills are untouched beside it.
    expect(readFileSync(join(root, ".claude", "skills", "orchestrate", "SKILL.md"), "utf8")).toBe(
      readFileSync(
        join(resolveTemplateRoot(), "claude", "skills", "orchestrate", "SKILL.md"),
        "utf8",
      ),
    );

    const manifest = JSON.parse(
      readFileSync(join(root, ".corpus", "template-manifest.json"), "utf8"),
    ) as { files: { path: string; sha256: string; source?: string }[] };
    const pluginEntry = manifest.files.find(
      (file) => file.path === ".claude/skills/notes/SKILL.md",
    );
    expect(pluginEntry?.source).toBe("plugin:fx");
    // Template entries keep their original two-key shape (Adjudication 11).
    const templateEntry = manifest.files.find(
      (file) => file.path === ".claude/skills/orchestrate/SKILL.md",
    );
    expect(templateEntry).toBeDefined();
    expect(Object.keys(templateEntry ?? {})).toEqual(["path", "sha256"]);
  });

  it("without a plugins root, behaves exactly as before", () => {
    const root = tempDir("ws-none");
    const result = scaffoldWorkspace({
      root,
      templateRoot: resolveTemplateRoot(),
      port: 9072,
      token: generateToken(),
      toolVersion: "0.0.0-test",
    });
    expect(result.installedPluginSkills).toEqual([]);
    expect(result.pluginWarnings).toEqual([]);
    expect(result.manifest.files.every((file) => file.source === undefined)).toBe(true);
  });
});

describe("resolvePluginsRoot (CLI)", () => {
  const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");

  it("resolves the monorepo dev layout to the repo-root plugins/", () => {
    expect(resolvePluginsRoot({}, join(REPO_ROOT, "apps", "cli"))).toBe(join(REPO_ROOT, "plugins"));
  });

  it("prefers a packaged plugins/ inside the package root", () => {
    const packageRoot = tempDir("pkg");
    mkdirSync(join(packageRoot, "plugins"));
    expect(resolvePluginsRoot({}, packageRoot)).toBe(join(packageRoot, "plugins"));
  });

  it("honours CORPUS_PLUGINS_DIR and returns undefined when nothing exists", () => {
    const explicit = tempDir("explicit");
    expect(resolvePluginsRoot({ CORPUS_PLUGINS_DIR: explicit }, tempDir("pkg2"))).toBe(explicit);
    expect(resolvePluginsRoot({}, join(tempDir("empty"), "pkg"))).toBeUndefined();
  });
});
