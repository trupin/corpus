/**
 * Pins the working-tree/committed-tree split in both directions (INFRA-022):
 * a committed bump passes, a working-tree-only bump fails. The second is the
 * regression — it passed before this existed, and the release it let through
 * died on CI.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVersionSources } from "./versions.js";
import {
  isSupportedWorkspaceGlob,
  readCommittedSource,
  readWorkingTreeSource,
  selectWorkspaceManifests,
} from "./version-sources.js";

describe("selectWorkspaceManifests", () => {
  const globs = ["apps/*", "packages/*", "tools/solo"];

  it("selects one level below a glob's parent", () => {
    expect(
      selectWorkspaceManifests(globs, ["apps/cli/package.json", "packages/kit/package.json"])
        .selected,
    ).toEqual(["apps/cli/package.json", "packages/kit/package.json"]);
  });

  it("ignores a nested package.json — a dependency of a workspace is not a workspace", () => {
    expect(
      selectWorkspaceManifests(globs, ["apps/cli/node_modules/dep/package.json"]).selected,
    ).toEqual([]);
  });

  it("selects a non-glob workspace entry by exact path", () => {
    expect(selectWorkspaceManifests(globs, ["tools/solo/package.json"]).selected).toEqual([
      "tools/solo/package.json",
    ]);
  });

  it("ignores paths outside every glob", () => {
    expect(selectWorkspaceManifests(globs, ["scripts/package.json"]).selected).toEqual([]);
  });

  it("reports every supported glob as supported", () => {
    expect(globs.every(isSupportedWorkspaceGlob)).toBe(true);
  });

  // The point of the whole `unsupported` channel: npm accepts these, this
  // selector does not resolve them, and the difference must be loud.
  it.each(["plugins/**", "apps/{cli,server}", "!plugins/_fixture", "apps/pkg-*", "*"])(
    "reports %s as unsupported rather than silently selecting nothing",
    (glob) => {
      expect(isSupportedWorkspaceGlob(glob)).toBe(false);
      const selection = selectWorkspaceManifests([glob], ["plugins/todos/package.json"]);
      expect(selection.selected).toEqual([]);
      expect(selection.unsupported).toEqual([glob]);
    },
  );

  it("keeps resolving the globs it understands alongside one it does not", () => {
    const selection = selectWorkspaceManifests(
      ["apps/*", "plugins/**"],
      ["apps/cli/package.json", "plugins/todos/package.json"],
    );
    expect(selection.selected).toEqual(["apps/cli/package.json"]);
    expect(selection.unsupported).toEqual(["plugins/**"]);
  });
});

const MANIFESTS = ["package.json", "apps/cli/package.json", "packages/kit/package.json"] as const;

describe("reading a real repository", () => {
  let repo: string;

  function git(...args: readonly string[]): string {
    return execFileSync(
      "git",
      // Insulated from whatever the developer running the suite has configured
      // globally: a hooks path, a signing key or a missing identity would all
      // fail a commit that has nothing to do with this test.
      ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args],
      { cwd: repo, encoding: "utf8" },
    );
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

  function writeAll(version: string): void {
    for (const path of MANIFESTS) write(path, version);
  }

  function check(): ReturnType<typeof checkVersionSources> {
    const committed = readCommittedSource(repo);
    const working = readWorkingTreeSource(repo);
    return checkVersionSources(committed === undefined ? [working] : [working, committed]);
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "corpus-versions-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "scratch@example.test");
    git("config", "user.name", "Scratch");
    writeAll("0.1.0");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes when the bump is committed everywhere", () => {
    writeAll("0.2.0");
    git("add", "-A");
    git("commit", "-qm", "bump");

    const result = check();
    expect(result.ok).toBe(true);
    expect(result.checks.map((entry) => entry.label)).toEqual([
      "working tree",
      "committed tree (HEAD)",
    ]);
    expect(result.checks.every((entry) => entry.version === "0.2.0")).toBe(true);
  });

  it("fails when only the root manifest was committed — the INFRA-022 release trap", () => {
    // Exactly what `npm version <x> --workspaces --include-workspace-root`
    // leaves behind: every manifest rewritten, only the root one committed.
    writeAll("0.2.0");
    git("add", "--", "package.json");
    git("commit", "-qm", "0.2.0");

    const working = readWorkingTreeSource(repo);
    const committed = readCommittedSource(repo);
    expect(committed).toBeDefined();

    // The old check read this alone, and passed.
    expect(checkVersionSources([working]).ok).toBe(true);

    const result = check();
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "committed tree (HEAD): apps/cli/package.json is 0.1.0, expected 0.2.0",
      "committed tree (HEAD): packages/kit/package.json is 0.1.0, expected 0.2.0",
    ]);
  });

  it("fails on an uncommitted drift too — the working tree is still checked", () => {
    write("apps/cli/package.json", "9.9.9");
    const result = check();
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "working tree: apps/cli/package.json is 9.9.9, expected 0.1.0",
    ]);
  });

  it("says a problem once, naming both trees, when both carry it", () => {
    write("apps/cli/package.json", "9.9.9");
    git("add", "-A");
    git("commit", "-qm", "drift");

    const result = check();
    expect(result.problems).toEqual([
      "working tree and committed tree (HEAD): apps/cli/package.json is 9.9.9, expected 0.1.0",
    ]);
  });

  it("reads a tag's tree, which is what a release actually publishes", () => {
    writeAll("0.2.0");
    git("add", "-A");
    git("commit", "-qm", "bump");
    git("tag", "-a", "v0.2.0", "-m", "v0.2.0");

    const tagged = readCommittedSource(repo, "v0.2.0");
    expect(tagged?.label).toBe("committed tree (v0.2.0)");
    expect(checkVersionSources(tagged === undefined ? [] : [tagged], "refs/tags/v0.2.0").ok).toBe(
      true,
    );
  });

  it("ignores a workspace that exists on disk but is not committed yet", () => {
    write("apps/new/package.json", "0.1.0");
    const committed = readCommittedSource(repo);
    expect(committed?.workspaces.map((manifest) => manifest.path)).toEqual([
      "apps/cli/package.json",
      "packages/kit/package.json",
    ]);
    expect(check().ok).toBe(true);
  });

  it("fails the check on a glob it cannot resolve, instead of covering less than it claims", () => {
    // A drifted workspace *inside* the unresolvable glob: the old selector
    // returned nothing for `plugins/**` and the check went green over it.
    write("plugins/todos/package.json", "9.9.9");
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
    git("add", "-A");
    git("commit", "-qm", "add a plugins workspace under a glob form we do not resolve");

    const result = check();
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      'working tree and committed tree (HEAD): the workspaces glob "plugins/**" is not a form ' +
        "this check resolves, so any workspace it selects is unchecked — declare it as an exact " +
        "path or `<dir>/*`, or teach scripts/version-sources.ts the form",
    ]);
    // And it is not a false alarm: the workspace really was going unchecked.
    expect(readWorkingTreeSource(repo).workspaces.map((manifest) => manifest.path)).not.toContain(
      "plugins/todos/package.json",
    );
  });

  it("returns undefined outside a repository, rather than pretending the tree passed", () => {
    const bare = mkdtempSync(join(tmpdir(), "corpus-nogit-"));
    try {
      writeFileSync(join(bare, "package.json"), '{"name":"x","version":"1.0.0"}\n');
      expect(readCommittedSource(bare)).toBeUndefined();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
