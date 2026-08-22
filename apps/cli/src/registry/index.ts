import { agentsCommand } from "../commands/agents.js";
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
import type { Registry } from "./types.js";
import { validateRegistry } from "./validate.js";

export * from "./types.js";
export { GLOBAL_FLAGS, GLOBAL_FLAG_ALIASES, GLOBAL_FLAG_NAMES } from "./globals.js";
export { collectRegistryProblems, RegistryValidationError, validateRegistry } from "./validate.js";

/**
 * The command surface, declared once (SPEC.md §2.3). Every topic is imported
 * statically, and validation runs synchronously at module load: a malformed
 * registry must fail before it can render misleading help, and it fails while
 * the module graph is still loading rather than at the first `--help`.
 */
export const registry: Registry = validateRegistry({
  summary: "conversations around documents, driven by an agent.",
  // `search` is top-level rather than a `doc` verb because it retrieves across
  // the corpus — documents, threads and turns alike (SPEC.md §7, §9.2) — and it
  // is the first thing the agent runs, not a document operation.
  //
  // `agents` is top-level for the mirror-image reason: it is a read of the
  // *queue's* lanes, not of any one thread, and there is exactly one of it. It
  // is deliberately not a topic — a topic would invite `corpus agents register`
  // or `corpus agents heartbeat`, and SPEC.md §7 has neither: presence is the
  // parked request and nothing else, so the roster is only ever read.
  commands: [agentsCommand, healthCommand, initCommand, searchCommand, upgradeCommand],
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
  ],
});
