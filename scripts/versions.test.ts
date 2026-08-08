import { describe, expect, it } from "vitest";
import {
  checkVersionSources,
  checkVersions,
  versionFromGitRef,
  type ManifestVersion,
  type VersionSource,
} from "./versions.js";

function workspaces(...versions: readonly (string | undefined)[]): ManifestVersion[] {
  return versions.map((version, index) => ({
    path: `apps/w${String(index)}/package.json`,
    version,
  }));
}

const root: ManifestVersion = { path: "package.json", version: "0.4.2" };

describe("checkVersions", () => {
  it("passes when every workspace matches the root", () => {
    const result = checkVersions({ root, workspaces: workspaces("0.4.2", "0.4.2", "0.4.2") });
    expect(result).toEqual({ ok: true, version: "0.4.2", problems: [] });
  });

  it("fails naming the drifted workspace", () => {
    const result = checkVersions({ root, workspaces: workspaces("0.4.2", "0.4.1") });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(["apps/w1/package.json is 0.4.1, expected 0.4.2"]);
  });

  it("fails when a workspace declares no version at all", () => {
    const result = checkVersions({ root, workspaces: workspaces(undefined) });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain('declares no "version"');
  });

  it("fails when the root itself has no version — there is then no single source", () => {
    const result = checkVersions({
      root: { path: "package.json", version: undefined },
      workspaces: workspaces("0.4.2"),
    });
    expect(result.ok).toBe(false);
    expect(result.version).toBeUndefined();
    expect(result.problems).toHaveLength(1);
  });

  it("reports every drifted workspace, not just the first", () => {
    const result = checkVersions({ root, workspaces: workspaces("1.0.0", "0.4.2", "2.0.0") });
    expect(result.problems).toHaveLength(2);
  });
});

describe("versionFromGitRef", () => {
  it.each([
    ["refs/tags/v1.2.3", "1.2.3"],
    ["refs/tags/v0.0.1-rc.1", "0.0.1-rc.1"],
  ])("reads %s as %s", (ref, expected) => {
    expect(versionFromGitRef(ref)).toBe(expected);
  });

  it.each(["refs/heads/main", "refs/tags/nightly", undefined])(
    "ignores %s — only `v` tags are release triggers",
    (ref) => {
      expect(versionFromGitRef(ref)).toBeUndefined();
    },
  );
});

describe("checkVersionSources", () => {
  function source(
    label: string,
    rootVersion: string,
    ...workspaceVersions: string[]
  ): VersionSource {
    return {
      label,
      root: { path: "package.json", version: rootVersion },
      workspaces: workspaces(...workspaceVersions),
    };
  }

  it("passes when every tree is internally consistent", () => {
    const result = checkVersionSources([
      source("working tree", "0.4.2", "0.4.2"),
      source("committed tree (HEAD)", "0.4.2", "0.4.2"),
    ]);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.checks).toEqual([
      { label: "working tree", version: "0.4.2", ok: true },
      { label: "committed tree (HEAD)", version: "0.4.2", ok: true },
    ]);
  });

  it("fails on the committed tree alone — the trap the working tree hides", () => {
    const result = checkVersionSources([
      source("working tree", "0.4.2", "0.4.2"),
      source("committed tree (HEAD)", "0.4.2", "0.4.1"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "committed tree (HEAD): apps/w0/package.json is 0.4.1, expected 0.4.2",
    ]);
  });

  it("says a shared problem once, naming both trees", () => {
    const result = checkVersionSources([
      source("working tree", "0.4.2", "0.4.1"),
      source("committed tree (HEAD)", "0.4.2", "0.4.1"),
    ]);
    expect(result.problems).toEqual([
      "working tree and committed tree (HEAD): apps/w0/package.json is 0.4.1, expected 0.4.2",
    ]);
  });

  it("keeps two different problems apart", () => {
    const result = checkVersionSources([
      source("working tree", "0.4.2", "9.9.9"),
      source("committed tree (HEAD)", "0.4.2", "0.4.1"),
    ]);
    expect(result.problems).toEqual([
      "working tree: apps/w0/package.json is 9.9.9, expected 0.4.2",
      "committed tree (HEAD): apps/w0/package.json is 0.4.1, expected 0.4.2",
    ]);
  });

  it("applies the tag guard to every tree it is given", () => {
    const result = checkVersionSources(
      [source("committed tree (v9.9.9)", "0.4.2", "0.4.2")],
      "refs/tags/v9.9.9",
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("the release tag names 9.9.9");
  });

  it("reports both trees' versions when they differ but each is consistent", () => {
    const result = checkVersionSources([
      source("working tree", "0.5.0", "0.5.0"),
      source("committed tree (HEAD)", "0.4.2", "0.4.2"),
    ]);
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.version)).toEqual(["0.5.0", "0.4.2"]);
  });
});

describe("the tag guard", () => {
  it("refuses a tag that disagrees with the manifest", () => {
    const result = checkVersions({
      root,
      workspaces: workspaces("0.4.2"),
      gitRef: "refs/tags/v9.9.9",
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("the release tag names 9.9.9");
  });

  it("passes when the tag matches", () => {
    const result = checkVersions({
      root,
      workspaces: workspaces("0.4.2"),
      gitRef: "refs/tags/v0.4.2",
    });
    expect(result.ok).toBe(true);
  });

  it("ignores a branch push — only tags gate a release", () => {
    const result = checkVersions({
      root,
      workspaces: workspaces("0.4.2"),
      gitRef: "refs/heads/main",
    });
    expect(result.ok).toBe(true);
  });
});
