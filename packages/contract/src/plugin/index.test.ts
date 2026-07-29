import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { contractPackageRoot } from "../generation/artifacts.js";
import type { Doc, DocList } from "../schemas/index.js";
import * as pluginSurface from "./index.js";
import type {
  PluginCommandContext,
  PluginCommandSpec,
  PluginLogger,
  PluginServerContext,
} from "./index.js";

/**
 * The two invariants of the `@corpus/contract/plugin` subpath (CONTRACT-015),
 * checked rather than asserted in a comment: it ships **types only**, and it
 * pulls in **nothing new**. Both are read off the real files — a plugin author
 * and a browser bundle each pay for whatever this module actually imports, not
 * for whatever its docblock claims.
 */

const packageRoot = contractPackageRoot();

interface ContractPackageJson {
  readonly exports: Record<string, Record<string, string>>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as ContractPackageJson;

const PLUGIN_MODULES = ["index.ts", "cli.ts", "server.ts"] as const;

function pluginSource(name: string): string {
  return readFileSync(join(packageRoot, "src", "plugin", name), "utf8");
}

describe("the ./plugin subpath", () => {
  it("is published as a third export, resolving into dist/", () => {
    expect(packageJson.exports["./plugin"]).toEqual({
      types: "./dist/plugin/index.d.ts",
      import: "./dist/plugin/index.js",
      default: "./dist/plugin/index.js",
    });
  });

  it("is kept off the root barrel, like the client subpath", () => {
    const barrel = readFileSync(join(packageRoot, "src", "index.ts"), "utf8");
    const reExported = [...barrel.matchAll(/^export \* from "([^"]+)";$/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(reExported.length).toBeGreaterThan(0);
    expect(reExported.filter((module) => /plugin|client/.test(module))).toEqual([]);
  });

  it("exports nothing at runtime — the surface is types only", () => {
    expect(Object.keys(pluginSurface)).toEqual([]);
  });

  it.each(PLUGIN_MODULES)("declares no runtime value in %s", (name) => {
    expect(pluginSource(name)).not.toMatch(/^export (?:const|let|var|function|class|enum) /m);
  });

  it.each(PLUGIN_MODULES)("imports %s types-only, so nothing is emitted", (name) => {
    for (const statement of pluginSource(name).match(/^(?:import|export) [^;]*from "[^"]+";$/gm) ??
      []) {
      expect(statement).toMatch(/^(?:import type|export type) /);
    }
  });

  it.each(PLUGIN_MODULES)("resolves every import of %s inside this package", (name) => {
    const specifiers = [...pluginSource(name).matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^\.{1,2}\//);
    }
  });

  it("gains the contract no server, node or react dependency", () => {
    const declared = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    });
    expect(declared).toEqual(
      expect.not.arrayContaining(["better-sqlite3", "chokidar", "react", "@corpus/server"]),
    );
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "@hono/zod-openapi",
      "hono",
      "openapi-fetch",
      "zod",
    ]);
  });
});

describe("PluginServerContext", () => {
  it("hands a routes factory the contract's own document types", () => {
    expectTypeOf<PluginServerContext["getDoc"]>().toExtend<(id: string) => Doc>();
    expectTypeOf<PluginServerContext["listDocs"]>().returns.toEqualTypeOf<DocList>();
    expectTypeOf<PluginServerContext["plugin"]>().toEqualTypeOf<string>();
  });

  it("publishes a logger narrowed to the three methods a plugin may call", () => {
    const logger: PluginLogger = {
      info: () => undefined,
      debug: () => undefined,
      error: () => undefined,
    };
    // `level` and the sinks are the server's own concern (its `Logger` carries
    // them and still satisfies this interface).
    expect(Object.keys(logger)).toEqual(["info", "debug", "error"]);
    expectTypeOf(logger).not.toHaveProperty("level");
  });
});

/** Exactly the object `apps/cli`'s dispatcher hands a plugin verb, as plain data. */
function fakeContext(lines: string[], emitted: unknown[]): PluginCommandContext {
  return {
    args: { get: (name) => `<${name}>`, optional: () => undefined },
    flags: {
      boolean: () => false,
      string: () => undefined,
      number: () => undefined,
      strings: () => [],
    },
    out: {
      emit: (value) => {
        emitted.push(value);
      },
      line: (text) => {
        lines.push(text);
      },
    },
    workspace: { baseUrl: "http://127.0.0.1:8765", token: "token" },
    client: { baseUrl: "http://127.0.0.1:8765" },
    actor: "agent",
    cwd: "/tmp/workspace",
    env: {},
    version: "0.0.0",
  };
}

const exampleSpec = {
  name: "add",
  summary: "Create a note through the plugin's server route.",
  description: "The declarative half is identical to a core verb's.",
  args: [{ name: "title", required: true, description: "Title of the note." }],
  flags: [{ name: "quiet", type: "boolean", description: "Say nothing on success." }],
  examples: [{ command: 'corpus notes add "Hello"', description: "Create a note." }],
  handler: (context: PluginCommandContext): Promise<void> => {
    context.out.emit({ title: context.args.get("title") });
    context.out.line(`created ${context.args.get("title")} as ${context.actor}`);
    return Promise.resolve();
  },
} satisfies PluginCommandSpec;

describe("PluginCommandSpec", () => {
  it("accepts the shape a plugin command module default-exports", () => {
    expectTypeOf(exampleSpec).toExtend<PluginCommandSpec>();
  });

  it("is satisfiable by plain objects — nothing on the context is nominally typed", async () => {
    const lines: string[] = [];
    const emitted: unknown[] = [];
    await exampleSpec.handler(fakeContext(lines, emitted));
    expect(emitted).toEqual([{ title: "<title>" }]);
    expect(lines).toEqual(["created <title> as agent"]);
  });

  it("rejects a spec missing the members registry validation requires", () => {
    // @ts-expect-error — `examples` is required: a verb with no example ships undocumented
    const missing: PluginCommandSpec = {
      name: "add",
      summary: "…",
      args: [],
      flags: [],
      handler: () => Promise.resolve(),
    };
    expect(missing.name).toBe("add");
  });

  it("rejects an unknown member, so a typo is not silently ignored", () => {
    const spec = {
      name: "add",
      summary: "…",
      args: [],
      flags: [],
      examples: [{ command: "corpus notes add", description: "…" }],
      handler: () => Promise.resolve(),
      // @ts-expect-error — `requiresServer` is not part of the §10 command contract
      requiresServer: true,
    } satisfies PluginCommandSpec;
    expect(spec.name).toBe("add");
  });
});
