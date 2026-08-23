import type { TopicSpec } from "../../registry/types.js";
import { deleteCommand } from "./delete.js";
import { renameCommand } from "./rename.js";
import { archiveCommand, unarchiveCommand } from "./status.js";

/**
 * The folder acts (SPEC.md §9.2, rider 7 signed 2026-08-22).
 *
 * Every other write path in this CLI takes one document id. These four take a
 * **directory**, and each is a bulk act over everything under it: the explorer
 * offers a folder the standard actions a person expects of one, and the agent —
 * whose whole surface is this CLI (§2.3) — must be able to do the same without
 * looping a per-document verb over a listing it had to fetch first.
 *
 * Four rules the whole topic shares, stated once here because they are the
 * things a caller gets wrong:
 *
 * - **A path is relative to `data/docs/` and is compared byte-exactly.** No
 *   `data/docs/` prefix, no leading or trailing slash, no segment beginning with
 *   a dot, and no case folding — `FINANCE` is a `404` in a workspace holding
 *   `finance`. Nothing is normalised on the way out: a path corrected on the
 *   caller's behalf moves files they did not name.
 * - **Every act names every document it touched**, including ones the request
 *   never named, and the rows report **the state after the act** rather than
 *   what changed: an archive lists documents that were already archived, and a
 *   rename lists a thread at its unchanged `data/threads/<id>.md` path, because
 *   what moved is which folder the thread belongs to (§6).
 * - **Archiving moves nothing and deleting moves nothing back.** Archive is a
 *   status act over the folder in place, which is what makes `unarchive` its
 *   inverse; delete is the user's alone, like deleting a document.
 * - **A `type: skill` document is archived by `corpus doc archive`, never here.**
 *   Its folder has to move with its status, and `.claude/` is outside this path
 *   grammar by construction.
 */
export const folderTopic: TopicSpec = {
  name: "folder",
  summary: "Rename, archive, unarchive and delete a folder and everything in it.",
  description:
    "The directory-level acts of SPEC.md §9.2, over `data/docs/<path>`. Each is a **bulk act** " +
    "and each names every document it changed — including documents the request never named, " +
    "since a thread inherits its parent's folder (§6) — so a caller updates itself from the " +
    "output instead of re-listing the folder. Each lands as the single auto-commit §4 requires, " +
    "authored by `--from`.\n\n" +
    "**Paths are relative to `data/docs/` and compared exactly.** Write `finance` or " +
    "`finance/mortgage`: no `data/docs/` prefix, no leading or trailing slash, no empty segment, " +
    "no segment beginning with a dot, and no case folding — `FINANCE` is a `404` in a workspace " +
    "holding `finance`. A malformed path is a `400` naming the reason; a well-formed path this " +
    "workspace does not hold is a `404`. Skills live outside this root and are archived by " +
    "document (`corpus doc archive`), which moves their folder along with their status.\n\n" +
    "`archive` and `unarchive` are the same act in two directions and **move nothing**: the " +
    "folder stays exactly where it is, which is what makes one the inverse of the other. " +
    "`rename` moves the files and keeps every id, so every `[[ref]]`, anchor and thread `parent` " +
    "goes on resolving. `delete` is **user-only**, like deleting a document, and refuses without " +
    "`--yes` after printing what it would remove.",
  commands: [renameCommand, archiveCommand, unarchiveCommand, deleteCommand],
};
