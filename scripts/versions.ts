/**
 * Version singularity (INFRA-008): **one** version number describes the tool.
 *
 * Corpus publishes a single package assembled out of five workspaces. Nothing
 * stops those workspaces drifting apart on their own, and a drifted version is
 * only discovered when a release tag disagrees with what was published — the
 * worst possible moment. So the root `package.json`'s `version` is declared the
 * single source, every workspace manifest must equal it, and when a release
 * workflow runs, the `v*` tag must equal it too.
 *
 * The check runs over **two** trees, not one (INFRA-022): the working tree and
 * the committed tree. A check that only reads disk passes while the tree a `v*`
 * tag points at would fail — which is exactly how a release was lost.
 *
 * Pure: `scripts/version-sources.ts` reads the manifests out of disk and out of
 * git, `scripts/check-versions.ts` reads the environment, and both hand them
 * here.
 */

/** One manifest under inspection. `version` is `undefined` when the field is absent. */
export interface ManifestVersion {
  /** Repo-relative path of the `package.json`, for the failure message. */
  readonly path: string;
  readonly version: string | undefined;
}

export interface VersionCheckInput {
  /** The root manifest — the single source of truth. */
  readonly root: ManifestVersion;
  /** Every workspace manifest, in any order. */
  readonly workspaces: readonly ManifestVersion[];
  /**
   * `GITHUB_REF` as the release workflow sees it. Only `refs/tags/v*` values
   * participate; a branch ref or `undefined` means "not a release run".
   */
  readonly gitRef?: string | undefined;
}

export interface VersionCheckResult {
  readonly ok: boolean;
  /** The version everything must equal, when the root declares one. */
  readonly version: string | undefined;
  /** One line per problem; empty when `ok`. */
  readonly problems: readonly string[];
}

const TAG_REF_PREFIX = "refs/tags/";

/**
 * The version a `refs/tags/v1.2.3` ref names, or `undefined` for any ref that is
 * not a `v`-prefixed tag. Tags are the release trigger; branches are not.
 */
export function versionFromGitRef(gitRef: string | undefined): string | undefined {
  if (gitRef === undefined || !gitRef.startsWith(TAG_REF_PREFIX)) return undefined;
  const tag = gitRef.slice(TAG_REF_PREFIX.length);
  return tag.startsWith("v") ? tag.slice(1) : undefined;
}

/**
 * One tree's worth of manifests. There are two (INFRA-022): what is on disk and
 * what is committed. They are checked separately because they can disagree — and
 * the disagreement is the whole bug: `npm version --workspaces` rewrites every
 * manifest but commits only the root, so the working tree is correct while the
 * commit the tag points at is not.
 */
export interface VersionSource {
  /** Names the tree in every message it produces, e.g. `working tree`. */
  readonly label: string;
  readonly root: ManifestVersion;
  readonly workspaces: readonly ManifestVersion[];
}

export interface VersionSourceCheck {
  readonly label: string;
  readonly version: string | undefined;
  readonly ok: boolean;
}

export interface VersionSourcesResult {
  readonly ok: boolean;
  /** One entry per source, in input order — enough to print the success line. */
  readonly checks: readonly VersionSourceCheck[];
  /**
   * Labelled and deduplicated. Ordinary drift is present in both trees, and
   * saying it twice would train the reader to skim past the one case where the
   * two trees differ — which is precisely the case worth noticing.
   */
  readonly problems: readonly string[];
}

export function checkVersionSources(
  sources: readonly VersionSource[],
  gitRef?: string,
): VersionSourcesResult {
  const checks: VersionSourceCheck[] = [];
  const grouped = new Map<string, { labels: string[]; problems: readonly string[] }>();

  for (const source of sources) {
    const result = checkVersions({ root: source.root, workspaces: source.workspaces, gitRef });
    checks.push({ label: source.label, version: result.version, ok: result.ok });
    if (result.ok) continue;
    const key = result.problems.join("\n");
    const group = grouped.get(key);
    if (group === undefined)
      grouped.set(key, { labels: [source.label], problems: result.problems });
    else group.labels.push(source.label);
  }

  const problems: string[] = [];
  for (const group of grouped.values()) {
    const prefix = group.labels.join(" and ");
    for (const problem of group.problems) problems.push(`${prefix}: ${problem}`);
  }

  return { ok: problems.length === 0, checks, problems };
}

export function checkVersions(input: VersionCheckInput): VersionCheckResult {
  const problems: string[] = [];
  const version = input.root.version;

  if (version === undefined || version === "") {
    problems.push(
      `${input.root.path} declares no "version" — it is the single source every workspace matches`,
    );
    return { ok: false, version: undefined, problems };
  }

  for (const workspace of input.workspaces) {
    if (workspace.version === undefined || workspace.version === "") {
      problems.push(`${workspace.path} declares no "version" (expected ${version})`);
    } else if (workspace.version !== version) {
      problems.push(`${workspace.path} is ${workspace.version}, expected ${version}`);
    }
  }

  const tagged = versionFromGitRef(input.gitRef);
  if (tagged !== undefined && tagged !== version) {
    problems.push(
      `the release tag names ${tagged} but the package is ${version} — ` +
        "tag and manifest must agree before anything is published",
    );
  }

  return { ok: problems.length === 0, version, problems };
}
