import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTemplateRoot } from "../../paths.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import { WorkspaceConfigSchema } from "../../workspace.js";
import { listTemplateFiles, planTemplateInstall } from "../../template/install.js";
import { sha256 } from "../../template/manifest.js";
import {
  CONFIG_MODE,
  CreatedPaths,
  TOKEN_BYTES,
  WORKSPACE_DIRECTORIES,
  buildConfig,
  existingWorkspaceReason,
  generateToken,
  scaffoldWorkspace,
  unrelatedContentReasons,
} from "./scaffold.js";

afterEach(removeTempDirs);

function scaffold(overrides: { readonly port?: number } = {}): string {
  const root = makeTempDir("scaffold");
  scaffoldWorkspace({
    root,
    templateRoot: resolveTemplateRoot(),
    port: overrides.port ?? 8790,
    token: generateToken(),
    toolVersion: "1.2.3",
    now: new Date("2026-07-26T00:00:00.000Z"),
  });
  return root;
}

describe("generateToken", () => {
  it("is 32 bytes of entropy in base64url, and never repeats", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(TOKEN_BYTES);
    // 43 characters is the base64url length of 32 bytes with no padding.
    expect(token).toHaveLength(43);

    const many = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(many.size).toBe(200);
  });
});

describe("scaffoldWorkspace", () => {
  it("creates every directory SPEC.md §4 lists, including the projection's roots", () => {
    const root = scaffold();
    for (const relative of WORKSPACE_DIRECTORIES) {
      expect(statSync(join(root, ...relative.split("/"))).isDirectory()).toBe(true);
    }
    // The three that exist only because the server indexes them as document
    // roots, and would otherwise never be created (Open Conflict 9).
    for (const relative of [".claude/agents", ".claude/skills-archived", "data/docs/inbox"]) {
      expect(existsSync(join(root, ...relative.split("/")))).toBe(true);
    }
  });

  // The server's own reader is deliberately not imported here — `apps/cli` must
  // not depend on `apps/server` (CLAUDE.md → dependency direction). That both
  // schemas accept the same file is proved end to end instead.
  it("writes a config the CLI's own reader accepts, at mode 600", () => {
    const root = scaffold({ port: 8791 });
    const path = join(root, ".corpus", "config.json");
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

    expect(parsed).toMatchObject({ version: 1, port: 8791, dataDir: "data" });
    expect(WorkspaceConfigSchema.parse(parsed).token).toHaveLength(43);
    expect(statSync(path).mode & 0o777).toBe(CONFIG_MODE);
  });

  it("copies the bundled template byte for byte, renamed and filtered", () => {
    const templateRoot = resolveTemplateRoot();
    const root = scaffold();

    for (const file of planTemplateInstall(templateRoot)) {
      const source = readFileSync(join(templateRoot, ...file.from.split("/")));
      const installed = readFileSync(join(root, ...file.to.split("/")));
      expect(installed.equals(source)).toBe(true);
    }

    expect(existsSync(join(root, ".claude", "skills", "orchestrate", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
    expect(existsSync(join(root, "claude"))).toBe(false);
    expect(existsSync(join(root, "gitignore"))).toBe(false);
  });

  it("copies no .gitkeep from the template, and writes only the queue skeleton's", () => {
    const templateRoot = resolveTemplateRoot();
    expect(
      listTemplateFiles(templateRoot).filter((p) => p.endsWith(".gitkeep")).length,
    ).toBeGreaterThan(0);

    const root = scaffold();
    expect(existsSync(join(root, "data", "threads", ".gitkeep"))).toBe(false);
    expect(existsSync(join(root, ".claude", "agents", ".gitkeep"))).toBe(false);
    for (const status of QUEUE_EVENT_STATUSES) {
      expect(existsSync(join(root, ".corpus", "queue", status, ".gitkeep"))).toBe(true);
    }
  });

  /**
   * CONTRACT-021's consumer gap, pinned: `scaffold.ts` used to carry its own
   * copy of the status list, so adding `deferred` to the contract left a fresh
   * workspace without `.corpus/queue/deferred/` and nothing failed to compile.
   * Asserting against the contract's enum is what makes the next addition loud.
   */
  it("creates one queue directory per status the contract declares, deferred included", () => {
    const root = scaffold();
    const queueDir = join(root, ".corpus", "queue");

    expect(readdirSync(queueDir).sort()).toEqual([...QUEUE_EVENT_STATUSES].sort());
    expect(statSync(join(queueDir, "deferred")).isDirectory()).toBe(true);
    expect(existsSync(join(queueDir, "deferred", ".gitkeep"))).toBe(true);
    expect(WORKSPACE_DIRECTORIES).toContain(".corpus/queue/deferred");
  });

  it("records a manifest of what it installed, hashed and versioned", () => {
    const templateRoot = resolveTemplateRoot();
    const root = scaffold();
    const manifest: unknown = JSON.parse(
      readFileSync(join(root, ".corpus", "template-manifest.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      version: 1,
      tool: "1.2.3",
      installedAt: "2026-07-26T00:00:00.000Z",
    });

    const files = (manifest as { files: { path: string; sha256: string }[] }).files;
    expect(files.map((f) => f.path)).toEqual(planTemplateInstall(templateRoot).map((f) => f.to));
    for (const entry of files) {
      expect(entry.sha256).toBe(sha256(readFileSync(join(root, ...entry.path.split("/")))));
    }
  });
});

describe("buildConfig", () => {
  it("writes only the four canonical keys", () => {
    expect(Object.keys(buildConfig(8765, "t"))).toEqual(["version", "port", "token", "dataDir"]);
  });
});

describe("CreatedPaths", () => {
  it("records only what it actually created", () => {
    const root = makeTempDir("created");
    mkdirSync(join(root, "existing"));
    const created = new CreatedPaths();

    created.mkdir(join(root, "existing"));
    expect(created.entries).toEqual([]);

    created.mkdir(join(root, "a", "b", "c"));
    expect(created.entries.map((e) => e.path)).toEqual([
      join(root, "a"),
      join(root, "a", "b"),
      join(root, "a", "b", "c"),
    ]);
  });

  it("puts the directory back, leaving anything it did not create", () => {
    const root = makeTempDir("unwind");
    mkdirSync(join(root, "mine"));
    writeFileSync(join(root, "mine", "keep.txt"), "keep");

    const created = new CreatedPaths();
    created.mkdir(join(root, "data", "docs"));
    created.writeFile(join(root, "data", "docs", "a.md"), "a");
    created.writeFile(join(root, "top.txt"), "t");
    created.unwind();

    expect(existsSync(join(root, "data"))).toBe(false);
    expect(existsSync(join(root, "top.txt"))).toBe(false);
    expect(readFileSync(join(root, "mine", "keep.txt"), "utf8")).toBe("keep");
    expect(created.entries).toEqual([]);
  });

  it("leaves a directory the operator has since filled", () => {
    const root = makeTempDir("unwind-busy");
    const created = new CreatedPaths();
    created.mkdir(join(root, "data"));
    writeFileSync(join(root, "data", "theirs.md"), "theirs");

    created.unwind();
    expect(existsSync(join(root, "data", "theirs.md"))).toBe(true);
  });

  /**
   * CLI-013, pinned deliberately: `unwind()` deletes, it never restores. An
   * overwritten file is unrecoverable, which is why `runInit` refuses a
   * directory holding unrelated content **before** its first write instead of
   * rolling back afterwards. If this assertion is ever inverted, the guard's
   * ordering is the thing that must be re-proved, not softened.
   */
  it("does NOT restore a file it overwrote — it only records the damage", () => {
    const root = makeTempDir("unwind-overwrite");
    writeFileSync(join(root, "README.md"), "years of my notes");
    writeFileSync(join(root, "seed.md"), "source");

    const created = new CreatedPaths();
    created.writeFile(join(root, "README.md"), "template");
    created.copyFile(join(root, "seed.md"), join(root, "README.md"));
    expect(created.overwritten).toEqual([join(root, "README.md"), join(root, "README.md")]);
    // Nothing was *created*, so unwind has nothing to delete either.
    expect(created.entries).toEqual([]);

    created.unwind();
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("source");
    expect(readFileSync(join(root, "README.md"), "utf8")).not.toBe("years of my notes");
  });

  it("records nothing as overwritten when every write is a new file", () => {
    const root = makeTempDir("unwind-fresh");
    const created = new CreatedPaths();
    created.writeFile(join(root, "a.md"), "a");
    expect(created.overwritten).toEqual([]);
  });

  it("removes a tree it owns outright, recursively", () => {
    const root = makeTempDir("unwind-tree");
    const created = new CreatedPaths();
    mkdirSync(join(root, ".git", "objects"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref");
    created.record(join(root, ".git"), "tree");

    created.unwind();
    expect(existsSync(join(root, ".git"))).toBe(false);
  });
});

describe("existingWorkspaceReason", () => {
  it("is undefined for an empty directory", () => {
    expect(existingWorkspaceReason(makeTempDir("empty"))).toBeUndefined();
  });

  it("names the config when one is present", () => {
    const root = makeTempDir("has-config");
    mkdirSync(join(root, ".corpus"));
    writeFileSync(join(root, ".corpus", "config.json"), "{}");
    expect(existingWorkspaceReason(root)).toContain("config.json");
  });

  it("names a non-empty data directory even with no config", () => {
    const root = makeTempDir("has-data");
    mkdirSync(join(root, "data", "docs"), { recursive: true });
    writeFileSync(join(root, "data", "docs", "note.md"), "n");
    expect(existingWorkspaceReason(root)).toContain("data");
  });

  it("ignores an empty data directory", () => {
    const root = makeTempDir("empty-data");
    mkdirSync(join(root, "data"));
    expect(existingWorkspaceReason(root)).toBeUndefined();
  });
});

describe("unrelatedContentReasons", () => {
  it("is empty for an empty directory outside any repository", () => {
    expect(unrelatedContentReasons(makeTempDir("clear"))).toEqual([]);
  });

  it("is empty for a directory that does not exist yet", () => {
    expect(unrelatedContentReasons(join(makeTempDir("clear-missing"), "new"))).toEqual([]);
  });

  it("counts and names pre-existing entries", () => {
    const root = makeTempDir("entries");
    writeFileSync(join(root, "a.txt"), "a");
    mkdirSync(join(root, "src"));

    expect(unrelatedContentReasons(root)).toEqual(["it already holds 2 entries (a.txt, src)"]);
  });

  it("says entry, singular, for exactly one", () => {
    const root = makeTempDir("one-entry");
    writeFileSync(join(root, "a.txt"), "a");
    expect(unrelatedContentReasons(root)[0]).toBe("it already holds 1 entry (a.txt)");
  });

  it("names at most five entries and summarises the rest", () => {
    const root = makeTempDir("many-entries");
    for (const name of ["a", "b", "c", "d", "e", "f", "g"]) writeFileSync(join(root, name), "x");

    expect(unrelatedContentReasons(root)[0]).toBe(
      "it already holds 7 entries (a, b, c, d, e, and 2 more)",
    );
  });

  it("names a repository at the target distinctly from its entries", () => {
    const root = makeTempDir("repo-target");
    mkdirSync(join(root, ".git"));

    const reasons = unrelatedContentReasons(root);
    expect(reasons[0]).toBe("it is a git repository (.git/)");
    expect(reasons[1]).toContain("1 entry");
  });

  it("names a linked worktree, whose .git is a file", () => {
    const root = makeTempDir("worktree-target");
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/linked\n");

    expect(unrelatedContentReasons(root)[0]).toBe(
      "it is a linked git worktree of another repository (.git file)",
    );
  });

  it("names the enclosing repository even when the target is empty", () => {
    const repo = makeTempDir("enclosing");
    mkdirSync(join(repo, ".git"));
    const inner = join(repo, "sub");
    mkdirSync(inner);

    expect(unrelatedContentReasons(inner)).toEqual([
      `it sits inside the git repository at ${repo}`,
    ]);
  });

  // Adjudication 8: nesting a workspace inside a workspace is confusing, not
  // destructive, and stays the warning `runInit` already emits.
  it("does not treat an enclosing Corpus workspace as evidence", () => {
    const workspace = makeTempDir("enclosing-workspace");
    mkdirSync(join(workspace, ".git"));
    mkdirSync(join(workspace, ".corpus"));
    writeFileSync(join(workspace, ".corpus", "config.json"), "{}");
    const inner = join(workspace, "sub");
    mkdirSync(inner);

    expect(unrelatedContentReasons(inner)).toEqual([]);
  });
});
