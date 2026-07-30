import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPackagedArtifact,
  isPackagedPluginDir,
  listFiles,
  pluginEntryPoints,
  stagePlugins,
  stageTree,
  stripSourceMapComment,
} from "./package-staging.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const created: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "corpus-s014-plugins002-staging-"));
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
 * sprint-013 Adjudication 15: the non-underscore half of the rule is proven
 * against a **synthetic plugin fabricated in a temp directory**, because
 * asserting only the exclusion would let a rule that excludes everything pass.
 * The live proof against the shipped `plugins/todos` is sprint-014 TEST-290,
 * driven against a real packed tarball.
 *
 * sprint-014 TEST-288 adds the second half: a staged plugin's entry points are
 * **bundled**, not copied, so nothing in the tarball carries a bare
 * `@corpus/*` specifier — a package the installed tool inlines rather than
 * installs, and therefore cannot resolve at a dynamic import.
 */
describe("stagePlugins", () => {
  function fabricatePluginsRoot(): string {
    const root = scratch();
    // A built, non-underscore plugin: the case Adjudication 12 requires to ship.
    // Its routes import `@corpus/contract`, exactly as a tsc-built plugin does.
    write(
      root,
      "todos/dist/server/routes.js",
      'import { ACTOR_HEADER } from "@corpus/contract";\nexport default () => ({ ACTOR_HEADER });\n',
    );
    write(root, "todos/dist/server/routes.d.ts", "declare const _: unknown;\n");
    write(
      root,
      "todos/dist/cli/commands/add.js",
      'import { ACTOR_HEADER } from "@corpus/contract";\nexport default { ACTOR_HEADER };\n',
    );
    write(root, "todos/dist/tsconfig.tsbuildinfo", "{}");
    write(root, "todos/server/routes.ts", "export default () => ({});\n");
    write(root, "todos/types.yaml", "types:\n  - type: todo\n    label: Todo\n");
    write(root, "todos/skills/todos/SKILL.md", "# todos\n");
    write(root, "todos/seeds/todo-template.md", "---\ntype: template\nfor: todo\n---\n");
    write(root, "todos/package.json", '{"name":"corpus-plugin-todos"}');
    // A dev fixture: the case Adjudication 9 requires to stay out.
    write(root, "_fixture/dist/server/routes.js", "export default () => ({});\n");
    write(root, "_fixture/types.yaml", "types: []\n");
    // A non-underscore plugin nobody built: shipping its sources would ship
    // something the packaged tool cannot run.
    write(root, "unbuilt/server/routes.ts", "export default () => ({});\n");
    return root;
  }

  /** esbuild resolves `@corpus/*` for inlining from the repository's own tree. */
  const nodePaths = [join(REPO_ROOT, "node_modules")];

  it("stages a built non-underscore plugin's dist, types, skills and seeds", async () => {
    const destination = join(scratch(), "plugins");
    const staged = await stagePlugins(fabricatePluginsRoot(), destination, { nodePaths });

    expect(staged.map((plugin) => plugin.dir)).toEqual(["todos"]);
    expect(listFiles(destination)).toEqual([
      "todos/dist/cli/commands/add.js",
      "todos/dist/server/routes.js",
      "todos/seeds/todo-template.md",
      "todos/skills/todos/SKILL.md",
      "todos/types.yaml",
    ]);
  });

  /**
   * INFRA-008 escalation 3(b): before this, `dist/server/routes.js` reached the
   * tarball with `from "@corpus/contract"` intact, and the installed server
   * failed its dynamic import with `ERR_MODULE_NOT_FOUND` — contained as a
   * warning, so the plugin's routes silently never mounted.
   */
  it("bundles each entry point so no bare @corpus specifier ships", async () => {
    const destination = join(scratch(), "plugins");
    await stagePlugins(fabricatePluginsRoot(), destination, { nodePaths });

    for (const entry of ["todos/dist/server/routes.js", "todos/dist/cli/commands/add.js"]) {
      const bundled = readFileSync(join(destination, entry), "utf8");
      expect(bundled, `${entry} still imports @corpus/* as a bare specifier`).not.toMatch(
        /from\s*["']@corpus\//,
      );
      // Inlined, not merely dropped: the contract's value is in the bundle.
      expect(bundled).toContain("x-corpus-author");
    }
  });

  it("names each plugin's entry points from its dist layout", () => {
    const root = fabricatePluginsRoot();
    expect(pluginEntryPoints(join(root, "todos", "dist"))).toEqual([
      "server/routes.js",
      "cli/commands/add.js",
    ]);
    expect(pluginEntryPoints(join(root, "_fixture", "dist"))).toEqual(["server/routes.js"]);
    expect(pluginEntryPoints(join(root, "unbuilt"))).toEqual([]);
  });

  it("never stages an underscore-prefixed dev fixture", async () => {
    const destination = join(scratch(), "plugins");
    await stagePlugins(fabricatePluginsRoot(), destination, { nodePaths });
    expect(listFiles(destination).join("\n")).not.toContain("_fixture");
  });

  it("skips a plugin that was never built rather than shipping its sources", async () => {
    const destination = join(scratch(), "plugins");
    const staged = await stagePlugins(fabricatePluginsRoot(), destination, { nodePaths });
    expect(staged.map((plugin) => plugin.dir)).not.toContain("unbuilt");
    expect(listFiles(destination).join("\n")).not.toContain(".ts");
  });

  it("returns nothing when there is no plugins root at all", async () => {
    expect(await stagePlugins(join(scratch(), "absent"), join(scratch(), "out"))).toEqual([]);
  });
});
