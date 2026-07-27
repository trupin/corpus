import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InternalError } from "./errors.js";
import {
  corpusDir,
  resolveTemplateRoot,
  serverLogPath,
  serverPidfilePath,
  templateManifestPath,
  templateRootCandidates,
} from "./paths.js";
import { makeTempDir, removeTempDirs } from "./testing/temp.js";
import { cliPackageRoot } from "./version.js";

afterEach(removeTempDirs);

describe("workspace paths", () => {
  it("puts the CLI's own two files, and the manifest, under .corpus", () => {
    expect(corpusDir("/ws")).toBe(join("/ws", ".corpus"));
    expect(serverPidfilePath("/ws")).toBe(join("/ws", ".corpus", "server.pid"));
    expect(serverLogPath("/ws")).toBe(join("/ws", ".corpus", "server.log"));
    expect(templateManifestPath("/ws")).toBe(join("/ws", ".corpus", "template-manifest.json"));
  });
});

describe("resolveTemplateRoot", () => {
  it("finds the bundled template from this checkout", () => {
    const root = resolveTemplateRoot();
    expect(existsSync(join(root, "gitignore"))).toBe(true);
    expect(existsSync(join(root, "claude", "skills"))).toBe(true);
  });

  it("prefers the packaged layout over the repository layout", () => {
    const packageRoot = makeTempDir("template-packaged");
    mkdirSync(join(packageRoot, "assets", "workspace"), { recursive: true });
    expect(resolveTemplateRoot(packageRoot)).toBe(join(packageRoot, "assets", "workspace"));
  });

  it("falls back to the repository layout two levels up", () => {
    const repo = makeTempDir("template-repo");
    const packageRoot = join(repo, "apps", "cli");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(join(repo, "assets", "workspace"), { recursive: true });
    expect(resolveTemplateRoot(packageRoot)).toBe(join(repo, "assets", "workspace"));
  });

  it("names both candidates when the installation is broken", () => {
    const packageRoot = makeTempDir("template-missing");
    let thrown: unknown;
    try {
      resolveTemplateRoot(packageRoot);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InternalError);
    expect((thrown as InternalError).details).toEqual({
      searched: templateRootCandidates(packageRoot),
    });
    expect(templateRootCandidates(packageRoot)).toHaveLength(2);
  });
});

describe("cliPackageRoot", () => {
  it("resolves to the package that holds this CLI's manifest", () => {
    expect(existsSync(join(cliPackageRoot(), "package.json"))).toBe(true);
  });
});
