import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateCliDocs } from "../docs/generate.js";
import { renderCommandHelp, renderRootHelp, renderTopicHelp } from "../help.js";
import { registry } from "./index.js";
import { discoverPluginTopics, excludedInProduction } from "./plugins.js";
import type { CommandSpec, TopicSpec } from "./types.js";
import { collectRegistryProblems, validateRegistry } from "./validate.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const scratch: string[] = [];

function tempPluginsRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "corpus-s012-plugins001-cli-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const command = (overrides: Partial<CommandSpec> = {}): CommandSpec => ({
  name: "verb",
  summary: "A plugin verb.",
  args: [],
  flags: [],
  examples: [{ command: "corpus sample verb", description: "Run it." }],
  handler: () => Promise.resolve(),
  ...overrides,
});

describe("discoverPluginTopics", () => {
  it("returns empty for no root, a missing root, and an empty root", async () => {
    expect(await discoverPluginTopics({ pluginsRoot: undefined })).toEqual({
      topics: [],
      warnings: [],
    });
    expect(await discoverPluginTopics({ pluginsRoot: join(tempPluginsRoot(), "gone") })).toEqual({
      topics: [],
      warnings: [],
    });
    expect(await discoverPluginTopics({ pluginsRoot: tempPluginsRoot() })).toEqual({
      topics: [],
      warnings: [],
    });
  });

  it("wraps the repo fixture's commands into a topic named after its directory", async () => {
    const scan = await discoverPluginTopics({ pluginsRoot: join(REPO_ROOT, "plugins") });
    const fixture = scan.topics.find((topic) => topic.name === "_fixture");
    expect(fixture).toBeDefined();
    expect(fixture?.commands.map((verb) => verb.name)).toEqual(["add"]);
    expect(scan.warnings).toEqual([]);
  });

  /**
   * sprint-014 TEST-236: `todos` (PLUGINS-002) is the first committed
   * non-underscore plugin, so the discovery path that had only ever run against
   * a fixture finally has a real subject — in the same scan that still excludes
   * `_fixture` in production, which is what proves the filter discriminates.
   */
  it("discovers the shipped todos plugin's three verbs", async () => {
    const scan = await discoverPluginTopics({ pluginsRoot: join(REPO_ROOT, "plugins") });
    const todos = scan.topics.find((topic) => topic.name === "todos");
    expect(todos).toBeDefined();
    expect(todos?.commands.map((verb) => verb.name)).toEqual(["add", "check", "list"]);
  });

  it("prefers a compiled dist command module over its source", async () => {
    const root = tempPluginsRoot();
    mkdirSync(join(root, "sample", "cli", "commands"), { recursive: true });
    mkdirSync(join(root, "sample", "dist", "cli", "commands"), { recursive: true });
    // The .ts source is deliberately broken; the compiled .js must win.
    writeFileSync(join(root, "sample", "cli", "commands", "verb.ts"), "syntax error {{{\n");
    writeFileSync(
      join(root, "sample", "dist", "cli", "commands", "verb.js"),
      `export default {
        name: "verb", summary: "From dist.", args: [], flags: [],
        examples: [{ command: "corpus sample verb", description: "Run it." }],
        handler: async () => {},
      };\n`,
    );
    const scan = await discoverPluginTopics({ pluginsRoot: root });
    expect(scan.topics[0]?.commands[0]?.summary).toBe("From dist.");
    expect(scan.warnings).toEqual([]);
  });

  /**
   * INFRA-008 escalation 3(a) / sprint-014 TEST-284–TEST-285. Enumeration used
   * to list `cli/commands/*.ts` and merely *remap* each name into `dist/`, so a
   * packaged plugin — which ships built output only (sprint-012 Adjudication
   * 12) — exposed **zero** verbs while its server routes mounted from the very
   * same `dist/`.
   */
  it("discovers verbs from a dist-only plugin, with no sources at all", async () => {
    const root = tempPluginsRoot();
    mkdirSync(join(root, "packaged", "dist", "cli", "commands"), { recursive: true });
    writeFileSync(
      join(root, "packaged", "dist", "cli", "commands", "add.js"),
      `export default {
        name: "add", summary: "Packaged.", args: [], flags: [],
        examples: [{ command: "corpus packaged add", description: "Run it." }],
        handler: async () => {},
      };\n`,
    );
    // The declaration file beside it must not be mistaken for a module.
    writeFileSync(join(root, "packaged", "dist", "cli", "commands", "add.d.ts"), "export {};\n");
    const scan = await discoverPluginTopics({ pluginsRoot: root });
    expect(scan.topics.map((topic) => topic.name)).toEqual(["packaged"]);
    expect(scan.topics[0]?.commands.map((verb) => verb.name)).toEqual(["add"]);
    expect(scan.warnings).toEqual([]);
  });

  it("still discovers verbs from a source-only plugin (the monorepo layout)", async () => {
    const root = tempPluginsRoot();
    mkdirSync(join(root, "sourced", "cli", "commands"), { recursive: true });
    writeFileSync(
      join(root, "sourced", "cli", "commands", "verb.ts"),
      `export default {
        name: "verb", summary: "From source.", args: [], flags: [],
        examples: [{ command: "corpus sourced verb", description: "Run it." }],
        handler: async () => {},
      };\n`,
    );
    const scan = await discoverPluginTopics({ pluginsRoot: root });
    expect(scan.topics[0]?.commands[0]?.summary).toBe("From source.");
  });

  it("skips a broken command module with a warning; core and siblings survive", async () => {
    const root = tempPluginsRoot();
    mkdirSync(join(root, "sample", "dist", "cli", "commands"), { recursive: true });
    writeFileSync(join(root, "sample", "dist", "cli", "commands", "bad.js"), "syntax error {{{\n");
    writeFileSync(
      join(root, "sample", "dist", "cli", "commands", "good.js"),
      `export default {
        name: "good", summary: "Fine.", args: [], flags: [],
        examples: [{ command: "corpus sample good", description: "Run it." }],
        handler: async () => {},
      };\n`,
    );
    const scan = await discoverPluginTopics({ pluginsRoot: root });
    expect(scan.warnings.some((warning) => warning.includes("bad.js"))).toBe(true);
    expect(scan.topics[0]?.commands.map((verb) => verb.name)).toEqual(["good"]);
  });

  it("skips a broken source module with a warning too", async () => {
    const root = tempPluginsRoot();
    mkdirSync(join(root, "sample", "cli", "commands"), { recursive: true });
    writeFileSync(join(root, "sample", "cli", "commands", "bad.ts"), "syntax error {{{\n");
    const scan = await discoverPluginTopics({ pluginsRoot: root });
    expect(scan.topics).toEqual([]);
    expect(scan.warnings.some((warning) => warning.includes("bad.ts"))).toBe(true);
  });

  it("skips a module whose default export is not command-shaped", async () => {
    const root = tempPluginsRoot();
    mkdirSync(join(root, "sample", "dist", "cli", "commands"), { recursive: true });
    writeFileSync(
      join(root, "sample", "dist", "cli", "commands", "odd.js"),
      "export default { not: 'a command' };\n",
    );
    const scan = await discoverPluginTopics({ pluginsRoot: root });
    expect(scan.topics).toEqual([]);
    expect(scan.warnings.some((warning) => warning.includes("odd.js"))).toBe(true);
  });

  it("excludes underscore plugins in production only", async () => {
    expect(excludedInProduction("_fixture", { NODE_ENV: "production" })).toBe(true);
    expect(excludedInProduction("_fixture", {})).toBe(false);
    const scan = await discoverPluginTopics({
      pluginsRoot: join(REPO_ROOT, "plugins"),
      env: { NODE_ENV: "production" },
    });
    expect(scan.topics.find((topic) => topic.name === "_fixture")).toBeUndefined();
    // The same production scan keeps the non-underscore plugin: an exclusion
    // that dropped everything would pass the assertion above on its own.
    expect(scan.topics.find((topic) => topic.name === "todos")).toBeDefined();
  });
});

