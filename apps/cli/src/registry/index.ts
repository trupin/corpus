import { dbTopic } from "../commands/db/index.js";
import { docTopic } from "../commands/doc/index.js";
import { healthCommand } from "../commands/health.js";
import { indexTopic } from "../commands/index-maintenance/index.js";
import { initCommand } from "../commands/init/index.js";
import { jobTopic } from "../commands/job/index.js";
import { queueTopic } from "../commands/queue/index.js";
import { searchCommand } from "../commands/search.js";
import { serverTopic } from "../commands/server/index.js";
import { skillTopic } from "../commands/skill/index.js";
import { threadTopic } from "../commands/thread/index.js";
import { upgradeCommand } from "../commands/upgrade/index.js";
import { workspaceTopic } from "../commands/workspace/index.js";
import { discoverPluginTopics } from "./plugins.js";
import type { Registry } from "./types.js";
import { validateRegistry } from "./validate.js";

export * from "./types.js";
export { GLOBAL_FLAGS, GLOBAL_FLAG_ALIASES, GLOBAL_FLAG_NAMES } from "./globals.js";
export { discoverPluginTopics, excludedInProduction } from "./plugins.js";
export { collectRegistryProblems, RegistryValidationError, validateRegistry } from "./validate.js";

/**
 * The command surface, declared once (SPEC.md §2.3). Core topics are imported
 * statically; plugin topics are discovered from `plugins/*⁠/cli/commands/`
 * (PLUGINS-001) and appended **before** `validateRegistry` runs, so plugin
 * verbs get the dispatcher, all three levels of `--help`, `docs/cli.md` and
 * the same validation core verbs get — with no plugin named anywhere.
 *
 * Validation runs at module load (via top-level await, which the ESM graph
 * absorbs for every importer): a malformed registry — core or plugin — must
 * fail before it can render misleading help. Scan *warnings* are different:
 * a broken plugin command file must not take the CLI down, so they go to
 * stderr and the rest of the surface loads.
 */
const pluginScan = await discoverPluginTopics();
for (const warning of pluginScan.warnings) {
  process.stderr.write(`warning: ${warning}\n`);
}

export const registry: Registry = validateRegistry({
  summary: "conversations around documents, driven by an agent.",
  // `search` is top-level rather than a `doc` verb because it retrieves across
  // the corpus — documents, threads and turns alike (SPEC.md §7, §9.2) — and it
  // is the first thing the agent runs, not a document operation.
  commands: [healthCommand, initCommand, searchCommand, upgradeCommand],
  topics: [
    workspaceTopic,
    serverTopic,
    docTopic,
    threadTopic,
    skillTopic,
    queueTopic,
    jobTopic,
    dbTopic,
    indexTopic,
    ...pluginScan.topics,
  ],
});
