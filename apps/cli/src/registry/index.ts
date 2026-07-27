import { healthCommand } from "../commands/health.js";
import { initCommand } from "../commands/init/index.js";
import { jobTopic } from "../commands/job/index.js";
import { lockTopic } from "../commands/lock/index.js";
import { queueTopic } from "../commands/queue/index.js";
import { serverTopic } from "../commands/server/index.js";
import type { Registry } from "./types.js";
import { validateRegistry } from "./validate.js";

export * from "./types.js";
export { GLOBAL_FLAGS, GLOBAL_FLAG_ALIASES, GLOBAL_FLAG_NAMES } from "./globals.js";
export { collectRegistryProblems, RegistryValidationError, validateRegistry } from "./validate.js";

/**
 * The command surface, declared once (SPEC.md §2.3). Later issues add topic
 * modules here — `doc`/`thread` (CLI-003), plugin verbs (PLUGINS-001) — and get
 * the dispatcher, all three levels of `--help`, and a `docs/cli.md` entry for
 * free.
 *
 * Validation runs at module load: a malformed registry must fail before it can
 * render misleading help.
 */
export const registry: Registry = validateRegistry({
  summary: "conversations around documents, driven by an agent.",
  commands: [healthCommand, initCommand],
  topics: [serverTopic, queueTopic, lockTopic, jobTopic],
});
