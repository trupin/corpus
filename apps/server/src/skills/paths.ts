// Where the skills surface's two verbs address the filesystem (SPEC.md §7).
//
// One derivation, shared, because the rollback and the create must agree about
// what `<name>` means: the rollback resolves a name to the file it restores and
// the create resolves the same name to the file it writes, and a second copy of
// the rule is how a skill could be created at one path and be un-rollbackable at
// another. Pure string arithmetic — no filesystem access, no existence checks —
// exactly as `core/paths.ts` is for the document roots.
//
// **The name is not sanitized here, it is validated at the boundary.**
// `SkillNameSchema` (the contract's, shared with the rollback route's path
// parameter) admits no `/`, no `.` and no whitespace, so there is no traversal
// for this module to strip; a caller that skipped the schema is a bug, and the
// create path re-parses rather than trusting the string (defence in depth).

import { SKILLS_ARCHIVED_ROOT, SKILLS_ROOT } from "../docs/index.js";
import { SKILL_FILENAME } from "../projection/index.js";

/** The installed skill's own directory: `.claude/skills/<name>/`. */
export const skillFolderPath = (name: string): string => `${SKILLS_ROOT}/${name}`;

/**
 * Where a named skill's document lives. §7: archived skills are elsewhere and
 * are not installed.
 */
export const skillDocumentPath = (name: string): string =>
  `${skillFolderPath(name)}/${SKILL_FILENAME}`;

/**
 * Where `corpus doc archive` parks a skill of this name (§7) — the folder whose
 * existence makes the name unavailable to a create even though nothing occupies
 * the installed path. See `skills/create.ts` for why that is a conflict.
 */
export const archivedSkillFolderPath = (name: string): string => `${SKILLS_ARCHIVED_ROOT}/${name}`;
