/**
 * Pure decisions behind `npm run release:prepare` (INFRA-022).
 *
 * The runner in `scripts/release-prepare.ts` owns the process spawning; this
 * module owns the judgements that need pinning by tests: what counts as a
 * release version, what a bump is allowed to have touched, and what the commit
 * and tag are named.
 */

/**
 * Explicit `x.y.z` (optionally pre-release / build metadata). Deliberately not
 * npm's `patch` / `minor` / `major` keywords: the tag name has to be known
 * *before* anything is written, so that an already-existing tag stops the run
 * while the tree is still clean.
 */
const RELEASE_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface ReleaseRequest {
  readonly version: string;
  /** Optional headline, appended to the commit and tag messages. */
  readonly title?: string;
}

export type ReleaseArgs = ReleaseRequest | { readonly error: string };

export function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const [version, title, ...rest] = positional;
  if (version === undefined) return { error: 'usage: npm run release:prepare <x.y.z> ["title"]' };
  if (rest.length > 0) {
    return {
      error: `expected a version and at most one title, got ${String(positional.length)} arguments — quote the title`,
    };
  }
  if (!RELEASE_VERSION.test(version)) {
    return {
      error:
        `"${version}" is not an explicit version. release:prepare takes x.y.z ` +
        "(not `patch`/`minor`/`major`) so the tag it will create is known before anything is written",
    };
  }
  return title === undefined || title === "" ? { version } : { version, title };
}

export function releaseTag(version: string): string {
  return `v${version}`;
}

/**
 * Bracket-prefixed like every other commit in this repo (CLAUDE.md, Git
 * Workflow), and titled like the release commits already on `main`
 * (`[RELEASE] v0.3.0 — comments that stay where you put them`). `RELEASE`
 * rather than an issue id: this commit belongs to the release, not to whatever
 * issue last touched the version.
 */
export function releaseCommitMessage(version: string, title?: string): string {
  const subject = `[RELEASE] ${releaseTag(version)}`;
  return title === undefined || title === "" ? subject : `${subject} — ${title}`;
}

/** The annotated tag's message: the same headline, without the commit prefix. */
export function releaseTagMessage(version: string, title?: string): string {
  const tag = releaseTag(version);
  return title === undefined || title === "" ? tag : `${tag} — ${title}`;
}

export const LOCKFILE = "package-lock.json";

/**
 * Repo-relative paths a version bump is expected to have rewritten.
 *
 * The lockfile is here because `npm version` always rewrites it — but "expected
 * to have changed" is not "expected to contain anything"; what it is allowed to
 * contain is `classifyLockfileChange`'s job.
 */
export function expectedBumpPaths(workspaceManifestPaths: readonly string[]): string[] {
  return ["package.json", LOCKFILE, ...workspaceManifestPaths];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

/** `packages["apps/cli"].version` — readable enough to act on in an error message. */
function childPath(parent: string, key: string): string {
  if (!PLAIN_KEY.test(key)) return `${parent}[${JSON.stringify(key)}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

/** A `version` field, and not merely a key that happens to end in those letters. */
function isVersionField(path: string): boolean {
  return path === "version" || path.endsWith(".version");
}

function collectDifferences(
  before: unknown,
  after: unknown,
  version: string,
  path: string,
  out: string[],
): void {
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      collectDifferences(before[key], after[key], version, childPath(path, key), out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      collectDifferences(before[index], after[index], version, `${path}[${index}]`, out);
    }
    return;
  }
  if (before === after) return;
  // The one difference a bump is *for*: a `version` field moved to the release
  // version. A `version` moved to anything else is not this bump's doing.
  if (isVersionField(path) && after === version) return;
  out.push(path === "" ? "(the whole document)" : path);
}

export interface LockfileChange {
  /**
   * Everything the lockfile moved that is not a `version` field carrying the
   * release version, as readable JSON paths.
   */
  readonly unexpected: readonly string[];
}

/**
 * What the lockfile changed, beyond the bump itself.
 *
 * `npm version` runs an install, so a lockfile that had drifted from the
 * manifests — a dependency edited without reinstalling, a changed `overrides`
 * block, a different npm major — is *repaired* by the bump. The repair is not
 * wrong, but it would ride into a commit whose subject promises a version bump
 * and nothing else, and be reviewed by nobody. Naming what else moved is what
 * turns that into a decision instead of an accident.
 */
export function classifyLockfileChange(
  before: string,
  after: string,
  version: string,
): LockfileChange {
  const unexpected: string[] = [];
  collectDifferences(JSON.parse(before), JSON.parse(after), version, "", unexpected);
  return { unexpected };
}

/**
 * Paths out of `git status --porcelain`. Rename entries (`R  old -> new`) report
 * the destination — a bump produces none, but a parser that mangles one would
 * hide it from the unexpected-change guard below.
 */
export function parsePorcelainPaths(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    const entry = line.slice(3);
    const arrow = entry.indexOf(" -> ");
    paths.push(arrow === -1 ? entry : entry.slice(arrow + 4));
  }
  return paths;
}

export interface BumpChanges {
  /** Expected paths that actually changed, in a stable order, to be staged by name. */
  readonly toStage: readonly string[];
  /**
   * Anything else the bump touched. Never staged: the run aborts instead. The
   * tree was clean going in, so an unexpected change means `npm version` did
   * something this script does not model, and quietly sweeping it into a release
   * commit is how a release grows contents nobody reviewed.
   */
  readonly unexpected: readonly string[];
}

export function classifyBumpChanges(
  changed: readonly string[],
  expected: readonly string[],
): BumpChanges {
  const changedSet = new Set(changed);
  const expectedSet = new Set(expected);
  return {
    toStage: expected.filter((path) => changedSet.has(path)),
    unexpected: changed.filter((path) => !expectedSet.has(path)),
  };
}
