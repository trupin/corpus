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
    "fourth, non-terminal outcome: work the agent parked because a person is editing the " +
    "document it needs waits rather than failing, and returns to `pending` by itself when that " +
    "session ends (SPEC.md §7 — a judgement, not a refusal). `halt` is the kill " +
    "switch: it stops consumption without stopping production. The loop's two entry points — " +
    "`idle` when it returns work, and `claim-all` — additionally report what the server still " +
    "holds `in-progress`, as a list beside the claimed batch and never mixed into it, so the " +
    "agent can reconcile the server's view against its own memory (SPEC.md §7).",
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
