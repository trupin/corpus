import type { TopicSpec } from "../../registry/types.js";
import { archiveCommand } from "./archive.js";
import { checkCommand } from "./check.js";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { diffCommand } from "./diff.js";
import { editCommand } from "./edit.js";
import { listCommand } from "./list.js";
import { moveCommand } from "./move.js";
import { relatedCommand } from "./related.js";
import { showCommand } from "./show.js";
import { unarchiveCommand } from "./unarchive.js";

/**
 * The document lifecycle (SPEC.md §5, §7). Everything is a markdown document
 * with YAML frontmatter, and every one of these verbs is a thin call onto a
 * server endpoint: the CLI never opens a document file, never writes YAML and
 * never runs git. Key verification, anchor reconciliation, validation and the
 * auto-commit that records who did it all happen server-side.
 *
 * `list` is the enumeration — the collection query behind the board's columns;
 * `related` is its opposite number, the one-hop expansion from a document the
 * agent already holds, which with `corpus search` is how it locates content
 * without enumerating anything (SPEC.md §7); `show` is the single read; `diff`
 * is the read of a *change* rather than a state, and the one call a `doc.edited`
 * event's frugal payload is meant to be escalated into (SPEC.md §4); `check`
 * is the validator (SPEC.md §14) reported rather than run here; `create`,
 * `edit`, `move`, `archive` and `unarchive` are the agent's own initiative;
 * `delete` is the user's alone.
 */
export const docTopic: TopicSpec = {
  name: "doc",
  summary: "List, read, check, create, edit, move, archive, unarchive and delete documents.",
  description:
    "The stewardship surface (SPEC.md §7): the agent surveys the corpus through `list` — the " +
    "collection query behind the board's own columns, filters, Attention and search — expands " +
    "from a document it already holds through `related`, the follow-up move to `corpus search` " +
    "(SPEC.md §7) — reads documents through `show`, which is also **where a key comes from**: " +
    "replacing a body with `edit` means presenting the key that read handed out, and a write " +
    "without a valid one does not happen (SPEC.md §7). Anchors " +
    "resolve against the current body server-side, so reading the file would answer differently " +
    "— reads what a user's edit session changed through `diff`, which is where a `doc.edited` " +
    "event's stats are cashed in for the change itself (SPEC.md §4) — and creates, edits, moves " +
    "and archives them on its own initiative, **archiving where a " +
    "person would delete** and unarchiving to bring one back. Bodies come from `-m`, `--file` or stdin, so a heredoc is the normal " +
    "way to pass prose. Every mutation is attributed with `--from user|agent`, which becomes the " +
    "git author of the server's auto-commit — `git log` is the audit trail of who changed what. " +
    "`check` is the same topic's read-only verdict: SPEC.md §14's validator, run server-side over " +
    "documents, the whole workspace, or what is staged in git.",
  commands: [
    listCommand,
    relatedCommand,
    showCommand,
    diffCommand,
    checkCommand,
    createCommand,
    editCommand,
    moveCommand,
    archiveCommand,
    unarchiveCommand,
    deleteCommand,
  ],
};
