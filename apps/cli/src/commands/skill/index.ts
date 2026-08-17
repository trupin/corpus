import type { TopicSpec } from "../../registry/types.js";
import { createCommand } from "./create.js";

/**
 * Skills as documents (SPEC.md §7). A skill is `.claude/skills/<name>/SKILL.md`
 * with `type: skill`, indexed in place and edited with the ordinary document
 * verbs — `corpus doc show`, `corpus doc edit`, and `corpus doc archive`, which
 * is what disabling a skill *is*.
 *
 * **One verb, deliberately.** Only genesis has no document equivalent. It is not
 * that `corpus doc create` cannot leave `data/docs/` — since SERVER-122 it files
 * an `agent-def` in `.claude/agents/` — but that a skill is not a folder
 * question at all: it is `<name>/SKILL.md`, a directory plus a filename derived
 * from nothing the caller sends, which naming a folder cannot express. The
 * `.claude/skills` root refuses a folder-create for exactly that reason.
 * Recovery used to live here too, as
 * `corpus skill rollback`; it is gone (rider signed 2026-08-12), because §7's
 * loop safety is a write whose content came from history — read the history with
 * `corpus doc diff`, work out the content you want back, and write it with
 * `corpus doc edit --key`, which reconciles anchors, validates, commits under
 * the acting party and refuses a stale key like every other write. A verb that
 * restored a whole file from a revision did none of those and silently discarded
 * anything not yet committed.
 *
 * A skill's name is its directory name, so nested skills (`SKILL.md` below one
 * more directory) are indexed but not addressable here — the route's name
 * pattern admits no `/`. Named as a limitation rather than worked around.
 */
export const skillTopic: TopicSpec = {
  name: "skill",
  summary: "Create a skill: the one skill operation no document verb can express.",
  description:
    "Skills are documents, so reading, editing, archiving — and reverting — one is `corpus doc …` " +
    "like anything else. `create` is what has no document equivalent: it is SPEC.md §7's skill " +
    "genesis, a recurring pattern becoming a skill written as `.claude/skills/<name>/SKILL.md`. " +
    "That is the one shape `corpus doc create` cannot ask for — not because it never leaves " +
    "`data/docs/` (an `agent-def` lands in `.claude/agents/` with no flag) but because a skill is " +
    "a directory plus a fixed filename rather than a folder, so `--folder .claude/skills` is " +
    "refused there. It is performed by the server and lands as a normal attributed commit.\n\n" +
    "**Undoing a bad edit to a skill is not a verb here.** It is an ordinary write whose content " +
    "came from history: read what changed with `corpus doc diff <id>`, work out the content you " +
    "want back, and write it with `corpus doc edit <id> --key <key>`. That path reconciles " +
    "anchors, validates the frontmatter, commits under `--from` and refuses a stale key — none of " +
    "which a file-restoring shortcut did. When it is the agent's own loop that is broken and no " +
    "agent is running to do that, revert in the workspace with git directly; the server's watcher " +
    "sees it as the out-of-band `user` edit it is and commits it for itself.",
  commands: [createCommand],
};
