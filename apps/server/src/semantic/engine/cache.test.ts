import { describe, expect, it } from "vitest";
import { MODEL_CACHE_DIR_ENV, modelCacheDir, modelCacheRoot } from "./cache.js";
import { EMBEDDED_MODEL } from "./manifest.js";

describe("modelCacheRoot", () => {
  it("follows each platform's own cache convention", () => {
    expect(modelCacheRoot({ env: { HOME: "/Users/x" }, platform: "darwin" })).toBe(
      "/Users/x/Library/Caches/corpus/models",
    );
    expect(modelCacheRoot({ env: { HOME: "/home/x" }, platform: "linux" })).toBe(
      "/home/x/.cache/corpus/models",
    );
    expect(
      modelCacheRoot({ env: { HOME: "/home/x", XDG_CACHE_HOME: "/var/cache" }, platform: "linux" }),
    ).toBe("/var/cache/corpus/models");
    expect(
      modelCacheRoot({ env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, platform: "win32" }),
    ).toBe("C:\\Users\\x\\AppData\\Local\\corpus\\Cache\\models");
    expect(modelCacheRoot({ env: { USERPROFILE: "C:\\Users\\x" }, platform: "win32" })).toBe(
      "C:\\Users\\x\\AppData\\Local\\corpus\\Cache\\models",
    );
  });

  it("lets CORPUS_MODEL_CACHE_DIR override every platform default", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(
        modelCacheRoot({
          env: { [MODEL_CACHE_DIR_ENV]: "/tmp/models", HOME: "/home/x" },
          platform,
        }),
      ).toBe("/tmp/models");
    }
  });

  it("ignores a relative override, which would follow the working directory", () => {
    expect(
      modelCacheRoot({
        env: { [MODEL_CACHE_DIR_ENV]: "models", HOME: "/home/x" },
        platform: "linux",
      }),
    ).toBe("/home/x/.cache/corpus/models");
  });

  it("ignores a relative XDG_CACHE_HOME, which the spec says to treat as unset", () => {
    expect(
      modelCacheRoot({ env: { XDG_CACHE_HOME: "cache", HOME: "/home/x" }, platform: "linux" }),
    ).toBe("/home/x/.cache/corpus/models");
  });

  it("has no answer when the environment names no home at all", () => {
    // This is the shape a test boots a server in (`env: {}`), and the reason it
    // cannot reach a developer's real model cache.
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(modelCacheRoot({ env: {}, platform })).toBeUndefined();
    }
    expect(modelCacheRoot({ env: { HOME: "" }, platform: "linux" })).toBeUndefined();
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
