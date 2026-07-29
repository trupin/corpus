import { describe, expect, it } from "vitest";
import { checkVersions, versionFromGitRef, type ManifestVersion } from "./versions.js";

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
