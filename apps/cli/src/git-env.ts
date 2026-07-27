/**
 * Environment sanitization for every child process the CLI spawns.
 *
 * Lives at the src root rather than beside one of its callers because both of
 * them need it and neither owns it: `corpus init` runs git directly
 * (`commands/init/git.ts`), and `corpus server start` hands an environment to a
 * daemon that is the workspace's sole writer and commits on its own
 * (`commands/server/daemon.ts`). One implementation, or the two drift.
 */

export type ChildEnv = Readonly<Record<string, string | undefined>>;

/**
 * The environment minus every variable git claims for itself.
 *
 * git takes the repository it operates on, the index it stages into and the
 * identity it commits under from the ambient environment — `GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_AUTHOR_*`,
 * `GIT_CONFIG_*` and the rest — and it *exports* all of them when it runs a
 * hook. A `corpus` command invoked from inside any hook therefore inherits a
 * pointer to that hook's repository: `corpus init` would scaffold and commit
 * into it, and `corpus server start` would hand the same pointer to a
 * long-lived daemon whose every auto-commit (SPEC.md §2.2) would land there.
 *
 * Stripping the whole `GIT_` namespace rather than a hand-listed subset is
 * deliberate: the list is long, version-dependent, and any variable missed from
 * it is silently the same bug. Everything else — `PATH`, `HOME`, the caller's
 * own variables — is preserved untouched, leaving each caller's explicit
 * arguments as the sole source of git's behaviour.
 */
export function sanitizeGitEnv(env: ChildEnv = process.env): Record<string, string | undefined> {
  return Object.fromEntries(
    // Case-insensitively: on Windows `git_dir` names the same variable as `GIT_DIR`.
    Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
  );
}
