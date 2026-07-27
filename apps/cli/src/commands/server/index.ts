import type { TopicSpec } from "../../registry/types.js";
import { logsCommand } from "./logs.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status.js";
import { stopCommand } from "./stop.js";

/**
 * Server lifecycle (SPEC.md §2.1). Every workspace runs its own server, managed
 * from inside that workspace: the pidfile, the logfile, the port and the token
 * all live under its `.corpus/`, and there is no machine-wide registry of
 * workspaces — `cd` is the whole lookup mechanism.
 */
export const serverTopic: TopicSpec = {
  name: "server",
  summary: "Manage this workspace's server process.",
  description:
    "Each workspace runs its own server, as a background daemon with its pidfile and log under " +
    "`.corpus/`. Nothing here is global: two workspaces start, stop and report independently, " +
    "and each command acts on the workspace resolved from the current directory.",
  commands: [startCommand, statusCommand, stopCommand, logsCommand],
};
