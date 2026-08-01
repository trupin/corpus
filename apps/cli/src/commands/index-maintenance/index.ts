import type { TopicSpec } from "../../registry/types.js";
import { rebuildCommand } from "./rebuild.js";
import { statusCommand } from "./status.js";

/**
 * The semantic index's maintenance surface (SPEC.md §9.1's verbs bullet, §9.2's
 * index bullet) — the operational half of retrieval, beside the `db` topic's
 * projection verbs.
 *
 * **The directory is `index-maintenance`; the topic is `index`.** Every topic
 * here is a directory whose barrel is `index.ts`, so a directory named `index`
 * would mean `commands/index/index.ts` — a name that resolves today and becomes
 * a trap the first time someone renames a file on a case-insensitive
 * filesystem. The contract made the same call for the same reason
 * (`packages/contract/src/routes/index-maintenance.ts`). Only the directory
 * moves: the user-facing verbs are `corpus index status` and `corpus index
 * rebuild`, and the registry's topic `name` is what decides that.
 */
export const indexTopic: TopicSpec = {
  name: "index",
  summary: "Inspect and rebuild the semantic index.",
  description:
    "The semantic index is derived runtime state — the projection's third search structure, " +
    "beside the full-text index and the links graph (SPEC.md §2.2 rule 1, §9.1). Neither verb " +
    "touches a workspace file, so neither produces a commit and neither carries an acting party.\n\n" +
    "Embedding is asynchronous and **no save ever waits on it**, which is what makes these two " +
    "verbs necessary: `status` is where a backlog is visible instead of hidden, and `rebuild` is " +
    "how the whole corpus is re-embedded — after an embedding model changes, or to retry chunks " +
    "that failed. A backlog is staleness, not drift: `corpus db doctor` stays clean while it " +
    "drains, and ranked search stays available on its lexical half, saying so (SPEC.md §14).",
  commands: [statusCommand, rebuildCommand],
};
