import { describe, expect, it } from "vitest";
import {
  classifyBumpChanges,
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
