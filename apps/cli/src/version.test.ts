import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliPackageRoot, readPackageVersion } from "./version.js";

describe("readPackageVersion", () => {
  it("reads this package's own version by default", () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("points at the @corpus/cli package root", () => {
    expect(cliPackageRoot().endsWith(join("apps", "cli"))).toBe(true);
  });

  it("reads the version from the given package root", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-cli-version-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
      expect(readPackageVersion(root)).toBe("1.2.3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a manifest with no version", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-cli-version-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }), "utf8");
      expect(() => readPackageVersion(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
