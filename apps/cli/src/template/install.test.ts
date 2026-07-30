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
  planTemplateInstall,
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
