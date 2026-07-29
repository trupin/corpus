import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InternalError } from "../errors.js";
import {
  pluginSourceMarker,
  readTemplateManifest,
  serializeManifest,
  sha256,
  type TemplateManifest,
} from "./manifest.js";
import { makeTempDir, removeTempDirs } from "../testing/temp.js";

afterEach(removeTempDirs);

const MANIFEST: TemplateManifest = {
  version: 1,
  tool: "0.1.0",
  installedAt: "2026-07-28T10:00:00.000Z",
  files: [
    { path: ".claude/skills/comment/SKILL.md", sha256: "a".repeat(64) },
    { path: ".claude/skills/notes/SKILL.md", sha256: "b".repeat(64), source: "plugin:todos" },
  ],
};

function write(contents: string): string {
  const dir = makeTempDir("manifest");
  const path = join(dir, "template-manifest.json");
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("the template manifest", () => {
  it("round-trips through the exact form `corpus init` writes", () => {
    const serialized = serializeManifest(MANIFEST);
    // 2-space JSON and a trailing newline, so an upgrade's rewrite stays
    // diff-comparable with the one the initial commit recorded.
    expect(serialized).toBe(`${JSON.stringify(MANIFEST, null, 2)}\n`);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(readTemplateManifest(write(serialized))).toEqual(MANIFEST);
  });

  it("treats an absent manifest as absent, not as an error", () => {
    expect(readTemplateManifest(join(makeTempDir("none"), "nothing.json"))).toBeUndefined();
  });

  it("refuses to guess at a manifest it cannot read", () => {
    // Guessing at a broken baseline is how an upgrade would clobber the file it
    // exists to protect.
    expect(() => readTemplateManifest(write("{ not json"))).toThrow(InternalError);
    expect(() => readTemplateManifest(write('{"version":2,"files":[]}'))).toThrow(InternalError);
    expect(() => readTemplateManifest(write('{"version":1,"tool":"0"}'))).toThrow(InternalError);
    expect(() =>
      readTemplateManifest(
        write('{"version":1,"tool":"0","installedAt":"x","files":[{"path":"a"}]}'),
      ),
    ).toThrow(InternalError);
  });

  it("names the plugin a file came from", () => {
    expect(pluginSourceMarker("todos")).toBe("plugin:todos");
  });

  it("hashes bytes, not text", () => {
    expect(sha256(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
