/**
 * Environment sanitization for every git child process the **server** spawns.
 *
 * A deliberate duplicate of `apps/cli/src/git-env.ts` (sprint-005 Open Conflict
 * 6, adjudicated): `apps/server` may not import from `apps/cli` — the dependency
 * direction in CLAUDE.md forbids it — and a shared package for eight lines is
 * premature. The two implementations must stay behaviourally identical; both
 * carry this cross-reference and both are pinned by mirrored tests
 * (`apps/cli/src/git-env.test.ts`, `./env.test.ts`).
 */

export type ChildEnv = Readonly<Record<string, string | undefined>>;

/**
 * The environment minus every variable git claims for itself.
 *
 * git takes the repository it operates on, the index it stages into and the
 * identity it commits under from the ambient environment — `GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_AUTHOR_*`,
 * `GIT_CONFIG_*` and the rest — and it *exports* all of them when it runs a
 * hook. A server started from inside a git hook (or from a shell that once
 * exported them) would otherwise commit every workspace mutation into that
 * hook's repository, under that hook's identity. The server is the sole writer
 * (Architecture Decision 2) and commits on every mutation (SPEC.md §4), so this
 * is the difference between an audit trail and silent cross-repository writes.
 *
 * Stripping the whole `GIT_` namespace rather than a hand-listed subset is
 * deliberate: the list is long, version-dependent, and any variable missed from
 * it is silently the same bug. Matching is case-insensitive because the
 * lowercase spellings reach git's config machinery on case-insensitive
 * platforms. Everything else — `PATH`, `HOME`, the operator's own variables —
 * is preserved untouched, leaving each call site's explicit arguments as the
 * sole source of git's behaviour.
 */
export function sanitizeGitEnv(env: ChildEnv = process.env): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
  );
}
