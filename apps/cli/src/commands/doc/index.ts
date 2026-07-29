import type { TopicSpec } from "../../registry/types.js";
import { archiveCommand } from "./archive.js";
import { checkCommand } from "./check.js";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { editCommand } from "./edit.js";
import { moveCommand } from "./move.js";
import { showCommand } from "./show.js";

/**
 * The document lifecycle (SPEC.md §5, §7). Everything is a markdown document
 * with YAML frontmatter, and every one of these verbs is a thin call onto a
 * server endpoint: the CLI never opens a document file, never writes YAML and
 * never runs git. Locking, anchor reconciliation, validation and the auto-commit
 * that records who did it all happen server-side.
 *
 * `show` is the read; `check` is the validator (SPEC.md §14) reported rather
 * than run here; `create`, `edit`, `move` and `archive` are the agent's own
 * initiative; `delete` is the user's alone.
 */
export const docTopic: TopicSpec = {
  name: "doc",
  summary: "Read, check, create, edit, move, archive and delete documents.",
  description:
    "The stewardship surface (SPEC.md §7): the agent reads documents through `show` — anchors " +
    "resolve against the current body server-side, so reading the file would answer differently " +
    "— and creates, edits, moves and archives them on its own initiative, **archiving where a " +
    "person would delete**. Bodies come from `-m`, `--file` or stdin, so a heredoc is the normal " +
    "way to pass prose. Every mutation is attributed with `--from user|agent`, which becomes the " +
    "git author of the server's auto-commit — `git log` is the audit trail of who changed what. " +
    "`check` is the same topic's read-only verdict: SPEC.md §14's validator, run server-side over " +
    "documents, the whole workspace, or what is staged in git.",
  commands: [
    showCommand,
    checkCommand,
    createCommand,
    editCommand,
    moveCommand,
    archiveCommand,
    deleteCommand,
  ],
};
