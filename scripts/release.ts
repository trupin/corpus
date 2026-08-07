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

/** Repo-relative paths a version bump is expected to have rewritten. */
export function expectedBumpPaths(workspaceManifestPaths: readonly string[]): string[] {
  return ["package.json", "package-lock.json", ...workspaceManifestPaths];
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
