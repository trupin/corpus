import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCS_ROOT,
  DOCUMENT_ROOTS,
  classifyPath,
  enumerateDocuments,
  workspaceRelativePath,
} from "./roots.js";

let root: string;
let ws: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-roots-"));
  ws = join(root, "ws");
  mkdirSync(ws, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content = "x"): string {
  const abs = join(ws, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

describe("classifyPath", () => {
  it.each([
    ["data/docs/finance/mortgage.md", "docs"],
    ["data/docs/a.md", "docs"],
    ["data/threads/th_x9y8.md", "threads"],
    [".claude/skills/orchestrate/SKILL.md", "skills"],
    [".claude/skills/vendor/nested/SKILL.md", "skills"],
    [".claude/skills-archived/legacy/SKILL.md", "skills-archived"],
    [".claude/agents/researcher.md", "agents"],
  ])("puts %s under the %s root", (path, key) => {
    expect(classifyPath(path)?.key).toBe(key);
  });

  it.each([
    ["data/docs/notes.txt"],
    ["data/docs/.hidden.md"],
    ["data/docs/node_modules/pkg/README.md"],
    ["README.md"],
    ["data/other/x.md"],
    // Threads are flat by convention (§4); a nested one is not a thread.
    ["data/threads/nested/th_x.md"],
    // Only `SKILL.md` is a skill document; a README beside it is not.
    [".claude/skills/orchestrate/README.md"],
    // Agent definitions are flat.
    [".claude/agents/nested/researcher.md"],
    ["data/docs/"],
  ])("ignores %s", (path) => {
    expect(classifyPath(path)).toBeNull();
  });

  it("forces the type and status each root implies", () => {
    expect(classifyPath("data/threads/th_a.md")?.type).toBe("thread");
    expect(classifyPath(".claude/agents/a.md")?.type).toBe("agent-def");
    expect(classifyPath(".claude/skills/a/SKILL.md")?.type).toBe("skill");
    expect(classifyPath(".claude/skills/a/SKILL.md")?.status).toBeNull();
    expect(classifyPath(".claude/skills-archived/a/SKILL.md")?.status).toBe("archived");
    expect(classifyPath("data/docs/a.md")?.type).toBeNull();
  });

  it("declares exactly the five roots §7 names", () => {
    expect(DOCUMENT_ROOTS.map((entry) => entry.path)).toEqual([
      "data/docs",
      "data/threads",
      ".claude/skills",
      ".claude/skills-archived",
      ".claude/agents",
    ]);
  });

  it("names the corpus root itself, and it is the one in the list", () => {
    // `projection/unindexable.ts` walks this root and classifies against it; a
    // second declaration of `data/docs` is a split-brain waiting to happen.
    expect(DOCS_ROOT.path).toBe("data/docs");
    expect(DOCUMENT_ROOTS[0]).toBe(DOCS_ROOT);
  });
});

describe("workspaceRelativePath", () => {
  it("returns a POSIX path inside the workspace", () => {
    expect(workspaceRelativePath(ws, join(ws, "data", "docs", "a.md"))).toBe("data/docs/a.md");
  });

  it("refuses paths outside the workspace and the root itself", () => {
    expect(workspaceRelativePath(ws, join(root, "elsewhere.md"))).toBeNull();
    expect(workspaceRelativePath(ws, ws)).toBeNull();
  });
});

describe("enumerateDocuments", () => {
  it("finds every root's documents, sorted by workspace-relative path", () => {
    write("data/docs/finance/mortgage.md");
    write("data/docs/inbox/note.md");
    write("data/threads/th_x9y8.md");
    write(".claude/skills/orchestrate/SKILL.md");
    write(".claude/skills-archived/legacy/SKILL.md");
    write(".claude/agents/researcher.md");

    expect(enumerateDocuments(ws).map((file) => file.path)).toEqual([
      ".claude/agents/researcher.md",
      ".claude/skills-archived/legacy/SKILL.md",
      ".claude/skills/orchestrate/SKILL.md",
      "data/docs/finance/mortgage.md",
      "data/docs/inbox/note.md",
      "data/threads/th_x9y8.md",
    ]);
  });

  it("leaves everything outside a root alone", () => {
    write("data/docs/a.md");
    write("data/docs/notes.txt");
    write("data/docs/.hidden.md");
    write("data/docs/.hidden/inside.md");
    write("node_modules/pkg/README.md");
    write("data/docs/node_modules/dep/x.md");
    write("README.md");

    expect(enumerateDocuments(ws).map((file) => file.path)).toEqual(["data/docs/a.md"]);
  });

  it("indexes a symlinked skill exactly once, under its link path", () => {
    write("shared/errands/SKILL.md", "linked skill");
    mkdirSync(join(ws, ".claude", "skills"), { recursive: true });
    symlinkSync(join(ws, "shared", "errands"), join(ws, ".claude", "skills", "errands"), "dir");

    const files = enumerateDocuments(ws);
    expect(files.map((file) => file.path)).toEqual([".claude/skills/errands/SKILL.md"]);
  });

  it("does not loop on a symlink cycle", () => {
    mkdirSync(join(ws, ".claude", "skills", "a"), { recursive: true });
    write(".claude/skills/a/SKILL.md");
    symlinkSync(join(ws, ".claude", "skills"), join(ws, ".claude", "skills", "a", "loop"), "dir");

    expect(enumerateDocuments(ws).map((file) => file.path)).toEqual([".claude/skills/a/SKILL.md"]);
  });

  it("skips a symlink whose target is gone", () => {
    mkdirSync(join(ws, ".claude", "skills"), { recursive: true });
    symlinkSync(join(ws, "nowhere"), join(ws, ".claude", "skills", "dangling"), "dir");
    expect(enumerateDocuments(ws)).toEqual([]);
  });

  it("reports size and mtime for the drift check", () => {
    write("data/docs/a.md", "hello");
    const [file] = enumerateDocuments(ws);
    expect(file?.size).toBe(5);
    expect(file?.mtimeMs).toBeGreaterThan(0);
    expect(Number.isInteger(file?.mtimeMs)).toBe(true);
  });

  it("treats a workspace with no roots at all as empty", () => {
    expect(enumerateDocuments(join(root, "nothing-here"))).toEqual([]);
  });
});
