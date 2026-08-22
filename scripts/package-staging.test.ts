import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPackagedArtifact,
  listFiles,
  stageTree,
  stripSourceMapComment,
} from "./package-staging.js";

const created: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "corpus-package-staging-"));
  created.push(dir);
  return dir;
}

function write(root: string, relativePath: string, contents: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("stripSourceMapComment", () => {
  it("removes a JS annotation, leaving the code intact", () => {
    expect(stripSourceMapComment("const a = 1;\n//# sourceMappingURL=index.js.map\n")).toBe(
      "const a = 1;\n",
    );
  });

  it("removes a CSS annotation", () => {
    expect(stripSourceMapComment("body{color:red}\n/*# sourceMappingURL=index.css.map */\n")).toBe(
      "body{color:red}\n",
    );
  });

  it("leaves a file with no annotation alone", () => {
    expect(stripSourceMapComment("const a = 1;\n")).toBe("const a = 1;\n");
  });

  it("does not eat a `sourceMappingURL` that is not the last line", () => {
    const contents = '//# sourceMappingURL=decoy\nconst a = "x";\n';
    expect(stripSourceMapComment(contents)).toBe(contents);
  });
});

describe("isPackagedArtifact", () => {
  it.each(["index.js", "routes.js", "SKILL.md", "index.css"])("keeps %s", (fileName) => {
    expect(isPackagedArtifact(fileName)).toBe(true);
  });

  it.each(["index.d.ts", "index.d.ts.map", "index.js.map", "tsconfig.tsbuildinfo"])(
    "drops %s",
    (fileName) => {
      expect(isPackagedArtifact(fileName)).toBe(false);
    },
  );
});

describe("stageTree", () => {
  it("copies a tree, dropping maps and their annotations", () => {
    const source = scratch();
    const destination = join(scratch(), "ui");
    write(source, "index.html", "<!doctype html>");
    write(
      source,
      "assets/index-abc.js",
      "console.log(1);\n//# sourceMappingURL=index-abc.js.map\n",
    );
    write(source, "assets/index-abc.js.map", '{"version":3}');
    write(source, "assets/index-abc.css", "a{}\n/*# sourceMappingURL=index-abc.css.map */\n");

    const staged = stageTree(source, destination);

    expect(staged).toEqual(["assets/index-abc.css", "assets/index-abc.js", "index.html"]);
    expect(listFiles(destination)).not.toContain("assets/index-abc.js.map");
    expect(readFileSync(join(destination, "assets/index-abc.js"), "utf8")).toBe(
      "console.log(1);\n",
    );
    expect(readFileSync(join(destination, "assets/index-abc.css"), "utf8")).toBe("a{}\n");
  });

  it("returns nothing for a source that does not exist", () => {
    expect(stageTree(join(scratch(), "absent"), join(scratch(), "out"))).toEqual([]);
  });
});
