import type { TopicSpec } from "../../registry/types.js";
import { breakCommand } from "./break.js";
import { acquireCommand, listCommand, reapCommand, releaseCommand } from "./manage.js";

/**
 * Per-document edit locks (SPEC.md §7). One holder at a time, file-backed under
 * `.corpus/locks/`, and coordinated entirely through the server — the CLI never
 * touches a lock file, it asks.
 */
export const lockTopic: TopicSpec = {
  name: "lock",
  summary: "Coordinate who may edit a document.",
  description:
    "Editing is coordinated by a per-document lock: the agent takes it before editing and the " +
    "user's editor session holds it while typing, so a write from the other party is refused with " +
    "a `423` naming the holder. Locks carry a lease, `reap` clears expired ones, and `break` is " +
    "the operator's escape hatch for a lock that is stuck.",
  commands: [breakCommand, reapCommand, listCommand, acquireCommand, releaseCommand],
};
