import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the CLI loads before it does anything (CLI-058).
 *
 * Every `corpus` invocation pays a fixed startup cost, and the agent loop is
 * made of hundreds of them. Measured on the packaged bundle by
 * `npm run bench:startup -w apps/cli`, `corpus health` costs **~159 ms**, of
 * which **~73 ms is loading modules** and ~57 ms is Node booting — all of it
 * before one byte of the command's own work happens. A third-party package
 * imported statically is therefore paid for by every verb, whether or not any
 * verb uses it: `yaml` cost **10 ms of every invocation** to serve one migration
 * detector that runs on `corpus upgrade` alone.
 *
 * That regression is invisible: nothing fails, nothing warns, the tool is just
 * slower for everyone. So the startup path's third-party imports are **pinned**
 * here. Adding one shows up as a named failing diff, and the question it asks is
 * the right one: does every verb need this, or does the one verb that needs it
 * want `await import(…)`?
 *
 * ## What counts as the startup path
 *
 * The static import graph reachable from `bin/corpus.ts`. A **dynamic**
 * `import(…)` is deliberately not followed: deferring a load is exactly the
 * repair this test exists to encourage, so a package reached only that way is
 * off the startup path by construction. A type-only import is not followed
 * either — it is erased before the tool runs.
 *
 * Node's own builtins are not pinned. They are in the binary already, and
 * `node:fs` costs a resolution rather than a parse.
 *
 * `@corpus/contract` is one entry here and a large module graph behind it; what
 * *it* loads eagerly is the contract's own to guard, and CONTRACT-082 took the
 * two costs CLI-058 measured on the far side of that boundary: the OpenAPI route
 * definitions the CLI never serves (182 kB, dropped by marking the contract
 * side-effect-free) and `@hono/zod-openapi` standing in for plain `zod` in every
 * schema. Together they were **20 ms of every invocation**, measured before and
 * after on interleaved packaged builds. `@hono/zod-openapi` no longer appears in
 * the CLI bundle at all; `packages/contract/src/schemas/openapi-metadata.test.ts`
 * is what keeps it out.
 */

/**
 * Third-party packages the CLI may load on every invocation, and why each has
 * earned it. Exhaustive: a fourth entry is a decision, not an import.
 *
 * - `@corpus/contract` — the wire shapes and the constants; every verb is a
 *   client of it.
 * - `@corpus/contract/client` — the generated typed client itself.
 * - `zod` — the workspace config, the pidfile and the release manifest are all
 *   parsed at boundaries the tool cannot proceed past (`docs/TS_GUIDELINES.md`).
 */
const STARTUP_PACKAGES = ["@corpus/contract", "@corpus/contract/client", "zod"];

const sourceRoot = import.meta.dirname;
const entryPoint = join(sourceRoot, "bin", "corpus.ts");

/** One `import`/`export … from` that survives compilation, as written. */
interface Specifier {
  readonly module: string;
  /** True for `import type …` / `export type …`, which is erased before runtime. */
  readonly typeOnly: boolean;
}

/**
 * The static specifiers of one module's source.
 *
 * Anchored to the start of a line, because a specifier is only a specifier at
 * statement position: this CLI's help text is full of prose and shell examples
 * containing the words `import` and `from`, and matching those would pin
 * imaginary packages. The clause between the keyword and `from` is restricted to
 * the characters an import clause can contain — names, braces, commas, `*` — for
 * the same reason, since a description string may open a line with the word
 * `import` and reach a `from` several lines later. A dynamic `import(…)` never
 * matches: the parenthesis is not the whitespace this pattern requires.
 */
