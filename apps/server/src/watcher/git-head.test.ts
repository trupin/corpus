import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { disableAutoMaintenance } from "../git/index.js";
import { readHeadVersion } from "./git-head.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s007-git-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
}

function initRepo(cwd: string): void {
  git(cwd, "init", "-q");
  disableAutoMaintenance((...args) => {
    git(cwd, ...args);
  });
}

function commitAll(cwd: string, message: string): void {
  git(cwd, "add", "-A");
  git(
    cwd,
    "-c",
    "user.email=test@corpus.local",
    "-c",
    "user.name=Corpus Test",
    "commit",
    "-m",
    message,
  );
}

function writeDoc(workspace: string, relativePath: string, body: string): void {
  const abs = join(workspace, ...relativePath.split("/"));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

describe("readHeadVersion", () => {
  it("returns the committed content, not what is on disk now", () => {
    const workspace = join(root, "ws");
    mkdirSync(workspace, { recursive: true });
    initRepo(workspace);
    writeDoc(workspace, "data/docs/a.md", "---\nid: doc_a\n---\n\ncommitted\n");
    commitAll(workspace, "seed");
    writeDoc(workspace, "data/docs/a.md", "---\nid: doc_a\n---\n\nedited on disk\n");

    expect(readHeadVersion(workspace, "data/docs/a.md")).toBe("---\nid: doc_a\n---\n\ncommitted\n");
  });

  it("answers null for an untracked file", () => {
    const workspace = join(root, "untracked");
    mkdirSync(workspace, { recursive: true });
    initRepo(workspace);
    writeDoc(workspace, "data/docs/a.md", "seed\n");
    commitAll(workspace, "seed");
    writeDoc(workspace, "data/docs/new.md", "brand new\n");

    expect(readHeadVersion(workspace, "data/docs/new.md")).toBeNull();
  });

  it("answers null for a repository with no commits at all", () => {
    const workspace = join(root, "empty-repo");
    mkdirSync(workspace, { recursive: true });
    initRepo(workspace);
    writeDoc(workspace, "data/docs/a.md", "uncommitted\n");

    expect(readHeadVersion(workspace, "data/docs/a.md")).toBeNull();
  });

  it("answers null when the directory is not a repository", () => {
    const workspace = join(root, "no-repo");
    mkdirSync(workspace, { recursive: true });

    expect(readHeadVersion(workspace, "data/docs/a.md")).toBeNull();
  });

  it("resolves the path against the workspace, not the repository root", () => {
    // A workspace nested inside a larger repository is an ordinary setup; the
    // `HEAD:./path` spelling is what makes it correct.
    const repo = join(root, "repo");
    const workspace = join(repo, "nested");
    mkdirSync(workspace, { recursive: true });
    initRepo(repo);
    writeDoc(workspace, "data/docs/a.md", "nested content\n");
    commitAll(repo, "seed");

    expect(readHeadVersion(workspace, "data/docs/a.md")).toBe("nested content\n");
    expect(readHeadVersion(repo, "data/docs/a.md")).toBeNull();
  });
});
