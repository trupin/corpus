import type { TopicSpec } from "../../registry/types.js";
import { abandonCommand, listCommand, retryCommand } from "./console.js";
import { logCommand } from "./log.js";

/**
 * Jobs are queue events being worked (SPEC.md §7), so they are addressed by the
 * event's id. `log` is the write half the agent calls constantly; the rest is
 * the console's view, reachable from a terminal.
 */
export const jobTopic: TopicSpec = {
  name: "job",
  summary: "Follow and settle the agent's work in progress.",
  description:
    "Every queue event is a job with a live log at `.corpus/jobs/<event-id>.jsonl`. The agent " +
    "appends progress lines with `corpus job log` while it works, and the console — in the board's " +
    "drawer or through `corpus job list` — shows each job's status with its latest line.",
  commands: [logCommand, listCommand, retryCommand, abandonCommand],
};
