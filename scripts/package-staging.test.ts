import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPackagedArtifact,
  isPackagedPluginDir,
  listFiles,
  stagePlugins,
  stageTree,
  stripSourceMapComment,
} from "./package-staging.js";

const created: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "corpus-s013-infra008-"));
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
  it.each(["index.js", "routes.js", "SKILL.md", "types.yaml", "index.css"])(
    "keeps %s",
    (fileName) => {
      expect(isPackagedArtifact(fileName)).toBe(true);
    },
  );

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

describe("isPackagedPluginDir", () => {
  it.each(["todos", "notes"])("admits %s", (dir) => {
    expect(isPackagedPluginDir(dir)).toBe(true);
  });

  it.each(["_fixture", "_scratch", ".hidden"])("denies %s", (dir) => {
    expect(isPackagedPluginDir(dir)).toBe(false);
  });
});

/**
 * sprint-013 Adjudication 15: `plugins/_fixture` is the repository's only
 * plugin, so the non-underscore half of the rule is proven against a **synthetic
 * plugin fabricated in a temp directory**. Asserting only the exclusion would
 * let a rule that excludes everything pass. The live proof against a shipped
 * plugin is DEFERRED → PLUGINS-002.
 */
describe("stagePlugins", () => {
  function fabricatePluginsRoot(): string {
    const root = scratch();
    // A built, non-underscore plugin: the case Adjudication 12 requires to ship.
    write(root, "todos/dist/server/routes.js", "export default () => ({});\n");
    write(root, "todos/dist/server/routes.d.ts", "declare const _: unknown;\n");
    write(root, "todos/dist/cli/commands/add.js", "export default {};\n");
    write(root, "todos/dist/tsconfig.tsbuildinfo", "{}");
    write(root, "todos/server/routes.ts", "export default () => ({});\n");
    write(root, "todos/types.yaml", "types:\n  - type: todo\n    label: Todo\n");
    write(root, "todos/skills/todos/SKILL.md", "# todos\n");
    write(root, "todos/package.json", '{"name":"corpus-plugin-todos"}');
    // A dev fixture: the case Adjudication 9 requires to stay out.
    write(root, "_fixture/dist/server/routes.js", "export default () => ({});\n");
    write(root, "_fixture/types.yaml", "types: []\n");
    // A non-underscore plugin nobody built: shipping its sources would ship
    // something the packaged tool cannot run.
    write(root, "unbuilt/server/routes.ts", "export default () => ({});\n");
    return root;
  }

  it("stages a built non-underscore plugin's dist, types and skills", () => {
    const destination = join(scratch(), "plugins");
    const staged = stagePlugins(fabricatePluginsRoot(), destination);

    expect(staged.map((plugin) => plugin.dir)).toEqual(["todos"]);
    expect(listFiles(destination)).toEqual([
      "todos/dist/cli/commands/add.js",
      "todos/dist/server/routes.js",
      "todos/skills/todos/SKILL.md",
      "todos/types.yaml",
    ]);
  });

  it("never stages an underscore-prefixed dev fixture", () => {
    const destination = join(scratch(), "plugins");
    stagePlugins(fabricatePluginsRoot(), destination);
    expect(listFiles(destination).join("\n")).not.toContain("_fixture");
  });

  it("skips a plugin that was never built rather than shipping its sources", () => {
    const destination = join(scratch(), "plugins");
    const staged = stagePlugins(fabricatePluginsRoot(), destination);
    expect(staged.map((plugin) => plugin.dir)).not.toContain("unbuilt");
    expect(listFiles(destination).join("\n")).not.toContain(".ts");
  });

  it("returns nothing when there is no plugins root at all", () => {
    expect(stagePlugins(join(scratch(), "absent"), join(scratch(), "out"))).toEqual([]);
  });
});