export function staticSpecifiers(source: string): readonly Specifier[] {
  const pattern =
    /^[ \t]*(?:import|export)(?![\w$])(?<clause>[\s\w{},*$]*?)\bfrom\s+["'](?<module>[^"']+)["']|^[ \t]*import\s+["'](?<bare>[^"']+)["']/gm;
  const found: Specifier[] = [];

  for (const match of source.matchAll(pattern)) {
    const groups = match.groups ?? {};
    const module = groups.module ?? groups.bare;
    if (module === undefined) continue;
    found.push({ module, typeOnly: /^\s*type\s/.test(groups.clause ?? "") });
  }
  return found;
}

/** Every module the entry point reaches statically, and every package they name. */
function startupGraph(): {
  readonly modules: readonly string[];
  readonly packages: readonly string[];
} {
  const visited = new Set<string>();
  const packages = new Set<string>();

  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);

    for (const { module, typeOnly } of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (typeOnly) continue;
      if (!module.startsWith(".")) {
        if (!module.startsWith("node:")) packages.add(module);
        continue;
      }
      // The source is TypeScript written with the ESM `.js` specifiers Node
      // resolves at runtime, so the file on disk is the same path spelled `.ts`.
      visit(join(dirname(file), module.replace(/\.js$/, ".ts")));
    }
  };

  visit(entryPoint);
  return {
    modules: [...visited].map((file) => relative(sourceRoot, file).split(sep).join("/")).sort(),
    packages: [...packages].sort(),
  };
}

describe("the CLI's startup path", () => {
  it("reaches the whole command surface, so the pin below is about the real graph", () => {
    const { modules } = startupGraph();

    // A scanner that silently resolved nothing would pin an empty set and pass
    // for ever. These four are the entry, the dispatcher, the registry and one
    // leaf verb: if the walk reaches them it is walking.
    expect(modules).toContain("bin/corpus.ts");
    expect(modules).toContain("run.ts");
    expect(modules).toContain("registry/index.ts");
    expect(modules).toContain("commands/doc/show.ts");
    expect(modules.length).toBeGreaterThan(100);
  });

  it("loads exactly the third-party packages it has argued for", () => {
    expect(startupGraph().packages).toEqual(STARTUP_PACKAGES);
  });

  it("does not load `yaml`, which one migration detector needs and no verb does", () => {
    // The specific regression CLI-058 measured and repaired: 10 ms on every
    // invocation for `corpus upgrade`'s frontmatter reader.
    expect(startupGraph().packages).not.toContain("yaml");
  });
});

describe("the specifier scan", () => {
  it("finds an import, a re-export and a side-effect import", () => {
    const source = ['import { a } from "one";', 'export * from "two";', 'import "three";'].join(
      "\n",
    );
    expect(staticSpecifiers(source).map((one) => one.module)).toEqual(["one", "two", "three"]);
  });

  it("marks a type-only import, which is erased and costs nothing", () => {
    expect(staticSpecifiers('import type { A } from "one";')).toEqual([
      { module: "one", typeOnly: true },
    ]);
    expect(staticSpecifiers('import { type A, b } from "one";')).toEqual([
      { module: "one", typeOnly: false },
    ]);
  });

  it("ignores a dynamic import, which is the repair rather than the defect", () => {
    expect(staticSpecifiers('const { parse } = await import("yaml");')).toEqual([]);
    expect(staticSpecifiers('yamlModule ??= import("yaml");')).toEqual([]);
  });

  it("ignores the words `import` and `from` inside prose and shell examples", () => {
    const source = [
      '  description: "Read the frontmatter, imported from the file on disk.",',
      '  command: "corpus doc show doc_a1 --json | jq -r .frontmatter",',
      " * Loads it from `.corpus/config.json` rather than from the environment.",
    ].join("\n");
    expect(staticSpecifiers(source)).toEqual([]);
  });

  it("catches a static import added to a module that had none", () => {
    // The falsification: this is exactly the line the pinned inventory exists
    // to turn into a failing diff.
    expect(staticSpecifiers('import { parse } from "yaml";')).toEqual([
      { module: "yaml", typeOnly: false },
    ]);
  });
});
