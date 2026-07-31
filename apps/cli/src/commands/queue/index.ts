import type { TopicSpec } from "../../registry/types.js";
import { claimAllCommand } from "./claim-all.js";
import { haltCommand, reapStaleCommand, resumeCommand, statusCommand } from "./control.js";
import { deferCommand } from "./defer.js";
import { idleCommand } from "./idle.js";
import { abandonCommand, completeCommand, failCommand } from "./transitions.js";

/**
 * The agent loop's control plane (SPEC.md §7). The loop is
 * `idle` → `claim-all` → work → `complete`/`fail`, and every verb here is a thin
 * call to the queue API: the queue itself is files under `.corpus/queue/`, moved
 * only by the server.
 */
export const queueTopic: TopicSpec = {
  name: "queue",
  summary: "Park on, claim and settle the agent's event queue.",
  description:
    "The event queue is how work reaches the agent: a comment that requests it enqueues an event, " +
    "and the orchestrate skill loops `corpus queue idle` → `corpus queue claim-all` → handle → " +
    "`corpus queue complete`. `idle` observes and never claims, `claim-all` is the atomic step, " +
    "and every transition is idempotent so a retried call is never a crash. `defer` is the " +
    "fourth, non-terminal outcome: work blocked on a user-held edit lock waits rather than " +
    "failing, and returns to `pending` by itself when that lock clears. `halt` is the kill " +
    "switch: it stops consumption without stopping production.",
  commands: [
    idleCommand,
    claimAllCommand,
    completeCommand,
    failCommand,
    abandonCommand,
    deferCommand,
    reapStaleCommand,
    haltCommand,
    resumeCommand,
    statusCommand,
  ],
};
