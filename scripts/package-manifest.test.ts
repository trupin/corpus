import { describe, expect, it } from "vitest";
import {
  assertNoDevDependencyLeak,
  buildPublishManifest,
  CLI_BUNDLE_PATH,
  NODE_ENGINE_RANGE,
  PACKAGE_BIN_NAME,
  PACKAGE_FILES,
  PACKAGE_LICENSE,
  PACKAGE_NAME,
  packageNameFromSpecifier,
  PackagingError,
  resolveRuntimeDependencies,
  type DeclaredDependencies,
} from "./package-manifest.js";

const declared: readonly DeclaredDependencies[] = [
  {
    workspace: "apps/cli/package.json",
    dependencies: { "@corpus/contract": "*", zod: "^4.4.3" },
  },
  {
    workspace: "apps/server/package.json",
    dependencies: {
      "@hono/node-server": "^2.0.12",
      "better-sqlite3": "^12.4.1",
      hono: "^4.12.32",
      zod: "^4.4.3",
    },
  },
];

describe("packageNameFromSpecifier", () => {
  it.each([
    ["hono", "hono"],
    ["hono/streaming", "hono"],
    ["@hono/node-server", "@hono/node-server"],
    ["@hono/node-server/serve-static", "@hono/node-server"],
  ])("maps %s to %s", (specifier, expected) => {
    expect(packageNameFromSpecifier(specifier)).toBe(expected);
  });

  it.each(["node:fs", "node:fs/promises", "fs", "path"])("treats %s as a builtin", (specifier) => {
    expect(packageNameFromSpecifier(specifier)).toBeUndefined();
  });

  it("refuses a relative specifier — those are never externalised", () => {
    expect(() => packageNameFromSpecifier("./run.js")).toThrow(PackagingError);
  });
});

describe("resolveRuntimeDependencies", () => {
  it("takes each range from the workspace that declares it, builtins dropped", () => {
    expect(
      resolveRuntimeDependencies(
        ["zod", "hono/streaming", "@hono/node-server/serve-static", "node:fs", "better-sqlite3"],
        declared,
      ),
    ).toEqual({
      "@hono/node-server": "^2.0.12",
      "better-sqlite3": "^12.4.1",
      hono: "^4.12.32",
      zod: "^4.4.3",
    });
  });

  it("never emits a `@corpus/*` dependency — first-party code is inlined", () => {
    const resolved = resolveRuntimeDependencies(["zod"], declared);
    expect(Object.keys(resolved).some((name) => name.startsWith("@corpus/"))).toBe(false);
  });

  it("fails loudly on an import no workspace declares", () => {
    expect(() => resolveRuntimeDependencies(["left-pad"], declared)).toThrow(
      /no workspace declares it/,
    );
  });

  it("fails when two workspaces disagree on a range — one tool, one version", () => {
    const conflicting: readonly DeclaredDependencies[] = [
      { workspace: "a/package.json", dependencies: { zod: "^4.4.3" } },
      { workspace: "b/package.json", dependencies: { zod: "^3.0.0" } },
    ];
    expect(() => resolveRuntimeDependencies(["zod"], conflicting)).toThrow(/disagree/);
  });
});

describe("the dev-dependency leak guard", () => {
  it.each(["tsx", "vitest", "eslint", "playwright", "@playwright/test"])(
    "rejects %s as a runtime dependency",
    (name) => {
      expect(() => assertNoDevDependencyLeak({ [name]: "^1.0.0" })).toThrow(PackagingError);
    },
  );

  it("passes a clean set", () => {
    expect(() => assertNoDevDependencyLeak({ hono: "^4.12.32" })).not.toThrow();
  });
});

describe("buildPublishManifest", () => {
  const manifest = buildPublishManifest({ version: "1.2.3", dependencies: { zod: "^4.4.3" } });

  it("carries every field a published package needs", () => {
    expect(manifest.name).toBe(PACKAGE_NAME);
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.license).toBe(PACKAGE_LICENSE);
    expect(manifest.repository.url).toContain("github.com/trupin/corpus");
    expect(manifest.engines.node).toBe(NODE_ENGINE_RANGE);
    expect(manifest.bin[PACKAGE_BIN_NAME]).toBe(`./${CLI_BUNDLE_PATH}`);
    expect(manifest.files).toEqual([...PACKAGE_FILES]);
    expect(manifest.publishConfig.access).toBe("public");
    expect(manifest.type).toBe("module");
  });

  it("is not private — a `private: true` manifest silently refuses to publish", () => {
    expect(Object.keys(manifest)).not.toContain("private");
  });

  it("names the bin `corpus` whatever the package ends up being called", () => {
    expect(PACKAGE_BIN_NAME).toBe("corpus");
  });

  it("refuses to build a manifest carrying a dev dependency", () => {
    expect(() => buildPublishManifest({ version: "1.0.0", dependencies: { tsx: "^4" } })).toThrow(
      PackagingError,
    );
  });
});
