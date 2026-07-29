import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { InternalError, UsageError } from "./errors.js";
import {
  collectStagedDocuments,
  isDocumentPath,
  READ_ONLY_SUBCOMMANDS,
  readStagedContent,
  runReadOnlyGit,
  stagedDocumentPaths,
  STAGED_MAX_BUFFER_BYTES,
  STAGED_TIMEOUT_MS,
} from "./staged.js";
import { makeTempDir, removeTempDirs } from "./testing/temp.js";

/**
 * The whole point of `--staged` is that it reads bytes that are **only** in
 * git's index, so every test here drives a real repository built with real git.
 * A mocked runner would prove the argument strings and nothing about whether
 * `git show :<path>` returns the staged content rather than the working tree's —
 * which is the one thing that could silently be wrong.
 */

const execFileAsync = promisify(execFile);

const git = async (repo: string, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd: repo, encoding: "utf8" });
  return stdout;
};

const write = (repo: string, relative: string, content: string): void => {
  const absolute = join(repo, relative);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
};

const doc = (title: string, body: string): string =>
  `---\nid: doc_a1b2c3\ntype: note\ntitle: ${title}\n---\n\n${body}\n`;

/** A repository with one committed document, so "modified" and "deleted" are expressible. */
async function makeRepo(label: string): Promise<string> {
  const repo = makeTempDir(label);
  await git(repo, "init", "-b", "main");
  write(repo, "data/docs/inbox/kept.md", doc("Kept", "unchanged"));
  write(repo, "data/docs/inbox/edited.md", doc("Edited", "first"));
  write(repo, "data/docs/inbox/removed.md", doc("Removed", "doomed"));
  write(repo, ".gitignore", ".corpus/\n");
  await git(repo, "add", "--all", "--", ".");
  await git(
    repo,
    "-c",
    "user.name=user",
    "-c",
    "user.email=user@corpus.local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "initial",
  );
  return repo;
}

let checkedGit = false;
beforeAll(async () => {
  await execFileAsync("git", ["--version"]);
  checkedGit = true;
});

afterEach(removeTempDirs);

describe("isDocumentPath", () => {
  it("admits every shape the five document roots index", () => {
    expect(isDocumentPath("data/docs/inbox/note.md")).toBe(true);
    expect(isDocumentPath("data/docs/a/b/c/deep.md")).toBe(true);
    expect(isDocumentPath("data/threads/th_x9y8.md")).toBe(true);
    expect(isDocumentPath(".claude/skills/orchestrate/SKILL.md")).toBe(true);
    expect(isDocumentPath(".claude/skills/group/nested/SKILL.md")).toBe(true);
    expect(isDocumentPath(".claude/skills-archived/old/SKILL.md")).toBe(true);
    expect(isDocumentPath(".claude/agents/reviewer.md")).toBe(true);
  });

  it("rejects everything the projection would not index", () => {
    // Not a document root at all.
    expect(isDocumentPath("README.md")).toBe(false);
    expect(isDocumentPath(".gitignore")).toBe(false);
    expect(isDocumentPath(".corpus/config.json")).toBe(false);
    expect(isDocumentPath("data/docs/inbox/image.png")).toBe(false);
    // `markdown-flat` roots do not descend.
    expect(isDocumentPath("data/threads/2026/th_x9y8.md")).toBe(false);
    expect(isDocumentPath(".claude/agents/team/reviewer.md")).toBe(false);
    // A `skill-tree` root indexes `SKILL.md` and nothing beside it.
    expect(isDocumentPath(".claude/skills/orchestrate/NOTES.md")).toBe(false);
    // Dot segments and `node_modules` are skipped, whatever the root.
    expect(isDocumentPath("data/docs/.hidden/note.md")).toBe(false);
    expect(isDocumentPath("data/docs/node_modules/note.md")).toBe(false);
    // A directory, not a file.
    expect(isDocumentPath("data/docs/inbox/")).toBe(false);
  });

  it("normalizes Windows separators before matching", () => {
    expect(isDocumentPath("data\\docs\\inbox\\note.md")).toBe(true);
  });
});

