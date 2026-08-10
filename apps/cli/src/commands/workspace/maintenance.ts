import { gitExitCode, gitFailure, runGit, type GitRunner } from "../init/git.js";

/**
 * Who maintains a Corpus workspace's git repository — the decision, and the
 * plumbing that carries it out (CLI-037).
 *
 * ## What git does on its own, and why it is wrong here
 *
 * Since git 2.29 every `git commit` ends by spawning
 * `git maintenance run --auto --quiet --detach`: a **detached background**
 * process that decides for itself whether to rewrite the object store. On git
 * 2.54 that dispatcher runs the *geometric* strategy, whose repacking task fires
 * when git's estimate of the loose-object count crosses 256 — and the estimate
 * is one directory (`.git/objects/17`) multiplied by 256, so the real firing
 * point is a coin toss that lands somewhere in the low hundreds of objects.
 * Measured through the product on git 2.54.0: a fresh `corpus init` workspace
 * driven by `corpus doc create` had its object store repacked behind Corpus's
 * back at the **41st commit**, while the server was running and writing.
 *
 * That is not a performance question. SPEC.md §4 makes git the audit trail and
 * the only recovery for a deletion, and §5 makes the files on disk the source of
 * truth; CLAUDE.md's Architecture Decision 2 makes the server their **sole
 * writer**. A repository with exactly one writer, which serializes its own
 * commits and reads them straight back (`corpus doc diff`, skill rollback, the
 * watcher's HEAD comparison), must not also have a second writer that Corpus
 * never scheduled, cannot observe, and cannot wait for. SERVER-089 measured what
 * the race costs when it lands: a permanently corrupt object store — `git fsck`
 * reporting a missing commit, `git log` dying with `cannot simplify commit` —
 * in 8 of 25 runs of a commit-then-read loop, with no self-healing.
 *
 * ## The ruling
 *
 * **Corpus un-schedules git's maintenance; it does not go without maintenance.**
 * {@link MAINTENANCE_SETTINGS} is written into every workspace repository, and
 * Corpus packs the repository itself at a moment it chooses — see
 * {@link maintainRepository} and its two callers, `corpus server start` and
 * `corpus workspace maintain`.
 *
 * Two settings, and only the first of them is the fix:
 *
 * - `maintenance.auto=false` short-circuits the dispatcher, so no child is
 *   spawned at all. SERVER-089 measured 0 of 25 runs corrupt with it, and 50 of
 *   50 clean afterwards.
 * - `gc.auto=0` is **not** a fix and must never be mistaken for one: it measured
 *   9 of 25 runs still corrupt. The dispatcher spawns regardless of it, and the
 *   task that repacks reads `maintenance.geometric-repack.auto`, not `gc.auto`.
 *   It is set only for git releases before 2.29, where `gc --auto` *was* the
 *   dispatcher.
 *
 * Neither setting stops an **explicit** `git gc` — `maintenance.auto` governs
 * only whether *other commands* trigger maintenance, and a `git gc` without
 * `--auto` never consults `gc.auto`. That is what makes this a rescheduling
 * rather than an abandonment: the same packing still happens, at the same
 * threshold git itself uses, run by Corpus in the foreground at a moment when
 * the repository provably has no other writer.
 */

/**
 * The repository-local settings that take git's background scheduler out of the
 * loop. Repository-local rather than passed with `-c` on each invocation,
 * because the writer they have to govern is the **server's** git children, not
 * the CLI's — and because a workspace cloned to a second machine has to arrive
 * with the same rule. Deliberately the same two keys, in the same order, as
 * `apps/server/src/git/maintenance.ts`, which applies them to its test fixtures.
 */
export const MAINTENANCE_SETTINGS: readonly (readonly [string, string])[] = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
];

/**
 * Loose objects at which Corpus packs — **git's own `gc.auto` default**, adopted
 * rather than invented.
 *
 * The point of taking a number from git is that this change moves *when* a
 * repository is packed and *who* packs it, not *how often*: at 6700 loose
 * objects git would have packed too. The one difference is that git estimates
 * that count from a single fanout directory and therefore fires anywhere from a
 * few hundred objects upward, while {@link readRepositoryObjects} counts them
 * exactly.
 *
 * A Corpus workspace writes roughly six loose objects per commit, so this is on
 * the order of a thousand commits between packs, and fewer once SHARED-040's
 * party-scoped commit windows fold several saves into one commit. Packing a
 * workspace of that size took 0.16 s measured on git 2.54.0.
 */
export const LOOSE_OBJECT_LIMIT = 6700;

/** What `git count-objects -v` says about the object store. */
export interface RepositoryObjects {
  readonly loose: number;
  readonly packed: number;
  readonly packs: number;
}

export async function readRepositoryObjects(
  dir: string,
  git: GitRunner = runGit,
): Promise<RepositoryObjects> {
  const { stdout } = await git(["count-objects", "-v"], dir);
  return {
    loose: readCount(stdout, "count"),
    packed: readCount(stdout, "in-pack"),
    packs: readCount(stdout, "packs"),
  };
}

