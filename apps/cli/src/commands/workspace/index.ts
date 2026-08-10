import type { TopicSpec } from "../../registry/types.js";
import { workspaceDiffCommand } from "./diff.js";
import { maintainCommand } from "./maintain.js";
import { upgradeCommand } from "./upgrade.js";

/**
 * The workspace itself, as opposed to what is in it (SPEC.md §2.1). `corpus
 * init` creates one and lives at the top level because it runs where no
 * workspace exists yet; everything that maintains an existing workspace's own
 * scaffolding belongs here. Today that is `upgrade` — carrying the tool's
 * template forward without overwriting what the agent has made of it — `diff`,
 * which shows what the tool changed under a file the upgrade refused to
 * overwrite, and `maintain`, which packs the workspace's git repository because
 * Corpus does not let git do it in the background (CLI-037).
 */
export const workspaceTopic: TopicSpec = {
  name: "workspace",
  summary: "Maintain the workspace's own scaffolding.",
  description:
    "Everything under `data/` is documents, and every change to one goes through the server. This " +
    // `_around_` rather than `*around*`: Prettier normalises markdown emphasis
    // when it formats the generated `docs/cli.md`, and the drift check compares
    // the formatted file against this string.
    "topic is about the workspace _around_ them: the agent's skills, its personas and the seed " +
    "files `corpus init` installed. They come from the tool, so a tool update has to be able to " +
    "reach them — but the agent evolves its own skills, so an update must never overwrite what it " +
    "wrote (SPEC.md §2.1). `upgrade` is that negotiation, and it is one of only two commands that " +
    "write workspace files directly (§2.2 rule 4). What it refuses to overwrite it reports as a " +
    "**conflict** — unresolved work, not a notice (§2.4) — and `diff` is what shows the " +
    "difference the resolver has to act on. Neither of those two needs the server running: a " +
    "workspace whose skills are broken is exactly the one whose loop cannot be asked to fix " +
    "them.\n\n" +
    "`maintain` is about the workspace's git repository rather than its files. Corpus disables " +
    "git's own background maintenance in every workspace — a detached repack racing the server's " +
    "commits can leave the object store permanently corrupt, and that store is the audit trail " +
    "SPEC.md §4 makes the only recovery for a deletion — and packs the repository itself " +
    "instead, at `corpus server start` and through this verb.",
  commands: [upgradeCommand, workspaceDiffCommand, maintainCommand],
};
