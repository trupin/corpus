import { describe, expect, it } from "vitest";
import { MODEL_CACHE_DIR_ENV, modelCacheDir, modelCacheRoot } from "./cache.js";
import { EMBEDDED_MODEL } from "./manifest.js";
import type { CacheLocation } from "./cache.js";

/** The path when there is one, so the platform cases stay one line each. */
const pathOf = (location: CacheLocation): string | undefined => {
  const root = modelCacheRoot(location);
  return root.kind === "root" ? root.path : undefined;
};

describe("modelCacheRoot", () => {
  it("follows each platform's own cache convention", () => {
    expect(pathOf({ env: { HOME: "/Users/x" }, platform: "darwin" })).toBe(
      "/Users/x/Library/Caches/corpus/models",
    );
    expect(pathOf({ env: { HOME: "/home/x" }, platform: "linux" })).toBe(
      "/home/x/.cache/corpus/models",
    );
    expect(
      pathOf({ env: { HOME: "/home/x", XDG_CACHE_HOME: "/var/cache" }, platform: "linux" }),
    ).toBe("/var/cache/corpus/models");
    expect(
      pathOf({ env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, platform: "win32" }),
    ).toBe("C:\\Users\\x\\AppData\\Local\\corpus\\Cache\\models");
    expect(pathOf({ env: { USERPROFILE: "C:\\Users\\x" }, platform: "win32" })).toBe(
      "C:\\Users\\x\\AppData\\Local\\corpus\\Cache\\models",
    );
  });

  it("lets CORPUS_MODEL_CACHE_DIR override every platform default", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(
        pathOf({
          env: { [MODEL_CACHE_DIR_ENV]: "/tmp/models", HOME: "/home/x" },
          platform,
        }),
      ).toBe("/tmp/models");
    }
  });

  it("refuses a relative override rather than falling back to the platform default", () => {
    // PR #17: falling back was silent, and the fallback is the *shared* per-user
    // cache — so an E2E run that set this to force a cold start found a warm one
    // and reported a first-run download it never performed.
    const root = modelCacheRoot({
      env: { [MODEL_CACHE_DIR_ENV]: "models", HOME: "/home/x" },
      platform: "linux",
    });

    expect(root.kind).toBe("unusable");
    expect(root).not.toMatchObject({ path: "/home/x/.cache/corpus/models" });
    if (root.kind !== "unusable") throw new Error("unreachable");
    expect(root.detail).toContain(MODEL_CACHE_DIR_ENV);
    expect(root.detail).toContain("models");
    expect(root.detail).toContain("must be absolute");
  });

  it("refuses a relative override on every platform, by that platform's rules", () => {
    // `C:\…` is absolute on Windows and relative everywhere else, which is why
    // the check follows the *named* platform rather than the running one.
    expect(
      modelCacheRoot({ env: { [MODEL_CACHE_DIR_ENV]: "C:\\models" }, platform: "win32" }),
    ).toEqual({ kind: "root", path: "C:\\models" });
    expect(
      modelCacheRoot({ env: { [MODEL_CACHE_DIR_ENV]: "C:\\models" }, platform: "linux" }).kind,
    ).toBe("unusable");
    expect(
      modelCacheRoot({
        env: { [MODEL_CACHE_DIR_ENV]: "./models", HOME: "/Users/x" },
        platform: "darwin",
      }).kind,
    ).toBe("unusable");
  });

  it("treats an empty override as unset, because that is what an unset variable looks like", () => {
    // `CORPUS_MODEL_CACHE_DIR=` in a shell profile is an absence, not a demand.
    expect(pathOf({ env: { [MODEL_CACHE_DIR_ENV]: "", HOME: "/home/x" }, platform: "linux" })).toBe(
      "/home/x/.cache/corpus/models",
    );
  });

  it("ignores a relative XDG_CACHE_HOME, which the spec says to treat as unset", () => {
    expect(pathOf({ env: { XDG_CACHE_HOME: "cache", HOME: "/home/x" }, platform: "linux" })).toBe(
      "/home/x/.cache/corpus/models",
    );
  });

  it("has no answer when the environment names no home at all", () => {
    // This is the shape a test boots a server in (`env: {}`), and the reason it
    // cannot reach a developer's real model cache.
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(modelCacheRoot({ env: {}, platform })).toEqual({ kind: "unset" });
    }
    expect(modelCacheRoot({ env: { HOME: "" }, platform: "linux" })).toEqual({ kind: "unset" });
  });
});

describe("modelCacheDir", () => {
  it("keys the directory on model and revision, so a bump lands beside the old copy", () => {
    const dir = modelCacheDir("/cache", EMBEDDED_MODEL);
    expect(dir).toBe(`/cache/${EMBEDDED_MODEL.model}@${EMBEDDED_MODEL.revision}`);
    expect(modelCacheDir("/cache", { model: EMBEDDED_MODEL.model, revision: "other" })).not.toBe(
      dir,
    );
  });
});
