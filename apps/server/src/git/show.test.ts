// The ref-parameterised read, against a real repository.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitizeGitEnv } from "./env.js";
import { createGit, type Git } from "./git.js";
import { listFileRevisions, readVersionAt, resolveRevision } from "./show.js";

let root: string;
let git: Git;

const run = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: root,
    env: sanitizeGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

function commit(path: string, content: string, message: string): string {
  const abs = join(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  run("add", "-A", "--", path);
  run("-c", "user.name=Seed", "-c", "user.email=seed@example.test", "commit", "-m", message);
  return run("rev-parse", "HEAD").trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s013-git-show-"));
  git = createGit(root);
  run("init", "--initial-branch=main");
  run("config", "user.name", "Owner");
  run("config", "user.email", "owner@example.test");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveRevision", () => {
  it("peels a ref to its commit sha", async () => {
    const head = commit("a.md", "one\n", "first");
    await expect(resolveRevision(git, "HEAD")).resolves.toBe(head);
    await expect(resolveRevision(git, head.slice(0, 7))).resolves.toBe(head);

    run("tag", "v1");
    await expect(resolveRevision(git, "v1")).resolves.toBe(head);
  });

  it("answers null for a revision that does not exist", async () => {
    commit("a.md", "one\n", "first");
    await expect(resolveRevision(git, "deadbeefdeadbeef")).resolves.toBeNull();
    await expect(resolveRevision(git, "no-such-branch")).resolves.toBeNull();
  });

  it("never hands git an option-shaped ref", async () => {
    commit("a.md", "one\n", "first");
    // `--git-dir=/etc` would be an option, not a revision, if it were passed
    // through — the answer is a refusal, and git is not invoked at all.
    await expect(resolveRevision(git, "--git-dir=/etc")).resolves.toBeNull();
    await expect(resolveRevision(git, "-HEAD")).resolves.toBeNull();
    await expect(resolveRevision(git, "")).resolves.toBeNull();
  });

  it("answers null outside a repository", async () => {
    const bare = mkdtempSync(join(tmpdir(), "corpus-s013-git-show-bare-"));
    try {
      await expect(resolveRevision(createGit(bare), "HEAD")).resolves.toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("readVersionAt", () => {
  it("reads a path's bytes at a given revision", async () => {
    const first = commit("docs/a.md", "one\n", "first");
    const second = commit("docs/a.md", "two\n", "second");

    await expect(readVersionAt(git, first, "docs/a.md")).resolves.toBe("one\n");
    await expect(readVersionAt(git, second, "docs/a.md")).resolves.toBe("two\n");
  });

  it("answers null for a path absent from that revision", async () => {
    const first = commit("docs/a.md", "one\n", "first");
    commit("docs/b.md", "bee\n", "second");
    await expect(readVersionAt(git, first, "docs/b.md")).resolves.toBeNull();
    await expect(readVersionAt(git, first, "docs/nope.md")).resolves.toBeNull();
  });

  it("preserves the bytes exactly, trailing newline included", async () => {
    const sha = commit("docs/a.md", "line\n\n  indented  \n", "first");
    await expect(readVersionAt(git, sha, "docs/a.md")).resolves.toBe("line\n\n  indented  \n");
  });
});

describe("listFileRevisions", () => {
  it("lists the commits that touched a path, newest first", async () => {
    const first = commit("docs/a.md", "one\n", "first");
    commit("docs/other.md", "unrelated\n", "unrelated");
    const third = commit("docs/a.md", "two\n", "third");

    await expect(listFileRevisions(git, "docs/a.md")).resolves.toEqual([third, first]);
  });

  it("honours its limit", async () => {
    commit("docs/a.md", "one\n", "first");
    commit("docs/a.md", "two\n", "second");
    const third = commit("docs/a.md", "three\n", "third");
    await expect(listFileRevisions(git, "docs/a.md", 1)).resolves.toEqual([third]);
  });

  it("is empty for an untracked path, and outside a repository", async () => {
    commit("docs/a.md", "one\n", "first");
    await expect(listFileRevisions(git, "docs/never.md")).resolves.toEqual([]);

    const bare = mkdtempSync(join(tmpdir(), "corpus-s013-git-show-bare-"));
    try {
      await expect(listFileRevisions(createGit(bare), "docs/a.md")).resolves.toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
