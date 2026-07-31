import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalError, UsageError } from "../../errors.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import {
  DEFAULT_BRANCH,
  USER_IDENTITY,
  commitAll,
  enclosingRepositoryRoot,
  gitFailure,
  initRepository,
  isRepositoryRoot,
  requireGit,
  runGit,
  type GitRunner,
} from "./git.js";

afterEach(() => {
  removeTempDirs();
  vi.unstubAllEnvs();
});

function recordingGit(): { git: GitRunner; calls: readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    git: (args) => {
      calls.push(args);
      return Promise.resolve({ stdout: "", stderr: "" });
    },
  };
}

describe("requireGit", () => {
  it("returns the real git version", async () => {
    expect(await requireGit(runGit, makeTempDir("git-probe"))).toMatch(/^git version /);
  });

  it("turns a missing binary into an actionable usage error", async () => {
    const failing: GitRunner = () => Promise.reject(new Error("spawn git ENOENT"));
    const error = await requireGit(failing).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain("`git` was not found on PATH");
    expect((error as UsageError).hint).toContain("Install git");
  });
});

describe("isRepositoryRoot", () => {
  it("is true only for the directory that holds .git", async () => {
    const root = makeTempDir("repo-root");
    expect(isRepositoryRoot(root)).toBe(false);

    await initRepository(root);
    expect(isRepositoryRoot(root)).toBe(true);

    // A subdirectory of a repository is not itself a repository: initializing a
    // workspace there must create its own, not commit into its parent's.
    const nested = join(root, "nested");
    mkdirSync(nested);
    expect(isRepositoryRoot(nested)).toBe(false);
  });
});

describe("enclosingRepositoryRoot", () => {
  it("finds the nearest ancestor that is a repository root", async () => {
    const root = makeTempDir("enclosing-root");
    const deep = join(root, "a", "b");
    mkdirSync(deep, { recursive: true });
    expect(enclosingRepositoryRoot(deep)).toBeUndefined();

    await initRepository(root);
    expect(enclosingRepositoryRoot(deep)).toBe(root);
    // The directory itself counts, which is what makes `init`'s target check and
    // its ancestor check two separate questions rather than one.
    expect(enclosingRepositoryRoot(root)).toBe(root);

    await initRepository(join(root, "a"));
    expect(enclosingRepositoryRoot(deep)).toBe(join(root, "a"));
  });

  it("gives up at the filesystem root rather than looping", () => {
    expect(enclosingRepositoryRoot(makeTempDir("enclosing-none"))).toBeUndefined();
  });
});

describe("initRepository", () => {
  it("creates a repository on the default branch, whatever the operator's git default is", async () => {
    const root = makeTempDir("git-init");
    await initRepository(root);
    // `symbolic-ref`, not `rev-parse`: a repository with no commits yet has no
    // resolvable HEAD, and the branch is exactly what is being asserted.
    const { stdout } = await runGit(["symbolic-ref", "--short", "HEAD"], root);
    expect(stdout.trim()).toBe(DEFAULT_BRANCH);
  });
});

describe("commitAll", () => {
  it("stages everything, then commits with the identity passed as -c", async () => {
    const { git, calls } = recordingGit();
    await commitAll({ dir: "/ws", message: "hello", git });

    expect(calls[0]).toEqual(["add", "--all", "--", "."]);
    // `-c` rather than `git config`, so the new repository inherits nothing the
    // operator's own later commits would then be attributed with.
    expect(calls[1]).toEqual([
      "-c",
      `user.name=${USER_IDENTITY.name}`,
      "-c",
      `user.email=${USER_IDENTITY.email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "hello",
    ]);
  });

  it("commits for real, attributing author and committer regardless of global config", async () => {
    const root = makeTempDir("git-commit");
    await initRepository(root);
    writeFileSync(join(root, "README.md"), "hello\n");
    await commitAll({ dir: root, message: "workspace: initialize" });

    const { stdout } = await runGit(["log", "--format=%an <%ae>|%cn <%ce>|%s"], root);
    expect(stdout.trim()).toBe(
      `${USER_IDENTITY.name} <${USER_IDENTITY.email}>|${USER_IDENTITY.name} <${USER_IDENTITY.email}>|workspace: initialize`,
    );
  });
});

describe("git invocations under a hostile environment", () => {
  /**
   * Regression (found by the repo's own pre-commit hook, which runs this suite):
   * git exports GIT_DIR, GIT_INDEX_FILE, GIT_AUTHOR_* and friends to the hooks it
   * runs, so `corpus init` from inside a hook used to scaffold and commit into
   * *that* repository under *that* identity.
   */
  function stubHostileGitEnv(foreignRepo: string): void {
    vi.stubEnv("GIT_DIR", join(foreignRepo, ".git"));
    vi.stubEnv("GIT_WORK_TREE", foreignRepo);
    vi.stubEnv("GIT_INDEX_FILE", join(foreignRepo, ".git", "index"));
    vi.stubEnv("GIT_OBJECT_DIRECTORY", join(foreignRepo, ".git", "objects"));
    vi.stubEnv("GIT_AUTHOR_NAME", "Hook Leak");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "leak@hook.invalid");
    vi.stubEnv("GIT_COMMITTER_NAME", "Hook Leak");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "leak@hook.invalid");
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "Hook Config");
  }

  it("scaffolds and commits into the workspace, not the repository the environment names", async () => {
    const foreign = makeTempDir("hostile-foreign");
    await initRepository(foreign);
    const root = makeTempDir("hostile-workspace");

    stubHostileGitEnv(foreign);

    await initRepository(root);
    expect(isRepositoryRoot(root)).toBe(true);

    writeFileSync(join(root, "README.md"), "hello\n");
    await commitAll({ dir: root, message: "workspace: initialize" });

    const { stdout } = await runGit(["log", "--format=%an <%ae>|%cn <%ce>|%s"], root);
    expect(stdout.trim()).toBe(
      `${USER_IDENTITY.name} <${USER_IDENTITY.email}>|${USER_IDENTITY.name} <${USER_IDENTITY.email}>|workspace: initialize`,
    );

    // The repository the environment pointed at must be exactly as it was left.
    const foreignCommits = await runGit(["rev-list", "--count", "--all"], foreign);
    expect(foreignCommits.stdout.trim()).toBe("0");
  });
});

describe("gitFailure", () => {
  it("surfaces git's own stderr, which is the actionable part", () => {
    const error = gitFailure("git init", { stderr: "fatal: not a directory\n" });
    expect(error).toBeInstanceOf(InternalError);
    expect(error.message).toBe("git init failed: fatal: not a directory");
  });

  it("falls back to the error message, then to the value", () => {
    expect(gitFailure("commit", new Error("boom")).message).toBe("commit failed: boom");
    expect(gitFailure("commit", "odd").message).toBe("commit failed: odd");
    expect(gitFailure("commit", { stderr: "" }).message).toBe(
      "commit failed: git reported no detail",
    );
  });
});
