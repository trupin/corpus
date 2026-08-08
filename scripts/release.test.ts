import { describe, expect, it } from "vitest";
import {
  classifyBumpChanges,
  classifyLockfileChange,
  expectedBumpPaths,
  parsePorcelainPaths,
  parseReleaseArgs,
  releaseCommitMessage,
  releaseTag,
  releaseTagMessage,
} from "./release.js";

describe("parseReleaseArgs", () => {
  it.each(["0.4.0", "1.0.0", "10.20.30", "0.5.0-rc.1", "1.2.3+build.4"])(
    "accepts %s",
    (version) => {
      expect(parseReleaseArgs([version])).toEqual({ version });
    },
  );

  it.each(["patch", "minor", "major", "v0.4.0", "0.4", "prerelease"])(
    "rejects %s — the tag must be known before anything is written",
    (arg) => {
      const parsed = parseReleaseArgs([arg]);
      expect(parsed).toHaveProperty("error");
    },
  );

  it("rejects an empty invocation with usage", () => {
    const parsed = parseReleaseArgs([]);
    expect("error" in parsed ? parsed.error : "").toContain("usage:");
  });

  it("takes an optional headline", () => {
    expect(parseReleaseArgs(["0.4.0", "forms and the release trap"])).toEqual({
      version: "0.4.0",
      title: "forms and the release trap",
    });
  });

  it("rejects an unquoted headline rather than guessing where it ends", () => {
    const parsed = parseReleaseArgs(["0.4.0", "forms", "and", "the", "release", "trap"]);
    expect("error" in parsed ? parsed.error : "").toContain("quote the title");
  });

  it("ignores flags npm forwards, so `--` noise does not become the version", () => {
    expect(parseReleaseArgs(["--silent", "0.4.0"])).toEqual({ version: "0.4.0" });
  });
});

describe("naming", () => {
  it("tags v-prefixed, which is what release.yml triggers on", () => {
    expect(releaseTag("0.4.0")).toBe("v0.4.0");
  });

  it("writes a bracket-prefixed commit message like every other commit here", () => {
    expect(releaseCommitMessage("0.4.0")).toBe("[RELEASE] v0.4.0");
  });

  it("titles the commit the way the release commits on main already are", () => {
    expect(releaseCommitMessage("0.3.0", "comments that stay where you put them")).toBe(
      "[RELEASE] v0.3.0 — comments that stay where you put them",
    );
  });

  it("titles the tag without the commit prefix", () => {
    expect(releaseTagMessage("0.3.0", "comments that stay where you put them")).toBe(
      "v0.3.0 — comments that stay where you put them",
    );
    expect(releaseTagMessage("0.3.0")).toBe("v0.3.0");
  });
});

describe("expectedBumpPaths", () => {
  it("is the root manifest, the lockfile, and every workspace manifest", () => {
    expect(expectedBumpPaths(["apps/cli/package.json"])).toEqual([
      "package.json",
      "package-lock.json",
      "apps/cli/package.json",
    ]);
  });
});

describe("parsePorcelainPaths", () => {
  it("reads a status listing", () => {
    expect(parsePorcelainPaths(" M package.json\n M apps/cli/package.json\n")).toEqual([
      "package.json",
      "apps/cli/package.json",
    ]);
  });

  it("reads the destination of a rename, so it cannot hide from the guard", () => {
    expect(parsePorcelainPaths("R  old/package.json -> new/package.json")).toEqual([
      "new/package.json",
    ]);
  });

  it("is empty for a clean tree", () => {
    expect(parsePorcelainPaths("")).toEqual([]);
  });
});

describe("classifyBumpChanges", () => {
  const expected = expectedBumpPaths(["apps/cli/package.json", "packages/kit/package.json"]);

  it("stages only what actually changed, in expected order", () => {
    const changes = classifyBumpChanges(["apps/cli/package.json", "package.json"], expected);
    expect(changes.toStage).toEqual(["package.json", "apps/cli/package.json"]);
    expect(changes.unexpected).toEqual([]);
  });

  it("never stages a file the bump was not supposed to touch", () => {
    const changes = classifyBumpChanges(["package.json", "SPEC.md"], expected);
    expect(changes.toStage).toEqual(["package.json"]);
    expect(changes.unexpected).toEqual(["SPEC.md"]);
  });

  it("reports nothing to stage when the version is already what was asked for", () => {
    expect(classifyBumpChanges([], expected).toStage).toEqual([]);
  });
});

describe("classifyLockfileChange", () => {
  /** The shape of a lockfileVersion-3 file, trimmed to what a bump touches. */
  function lock(version: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      name: "corpus",
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "corpus", version, workspaces: ["apps/*"] },
        "apps/cli": { name: "@corpus/cli", version, dependencies: { "@corpus/contract": "*" } },
        "node_modules/type-check": { version: "0.4.0", resolved: "https://example.test/tc.tgz" },
        ...extra,
      },
    });
  }

  it("accepts the version churn a bump is for — root, workspace and every nesting", () => {
    expect(classifyLockfileChange(lock("0.4.0"), lock("0.5.0"), "0.5.0").unexpected).toEqual([]);
  });

  it("leaves an unrelated `version` that happens to match alone", () => {
    // `node_modules/type-check` is 0.4.0 by coincidence and does not move.
    expect(classifyLockfileChange(lock("0.4.0"), lock("0.4.1"), "0.4.1").unexpected).toEqual([]);
  });

  // An entry that appeared or vanished is reported once, at the entry — not once
  // per field inside it, which for a real stale-lockfile repair would bury the
  // reader under thousands of lines saying one thing.
  it("names a dependency the install added while bumping", () => {
    const after = lock("0.5.0", {
      "node_modules/leftpad": { version: "1.0.0", resolved: "https://example.test/lp.tgz" },
    });
    expect(classifyLockfileChange(lock("0.4.0"), after, "0.5.0").unexpected).toEqual([
      'packages["node_modules/leftpad"]',
    ]);
  });

  it("names a dependency the install removed", () => {
    const before = lock("0.4.0", { "node_modules/leftpad": { version: "1.0.0" } });
    expect(classifyLockfileChange(before, lock("0.5.0"), "0.5.0").unexpected).toEqual([
      'packages["node_modules/leftpad"]',
    ]);
  });

  it("catches a resolved-url or integrity rewrite, which no bump produces", () => {
    const after = lock("0.5.0").replace("https://example.test/tc.tgz", "https://evil.test/tc.tgz");
    expect(classifyLockfileChange(lock("0.4.0"), after, "0.5.0").unexpected).toEqual([
      'packages["node_modules/type-check"].resolved',
    ]);
  });

  it("catches a `version` moved to something that is not the release version", () => {
    const after = lock("0.5.0").replace('"@corpus/contract":"*"', '"@corpus/contract":"^0.5.0"');
    expect(classifyLockfileChange(lock("0.4.0"), after, "0.5.0").unexpected).toEqual([
      'packages["apps/cli"].dependencies["@corpus/contract"]',
    ]);
  });

  it("descends into arrays rather than calling the whole list one change", () => {
    const before = lock("0.4.0", { "node_modules/a": { engines: ["node"], version: "1.0.0" } });
    const after = lock("0.5.0", { "node_modules/a": { engines: ["deno"], version: "1.0.0" } });
    expect(classifyLockfileChange(before, after, "0.5.0").unexpected).toEqual([
      'packages["node_modules/a"].engines[0]',
    ]);
  });
});
