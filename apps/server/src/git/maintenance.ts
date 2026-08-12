/**
 * Repository-local settings that stop git maintaining a repository behind our
 * back — the repository half of what `sanitizeGitEnv` does for the
 * environment, which is why the two are exported side by side.
 *
 * Since git 2.29 every `git commit` ends by spawning
 * `git maintenance run --auto --quiet --detach`: a **detached background**
 * process that decides for itself whether to repack the object store. On git
 * 2.54 — what `CI / validate` runs — that decision comes out "yes" from the
 * tenth commit into a fresh repository (about seventy loose objects), and the
 * repack then runs concurrently with the commits that follow it and with any
 * `git log` beside them. Measured under git 2.54 on a fifty-one-commit loop in
 * a server test (since removed with §7's rollback verb), that race left the
 * repository **permanently corrupt** in 8 of 25 runs — `git fsck` reporting a missing commit, and
 * `git log -- <path>` dying with `cannot simplify commit X (because of Y)`
 * partway down the history — and in one run broke a `git commit` outright
 * ("failed to insert into database"). Git 2.37 never crosses the threshold in
 * that loop, which is why SERVER-089 was a CI-only failure.
 *
 * `maintenance.auto=false` is the setting that fixes it: it short-circuits the
 * dispatcher, so no child is spawned at all (measured 0 of 25 runs corrupt).
 *
 * `gc.auto=0` is **not** a fix and must not be mistaken for one — it was
 * SERVER-089's original hypothesis and measured 9 of 25 runs still corrupt.
 * The dispatcher spawns the maintenance child regardless of it, and the tasks
 * that repack read `maintenance.<task>.auto`, not `gc.auto`. It is set here
 * only for git releases before 2.29, where `gc --auto` *was* the dispatcher.
 */
const AUTO_MAINTENANCE_OFF: readonly (readonly [string, string])[] = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
];

/**
 * Turn off automatic maintenance in a freshly created repository.
 *
 * `run` is the caller's own git runner, already carrying the repository's
 * `cwd`: the settings are repository-local, so they also govern the git
 * children the server itself spawns against that repository.
 */
export function disableAutoMaintenance(run: (...args: string[]) => unknown): void {
  for (const [name, value] of AUTO_MAINTENANCE_OFF) run("config", name, value);
}