describe("plugin topics in the shipped registry", () => {
  it("the fixture topic is registered and valid — same enforcement as core", () => {
    expect(registry.topics.map((topic) => topic.name)).toContain("_fixture");
    expect(collectRegistryProblems(registry)).toEqual([]);
  });

  it("registry validation fails loudly for a plugin command with no example", () => {
    const topic: TopicSpec = {
      name: "sample",
      summary: "A plugin.",
      commands: [command({ examples: [] })],
    };
    expect(() => validateRegistry({ summary: "x", commands: [], topics: [topic] })).toThrow(
      /corpus sample verb has no examples/,
    );
  });

  it("appears at all three help levels", () => {
    const fixture = registry.topics.find((topic) => topic.name === "_fixture");
    if (fixture === undefined) throw new Error("fixture topic missing");
    expect(renderRootHelp(registry, { color: false })).toContain("_fixture");
    expect(renderTopicHelp(fixture, { color: false })).toContain("add");
    const add = fixture.commands[0];
    if (add === undefined) throw new Error("fixture verb missing");
    expect(renderCommandHelp(add, { color: false, topic: "_fixture" })).toContain(
      "corpus _fixture add",
    );
  });
});

describe("docs/cli.md and the underscore convention (Adjudication 9)", () => {
  it("never documents an underscore topic", () => {
    expect(generateCliDocs(registry)).not.toContain("_fixture");
  });

  it("a non-underscore plugin topic WOULD reach the generator", () => {
    const docs = generateCliDocs({
      summary: "x",
      commands: [],
      topics: [
        {
          name: "sample",
          summary: "A plugin topic.",
          commands: [command()],
        },
      ],
    });
    expect(docs).toContain("## `corpus sample`");
    expect(docs).toContain("corpus sample verb");
  });
});
