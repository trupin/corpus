import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliEntryCandidates, resolveCliEntry } from "./entry.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-cli-entry-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "// fixture\n", "utf8");
}

describe("cliEntryCandidates", () => {
  it("names the packaged bundle first and the source checkout second", () => {
    const packageRoot = join(root, "pkg");
    expect(cliEntryCandidates(packageRoot)).toEqual([
      { modulePath: join(packageRoot, "dist", "corpus.js"), layout: "packaged" },
      {
        modulePath: resolve(packageRoot, "..", "cli", "src", "bin", "corpus.ts"),
        layout: "source",
      },
    ]);
  });

  /*
   * The two layouts must not be able to match each other's shape by accident,
   * because `existsSync` is the only thing telling them apart. In a source
   * checkout `defaultPackageRoot()` is `apps/server`, whose `dist/` is tsc
   * output — so the packaged candidate is `apps/server/dist/corpus.js`, a file
   * the server's own build never produces.
   */
  it("looks for the packaged bundle under a name the server's own dist never uses", () => {
    const [packaged] = cliEntryCandidates(resolve("apps", "server"));
    expect(packaged?.modulePath.endsWith(join("server", "dist", "corpus.js"))).toBe(true);
  });
});

describe("resolveCliEntry", () => {
  it("finds the packaged bundle and asks node for no loader", () => {
    const packageRoot = join(root, "pkg");
    write(join(packageRoot, "dist", "corpus.js"));

    const lookup = resolveCliEntry(packageRoot);
    expect(lookup).toEqual({
      kind: "found",
      entry: {
        modulePath: join(packageRoot, "dist", "corpus.js"),
        nodeArgs: [],
        layout: "packaged",
      },
    });
  });

  it("finds the source checkout and asks node to import tsx by absolute URL", () => {
    const packageRoot = join(root, "apps", "server");
    write(join(root, "apps", "cli", "src", "bin", "corpus.ts"));

    const lookup = resolveCliEntry(packageRoot);
    expect(lookup.kind).toBe("found");
    if (lookup.kind !== "found") return;
    expect(lookup.entry.layout).toBe("source");
    expect(lookup.entry.nodeArgs[0]).toBe("--import");
    // Absolute, and a URL: `--import` resolves bare specifiers against the
    // child's cwd, which is the workspace, where `tsx` is not installed.
    expect(lookup.entry.nodeArgs[1]?.startsWith("file://")).toBe(true);
  });

  it("prefers the packaged bundle when both layouts somehow exist", () => {
    const packageRoot = join(root, "apps", "server");
    write(join(packageRoot, "dist", "corpus.js"));
    write(join(root, "apps", "cli", "src", "bin", "corpus.ts"));

    const lookup = resolveCliEntry(packageRoot);
    expect(lookup.kind === "found" && lookup.entry.layout).toBe("packaged");
  });

  it("reports what it searched rather than throwing, when the CLI is not there", () => {
    const lookup = resolveCliEntry(join(root, "empty"));
    expect(lookup.kind).toBe("missing");
    if (lookup.kind !== "missing") return;
    // The paths are the diagnostic — a broken install is identified by where
    // the tool is not, and a caller cannot see this server's disk.
    expect(lookup.searched).toHaveLength(2);
    expect(lookup.searched[0]).toContain("corpus.js");
  });
});