describe("runReadOnlyGit", () => {
  it("refuses any subcommand outside the read-only allowlist", async () => {
    const repo = await makeRepo("readonly");
    for (const forbidden of ["commit", "add", "checkout", "reset", "push"]) {
      await expect(runReadOnlyGit([forbidden], repo)).rejects.toBeInstanceOf(InternalError);
    }
    await expect(runReadOnlyGit([], repo)).rejects.toBeInstanceOf(InternalError);
  });

  it("allows exactly the four read-only queries", () => {
    expect([...READ_ONLY_SUBCOMMANDS]).toEqual(["diff", "show", "status", "rev-parse"]);
  });

  it("sets a buffer ceiling and a deadline rather than taking Node's defaults", () => {
    // execFile's default maxBuffer is 1 MB and it *rejects* past it, which would
    // turn a large staged document into an opaque pre-commit failure.
    expect(STAGED_MAX_BUFFER_BYTES).toBeGreaterThan(1024 * 1024);
    expect(STAGED_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("surfaces git's own stderr as an actionable usage error", async () => {
    const notARepo = makeTempDir("bare");
    await expect(runReadOnlyGit(["status", "--porcelain"], notARepo)).rejects.toBeInstanceOf(
      UsageError,
    );
  });
});

describe("collectStagedDocuments", () => {
  it("collects staged document blobs and nothing else", async () => {
    expect(checkedGit).toBe(true);
    const repo = await makeRepo("matrix");

    // The five-file matrix: a staged addition, a staged modification, a staged
    // deletion, an unstaged modification, and a staged non-document.
    write(repo, "data/docs/inbox/added.md", doc("Added", "brand new"));
    write(repo, "data/docs/inbox/edited.md", doc("Edited", "second"));
    write(repo, ".gitignore", ".corpus/\nnode_modules/\n");
    await git(repo, "rm", "--cached", "--quiet", "data/docs/inbox/removed.md");
    await git(
      repo,
      "add",
      "--",
      "data/docs/inbox/added.md",
      "data/docs/inbox/edited.md",
      ".gitignore",
    );
    write(repo, "data/docs/inbox/kept.md", doc("Kept", "worktree only"));

    const documents = await collectStagedDocuments(repo);

    expect(documents.map((entry) => entry.path)).toEqual([
      "data/docs/inbox/added.md",
      "data/docs/inbox/edited.md",
    ]);
    expect(documents[1]?.content).toBe(doc("Edited", "second"));
  });

  it("reads the index, not the working tree", async () => {
    const repo = await makeRepo("index");
    write(repo, "data/docs/inbox/edited.md", doc("Edited", "staged"));
    await git(repo, "add", "--", "data/docs/inbox/edited.md");
    // Overwrite *after* staging: the two now disagree, and only one is correct.
    write(repo, "data/docs/inbox/edited.md", doc("Edited", "worktree"));

    const [document] = await collectStagedDocuments(repo);

    expect(document?.content).toBe(doc("Edited", "staged"));
    expect(readFileSync(join(repo, "data/docs/inbox/edited.md"), "utf8")).toBe(
      doc("Edited", "worktree"),
    );
  });

  it("changes no git state", async () => {
    const repo = await makeRepo("readonlystate");
    write(repo, "data/docs/inbox/added.md", doc("Added", "new"));
    await git(repo, "add", "--", "data/docs/inbox/added.md");

    const before = await git(repo, "status", "--porcelain");
    const headBefore = await git(repo, "rev-parse", "HEAD");
    await collectStagedDocuments(repo);

    expect(await git(repo, "status", "--porcelain")).toBe(before);
    expect(await git(repo, "rev-parse", "HEAD")).toBe(headBefore);
  });

  it("returns nothing when the index holds no documents", async () => {
    const repo = await makeRepo("clean");
    expect(await collectStagedDocuments(repo)).toEqual([]);

    // A staged non-document is still nothing to check.
    write(repo, ".gitignore", "changed\n");
    await git(repo, "add", "--", ".gitignore");
    expect(await stagedDocumentPaths(repo)).toEqual([]);
  });

  it("handles a blob past execFile's default buffer", async () => {
    const repo = await makeRepo("large");
    const body = "x".repeat(2 * 1024 * 1024);
    write(repo, "data/docs/inbox/large.md", doc("Large", body));
    await git(repo, "add", "--", "data/docs/inbox/large.md");

    const [document] = await collectStagedDocuments(repo);
    expect(document?.content.length).toBeGreaterThan(2 * 1024 * 1024);
  });

  it("keeps paths verbatim through -z, spaces included", async () => {
    const repo = await makeRepo("spaces");
    write(repo, "data/docs/inbox/two words.md", doc("Two words", "spaced"));
    await git(repo, "add", "--", "data/docs/inbox/two words.md");

    expect(await stagedDocumentPaths(repo)).toEqual(["data/docs/inbox/two words.md"]);
    expect(await readStagedContent(repo, "data/docs/inbox/two words.md")).toBe(
      doc("Two words", "spaced"),
    );
  });

  it("accepts an injected reader, so the argument strings are pinned", async () => {
    const calls: string[][] = [];
    const documents = await collectStagedDocuments("/nowhere", (args) => {
      calls.push([...args]);
      return Promise.resolve(
        args[0] === "diff" ? "data/docs/inbox/a.md\0.gitignore\0" : "content of a",
      );
    });

    expect(calls[0]).toEqual(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
    expect(calls[1]).toEqual(["show", ":data/docs/inbox/a.md"]);
    expect(documents).toEqual([{ path: "data/docs/inbox/a.md", content: "content of a" }]);
  });
});
