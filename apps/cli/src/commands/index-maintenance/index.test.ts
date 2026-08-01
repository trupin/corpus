import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCommandHelp, renderRootHelp, renderTopicHelp } from "../../help.js";
import { registry } from "../../registry/index.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { indexTopic } from "./index.js";

/**
 * The topic exists on the wire as `index` and on disk as `index-maintenance`
 * (sprint-021 Open Conflict 7). Both halves are pinned here: a directory named
 * `index` would collide with the topic-barrel convention every other topic
 * follows, and a topic renamed to match the directory would change the verb an
 * agent types.
 */

describe("the index topic", () => {
  it("is registered as `index`, with both verbs, and the registry still validates", () => {
    const topic = registry.topics.find((candidate) => candidate.name === "index");

    expect(topic).toBe(indexTopic);
    expect(topic?.commands.map((command) => command.name)).toEqual(["status", "rebuild"]);
    expect(collectRegistryProblems(registry)).toEqual([]);
  });

  it("lives in a directory that does not compete with a barrel file", async () => {
    expect(basename(import.meta.dirname)).toBe("index-maintenance");

    const commandsRoot = join(import.meta.dirname, "..");
    const entries = await readdir(commandsRoot, { withFileTypes: true });
    expect(entries.filter((entry) => entry.isDirectory() && entry.name === "index")).toEqual([]);
  });

  it("renders help at all three levels from the registry alone", () => {
    const options = { color: false };

    const root = renderRootHelp(registry, options);
    expect(root).toContain(`  index`);
    expect(root).toContain(indexTopic.summary);

    const topic = renderTopicHelp(indexTopic, options);
    expect(topic).toContain("corpus index — ");
    expect(topic).toContain("corpus index <verb> [args] [flags]");
    expect(topic).toContain("status");
    expect(topic).toContain("rebuild");

    for (const command of indexTopic.commands) {
      const help = renderCommandHelp(command, { ...options, topic: "index" });
      expect(help).toContain(`corpus index ${command.name} — `);
      expect(help).toContain("Examples:");
    }
  });
});