/** `count-objects -v` is `key: value` per line; an absent or unparsable key reads as 0. */
function readCount(report: string, key: string): number {
  for (const line of report.split("\n")) {
    const [name, value] = line.split(":", 2);
    if (name?.trim() !== key) continue;
    const parsed = Number.parseInt((value ?? "").trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Writes any of {@link MAINTENANCE_SETTINGS} the repository does not already
 * carry, and reports which ones it wrote — empty when there was nothing to do,
 * which is the normal case after the first run.
 *
 * A value that disagrees is corrected rather than respected. `maintenance.auto`
 * is not a preference in a repository Corpus commits into dozens of times an
 * hour: leaving a `true` in place would reinstate the corruption hazard the
 * settings exist to remove, and a workspace whose audit trail is optional is not
 * a Corpus workspace. The setting is repository-local, so nothing outside this
 * workspace is touched.
 */
export async function ensureMaintenanceSettings(
  dir: string,
  git: GitRunner = runGit,
): Promise<readonly string[]> {
  const missing = await missingMaintenanceSettings(dir, git);
  for (const [name, value] of MAINTENANCE_SETTINGS) {
    if (missing.includes(name)) await git(["config", "--local", name, value], dir);
  }
  return missing;
}

/**
 * Which of {@link MAINTENANCE_SETTINGS} the repository does not already carry,
 * **writing nothing**. Split out so `corpus workspace upgrade --dry-run` can
 * predict this repair like it predicts every other one: a plan that quietly
 * omits a write the real run would make is the failure mode that file's own
 * comments call out.
 */
export async function missingMaintenanceSettings(
  dir: string,
  git: GitRunner = runGit,
): Promise<readonly string[]> {
  const missing: string[] = [];
  for (const [name, value] of MAINTENANCE_SETTINGS) {
    if ((await readLocalConfig(git, dir, name)) !== value) missing.push(name);
  }
  return missing;
}

/** `git config --get` exits 1 for a key that is not set; that is an answer, not a failure. */
async function readLocalConfig(
  git: GitRunner,
  dir: string,
  name: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await git(["config", "--local", "--get", name], dir);
    return stdout.trim();
  } catch (cause) {
    if (gitExitCode(cause) === 1) return undefined;
    throw cause;
  }
}

export interface MaintenanceOutcome {
  /** Settings written by this run; empty when the repository already carried them. */
  readonly settings: readonly string[];
  readonly before: RepositoryObjects;
  /** The object store after packing, or `null` when nothing was packed. */
  readonly after: RepositoryObjects | null;
  readonly packed: boolean;
  /** The loose-object count above which this run would have packed. */
  readonly threshold: number;
}

export interface MaintainOptions {
  readonly dir: string;
  readonly git?: GitRunner;
  /** Pack whatever the count says. */
  readonly force?: boolean;
  /** Apply the settings and report the counts, but never pack. */
  readonly settingsOnly?: boolean;
  readonly threshold?: number;
}

/**
 * Ensure the settings, then pack if the object store has earned it.
 *
 * **Every caller must have established that nothing else is writing to the
 * repository**, and that is the whole reason this is a function the CLI calls
 * at a chosen moment rather than a config value git consults whenever it likes.
 * `corpus server start` calls it after it has proved that no server for this
 * workspace is running and nothing holds the port — the one instant in a
 * workspace's life when the sole writer is provably absent. `corpus workspace
 * maintain` re-establishes the same fact by refusing outright while the server
 * is up. `corpus workspace upgrade` passes `settingsOnly`, because it is allowed
 * to run against a live server and packing there would be the very race this
 * module exists to remove.
 *
 * Packing is `git gc`, in the foreground, un-detached: a background repack that
 * fails silently is what we are removing, and replacing it with our own would be
 * no improvement. `gc` prunes only *unreachable* objects, so nothing §4 promises
 * is at risk — a deleted document stays reachable from the commit that deleted
 * it, which is exactly what makes git the recovery path.
 */
export async function maintainRepository(options: MaintainOptions): Promise<MaintenanceOutcome> {
  const git = options.git ?? runGit;
  const threshold = options.threshold ?? LOOSE_OBJECT_LIMIT;

  const settings = await ensureMaintenanceSettings(options.dir, git);
  const before = await readRepositoryObjects(options.dir, git);

  const packed =
    options.settingsOnly !== true && (options.force === true || before.loose > threshold);
  if (!packed) return { settings, before, after: null, packed: false, threshold };

  await git(["gc", "--quiet"], options.dir);
  return {
    settings,
    before,
    after: await readRepositoryObjects(options.dir, git),
    packed: true,
    threshold,
  };
}

/**
 * The outcome as human lines — **none at all** when there was nothing to say,
 * which is what makes this safe to call from `corpus server start` on every run.
 * A tool that narrates its own housekeeping every time teaches people to stop
 * reading it, and the two things worth saying here are both one-offs: the first
 * time a workspace is brought under Corpus's maintenance, and each time the
 * repository is actually packed.
 */
export function renderMaintenance(outcome: MaintenanceOutcome): readonly string[] {
  const lines: string[] = [];
  if (outcome.settings.length > 0) {
    lines.push(
      `git: turned off git's own background maintenance in this repository ` +
        `(${outcome.settings.join(", ")}) — corpus packs it at server start instead`,
    );
  }
  if (outcome.after !== null) {
    lines.push(
      `git: packed ${String(outcome.before.loose)} loose objects ` +
        `(now ${String(outcome.after.loose)} loose in ${String(outcome.after.packs)} ` +
        `${outcome.after.packs === 1 ? "pack" : "packs"})`,
    );
  }
  return lines;
}

/**
 * Maintenance must never be the reason a server will not start. A workspace that
 * failed to pack is slow; a workspace whose server refuses to come up because
 * `git gc` failed is unusable, and the operator cannot even reach the board to
 * find out why. So `corpus server start` takes this wrapper: the failure is
 * reported in full and the start proceeds.
 */
export async function maintainOrWarn(
  options: MaintainOptions,
): Promise<{ readonly lines: readonly string[]; readonly outcome: MaintenanceOutcome | null }> {
  try {
    const outcome = await maintainRepository(options);
    return { lines: renderMaintenance(outcome), outcome };
  } catch (cause) {
    return {
      lines: [`warning: ${gitFailure("maintaining the workspace repository", cause).message}`],
      outcome: null,
    };
  }
}
