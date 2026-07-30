import type { PluginCommandContext, PluginCommandSpec } from "@corpus/contract/plugin";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createOutput } from "../output.js";
import { ParsedArgs, ParsedFlags } from "../parse-args.js";
import type { Workspace } from "../workspace.js";
import type { CommandSpec, Registry, WorkspaceCommandContext } from "./types.js";
import { collectRegistryProblems } from "./validate.js";

/**
 * The adapter boundary of CONTRACT-015. `@corpus/contract/plugin` publishes
 * narrowed, structural views of what a verb is handed; the CLI keeps its own
 * types (`ParsedArgs`/`ParsedFlags` are classes with `#private` fields, so they
 * are nominally typed; `Workspace` comes from a module that reads `node:fs`;
 * `CliClient` wraps `@corpus/contract/client`) and satisfies those views rather
 * than exporting them. These tests pin both halves: the type-level assertion
 * that no adapter object is needed, and the CLI's real parsers and writer
 * driving a handler that was written against the contract alone.
 */

const workspace = {
  root: "/tmp/workspace",
  configPath: "/tmp/workspace/.corpus/config.json",
  host: "127.0.0.1",
  port: 8765,
  token: "token",
  dataDir: "data",
  baseUrl: "http://127.0.0.1:8765",
} satisfies Workspace;

/** The CLI's real `ParsedArgs`, `ParsedFlags` and `Output`, seen through the plugin views. */
function pluginContext(title: string, written: string[]): PluginCommandContext {
  return {
    args: new ParsedArgs(new Map([["title", title]])),
    flags: new ParsedFlags(new Map([["quiet", false]])),
    out: createOutput({
      json: false,
      color: false,
      stdout: (text) => void written.push(text),
      stderr: () => undefined,
    }),
    workspace,
    client: { baseUrl: workspace.baseUrl },
    actor: "agent",
    cwd: "/tmp/workspace",
    env: {},
    version: "0.0.0-test",
  };
}

/** Written exactly as a plugin author writes it: contract types, no CLI import. */
const pluginVerb = {
  name: "add",
  summary: "Create a note through the plugin's own server route.",
  args: [{ name: "title", required: true, description: "Title of the note." }],
  flags: [{ name: "quiet", type: "boolean", description: "Say nothing on success." }],
  examples: [{ command: 'corpus notes add "Hello"', description: "Create a note." }],
  handler: (context: PluginCommandContext): Promise<void> => {
    if (context.flags.boolean("quiet")) return Promise.resolve();
    context.out.line(`${context.args.get("title")} → ${context.client.baseUrl} (${context.actor})`);
    return Promise.resolve();
  },
} satisfies PluginCommandSpec;

describe("the plugin-facing command types", () => {
  it("are satisfied by the context the dispatcher actually builds", () => {
    expectTypeOf<WorkspaceCommandContext>().toExtend<PluginCommandContext>();
  });

  it("produce a spec the registry validates like any core verb", () => {
    expectTypeOf(pluginVerb).toExtend<CommandSpec>();
    const registry: Registry = {
      summary: "conversations around documents, driven by an agent.",
      commands: [],
      topics: [
        {
          name: "_fixture",
          summary: "Commands contributed by the _fixture plugin.",
          commands: [pluginVerb],
        },
      ],
    };
    expect(collectRegistryProblems(registry)).toEqual([]);
  });

  it("carry the CLI's real parsers and writer with no adapter in between", async () => {
    const written: string[] = [];
    await pluginVerb.handler(pluginContext("Hello", written));
    expect(written).toEqual(["Hello → http://127.0.0.1:8765 (agent)\n"]);
  });

  it("hide the workspace's filesystem-derived fields and the typed client", () => {
    expectTypeOf<PluginCommandContext["workspace"]>().not.toHaveProperty("root");
    expectTypeOf<PluginCommandContext["client"]>().not.toHaveProperty("api");
  });
});
