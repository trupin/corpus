/**
 * Drives the real `release-prepare.ts` against a scratch repository and asserts
 * the thing the lost v0.4.0 release could not do: the tag's tree passes the
 * version check (INFRA-022).
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVersionSources } from "./versions.js";
import { readCommittedSource } from "./version-sources.js";

const SCRIPT = resolve(import.meta.dirname, "release-prepare.ts");
/**
 * The repo's own `tsx`, by absolute path. `node --import tsx` — how the npm
 * script runs it — resolves `tsx` from the *current* directory, and the current
 * directory here is a scratch repository with no `node_modules`.
 */
const TSX = resolve(import.meta.dirname, "..", "node_modules", ".bin", "tsx");
const MANIFESTS = ["package.json", "apps/cli/package.json", "packages/kit/package.json"] as const;
/** npm + git + a commit; nowhere near vitest's default 5s. */
const SLOW = 60_000;

describe("release:prepare", () => {
  let repo: string;

  function git(...args: readonly string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  function write(path: string, version: string): void {
    const name = path === "package.json" ? "scratch-root" : path.split("/")[1];
    const manifest =
      path === "package.json"
        ? { name, private: true, version, workspaces: ["apps/*", "packages/*"] }
        : { name, private: true, version };
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  function prepare(...args: readonly string[]): SpawnSyncReturns<string> {
    return spawnSync(TSX, [SCRIPT, ...args], {
      cwd: repo,
      encoding: "utf8",
      shell: false,
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "corpus-release-"));
    for (const path of MANIFESTS) write(path, "0.1.0");
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    // A tracked lockfile, so the run has to stage one — the real repo has one
    // and `npm version` rewrites it.
    execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit"], {
      cwd: repo,
      encoding: "utf8",
    });
    git("init", "-q", "-b", "main");
    // Local, not global: this repo is thrown away, and the developer's own
    // identity, hooks and signing config must not decide whether it passes.
    git("config", "user.email", "scratch@example.test");
    git("config", "user.name", "Scratch");
    git("config", "core.hooksPath", "");
    git("config", "commit.gpgsign", "false");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it(
    "leaves a tag whose tree passes the version check",
    () => {
      const run = prepare("0.2.0");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("release:prepare ✓");

      // Nothing left behind: the bump is entirely inside the commit.
      expect(git("status", "--porcelain", "--untracked-files=no")).toBe("");

      // The acceptance criterion, asserted against the tag rather than the tree
      // the run happened to leave on disk.
      const tagged = readCommittedSource(repo, "v0.2.0");
      expect(tagged).toBeDefined();
      const verdict = checkVersionSources(tagged === undefined ? [] : [tagged], "refs/tags/v0.2.0");
      expect(verdict.problems).toEqual([]);
      expect(verdict.checks[0]?.version).toBe("0.2.0");

      expect(git("tag").trim()).toBe("v0.2.0");
      expect(git("rev-parse", "v0.2.0^{commit}")).toBe(git("rev-parse", "HEAD"));
      expect(git("log", "-1", "--pretty=%s").trim()).toBe("[RELEASE] v0.2.0");
    },
    SLOW,
  );

  it(
    "commits every manifest it rewrote, plus the lockfile",
    () => {
      expect(prepare("0.2.0").status).toBe(0);
      const committed = git("show", "--name-only", "--pretty=", "HEAD")
        .split("\n")
        .filter((line) => line !== "")
        .sort();
      expect(committed).toEqual([...MANIFESTS, "package-lock.json"].sort());
    },
    SLOW,
  );

  it(
    "carries an optional headline into the commit and the annotated tag",
    () => {
      expect(prepare("0.2.0", "the release trap").status).toBe(0);
      expect(git("log", "-1", "--pretty=%s").trim()).toBe("[RELEASE] v0.2.0 — the release trap");
      expect(git("tag", "-l", "--format=%(contents:subject)", "v0.2.0").trim()).toBe(
        "v0.2.0 — the release trap",
      );
    },
    SLOW,
  );

  it(
    "pushes nothing and says so",
    () => {
      const run = prepare("0.2.0");
      expect(run.stdout).toContain("Nothing has been pushed");
      expect(run.stdout).toContain("git push origin v0.2.0");
    },
    SLOW,
  );

  it("refuses a dirty tree instead of sweeping it into the release commit", () => {
    writeFileSync(join(repo, "package.json"), '{"name":"scratch-root","version":"0.1.0"}\n');
    const run = prepare("0.2.0");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("uncommitted changes");
    expect(git("tag").trim()).toBe("");
  });

  it("refuses when the tag already exists", () => {
    git("tag", "v0.2.0");
    const run = prepare("0.2.0");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("already exists");
    expect(run.stderr).toContain("docs/RELEASING.md");
    // Untouched: the precondition ran before anything was written.
    expect(git("status", "--porcelain", "--untracked-files=no")).toBe("");
  });

  it("refuses a keyword bump, whose tag name is unknowable up front", () => {
    const run = prepare("patch");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("not an explicit version");
  });

  /**
   * A hook that fails is how the real pre-commit gate fails: `git commit`
   * returns non-zero after everything has been bumped and staged. Nothing here
   * is a stand-in for the gate's *checks* — only for its verdict.
   */
  function installFailingPreCommit(): void {
    const hooks = join(repo, ".hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(
      join(hooks, "pre-commit"),
      "#!/bin/sh\necho 'pre-commit: typecheck failed' >&2\nexit 1\n",
    );
    chmodSync(join(hooks, "pre-commit"), 0o755);
    git("config", "core.hooksPath", ".hooks");
  }

  function versionOf(path: string): unknown {
    const manifest: unknown = JSON.parse(readFileSync(join(repo, path), "utf8"));
    return (manifest as { version?: unknown }).version;
  }

  describe("when the gate rejects the release commit", () => {
    // The likeliest failure there is, and the one least often rehearsed. Left
    // alone it reproduces INFRA-022 exactly: every manifest bumped and staged,
    // no commit, no tag — and the only obvious next move is a hand-made commit
    // with the wrong subject and no tag.
    it(
      "leaves the tree exactly as it found it",
      () => {
        installFailingPreCommit();
        const run = prepare("0.2.0");

        expect(run.status).toBe(1);
        expect(run.stderr).toContain("the release commit failed");
        expect(run.stderr).toContain("the bump was undone");
        expect(run.stderr).toContain("npm run release:prepare 0.2.0");

        expect(git("status", "--porcelain", "--untracked-files=no")).toBe("");
        for (const path of MANIFESTS) expect(versionOf(path)).toBe("0.1.0");
        expect(git("tag").trim()).toBe("");
        expect(
          git("log", "--oneline")
            .split("\n")
            .filter((line) => line !== ""),
        ).toHaveLength(1);
      },
      SLOW,
    );

    it(
      "leaves a retry that just works, rather than a dirty-tree refusal",
      () => {
        installFailingPreCommit();
        expect(prepare("0.2.0").status).toBe(1);

        // The reason unwinding beats a hint: the second run is the *first* run.
        git("config", "core.hooksPath", "");
        const retry = prepare("0.2.0");
        expect(retry.stderr).not.toContain("uncommitted changes");
        expect(retry.status).toBe(0);
        expect(git("tag").trim()).toBe("v0.2.0");
        expect(git("rev-parse", "v0.2.0^{commit}")).toBe(git("rev-parse", "HEAD"));
      },
      SLOW,
    );
  });

  it(
    "refuses a lockfile that changed beyond the bump, rather than shipping the repair unread",
    () => {
      // A lockfile that has drifted from the manifests: `npm version` runs an
      // install, the install prunes this, and the pruning would otherwise ride
      // into a commit whose subject promises a version bump and nothing else.
      const lock: unknown = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8"));
      (lock as { packages: Record<string, unknown> }).packages["node_modules/leftpad"] = {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/leftpad/-/leftpad-1.0.0.tgz",
      };
      writeFileSync(join(repo, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
      git("add", "--", "package-lock.json");
      git("commit", "-qm", "a lockfile that drifted from the manifests");

      const run = prepare("0.2.0");
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("package-lock.json changed beyond the version bump");
      expect(run.stderr).toContain('packages["node_modules/leftpad"]');
      expect(run.stderr).toContain("npm install");

      // And, as everywhere before the commit: nothing left behind.
      expect(git("status", "--porcelain", "--untracked-files=no")).toBe("");
      expect(versionOf("package.json")).toBe("0.1.0");
      expect(git("tag").trim()).toBe("");
    },
    SLOW,
  );

  it("refuses a workspaces glob it cannot resolve, before writing anything", () => {
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify(
        {
          name: "scratch-root",
          private: true,
          version: "0.1.0",
          workspaces: ["apps/*", "packages/*", "plugins/**"],
        },
        null,
        2,
      )}\n`,
    );
    git("add", "--", "package.json");
    git("commit", "-qm", "declare a glob the version guard does not resolve");

    const run = prepare("0.2.0");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("plugins/**");
    expect(run.stderr).toContain("neither staged nor version-checked");
    expect(git("status", "--porcelain", "--untracked-files=no")).toBe("");
    expect(versionOf("package.json")).toBe("0.1.0");
  });

  it(
    "does not tag a second time when there is no bump left to make",
    () => {
      expect(prepare("0.2.0").status).toBe(0);
      git("tag", "-d", "v0.2.0");

      // `npm version` itself refuses an unchanged version, so the run stops at
      // the bump — before any commit, and long before a tag.
      const again = prepare("0.2.0");
      expect(again.status).toBe(1);
      expect(git("tag").trim()).toBe("");
      expect(
        git("log", "--oneline")
          .split("\n")
          .filter((line) => line !== ""),
      ).toHaveLength(2);
    },
    SLOW,
  );
});
