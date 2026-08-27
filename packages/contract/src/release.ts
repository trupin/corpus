import { z } from "zod";
import type { UpgradeCheck } from "./schemas/upgrade.js";

/**
 * "Is there a newer Corpus, and can it be installed?" — the read-only half of
 * SPEC.md §2.4, as a function of one HTTP request.
 *
 * Two constraints shape everything here.
 *
 * **On demand, never in the background.** §2.4 opens with it: Corpus "never
 * checks for, downloads, or installs anything in the background, and never
 * phones home". So there is no cache, no timestamp, no schedule and no state
 * between calls — this module reaches GitHub exactly when a person or an agent
 * asked it to, once, and forgets.
 *
 * **Two independent verdicts.** A newer release existing ({@link UpgradeCheck}'s
 * `upgradeAvailable`) is not the same as that release being installable
 * (`verifiable`). §2.4 requires the upgrade to verify "its published checksum",
 * which INFRA-016 publishes as a `<tarball>.sha256` asset beside the tarball; a
 * release cut before that existed is a real release with a real version number
 * that `corpus upgrade` will nonetheless refuse. Folding the two into one
 * boolean would leave a caller unable to tell "you are up to date" from "there
 * is a newer version you must install by hand", so the shape here is the
 * contract's `UpgradeCheck` verbatim — declared beside it, so the day the API's
 * shape moves, this stops compiling.
 *
 * **Why this lives in the contract package and not in the CLI that wrote it**
 * (CONTRACT-090). Two callers need this judgment: `corpus upgrade`, which acts
 * on it, and `GET /api/upgrade/check`, which publishes it to the board. Apps do
 * not import apps here, and `package:build` bundles the CLI and the server
 * separately with every `@corpus/*` import inlined — so the server cannot reach
 * the CLI's copy, and a second copy is the one duplication that costs something.
 * `verifiable` exists because a release can look upgradable and still be
 * refused; two implementations disagreeing is a server offering an "Upgrade &
 * restart" action the upgrade then declines. The type and the code that
 * computes it belong in one place, and this package is the place both consumers
 * already depend on. It is shared logic beside `scope.ts` and `turns.ts`, not
 * route surface: it imports no route and no generated client, and the package
 * stays `sideEffects: false` so the browser bundle never grows a GitHub client
 * it does not call.
 */

/** Where the release list is read from. Overridable so tests can serve a fixture. */
export const DEFAULT_RELEASES_API = "https://api.github.com";

/**
 * The distribution `corpus upgrade` upgrades to.
 *
 * Hard-coded rather than derived from the installed `package.json`: the
 * published manifest carries `repository.url`, but the monorepo's own manifests
 * do not, so deriving it would work in a global install and silently answer
 * "nowhere" in development — the one place it gets exercised. `CORPUS_RELEASES_*`
 * is the seam for a fork, a mirror, or a test.
 */
export const DEFAULT_RELEASES_REPO = "trupin/corpus";

export const RELEASES_API_ENV_VAR = "CORPUS_RELEASES_API";
export const RELEASES_REPO_ENV_VAR = "CORPUS_RELEASES_REPO";

/** GitHub rejects unidentified clients; the version makes an abuse report actionable. */
export function userAgent(version: string): string {
  return `corpus-cli/${version}`;
}

export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
}

export interface Release {
  /** The git tag, as published — usually `v0.3.0`. */
  readonly tag: string;
  /** The tag with any leading `v` removed, which is what versions are compared as. */
  readonly version: string;
  /** The release's own page, for a human to read before accepting an upgrade. */
  readonly notesUrl: string | null;
  readonly assets: readonly ReleaseAsset[];
}

/**
 * What the lookup found. "Could not look" is a described answer rather than a
 * throw, because an offline laptop, a captive portal and a rate limit are
 * ordinary conditions for a local-first tool — the check succeeded at reporting
 * them, and only a full upgrade run has cause to refuse over it.
 */
export type ReleaseLookup =
  | { readonly kind: "found"; readonly release: Release }
  /** GitHub answered, and this distribution has published no releases yet. */
  | { readonly kind: "none" }
  | { readonly kind: "unreachable"; readonly detail: string };

const ReleasePayloadSchema = z.looseObject({
  tag_name: z.string().min(1),
  html_url: z.string().min(1).optional(),
  assets: z
    .array(z.looseObject({ name: z.string().min(1), browser_download_url: z.string().min(1) }))
    .default([]),
});

export interface LookupOptions {
  readonly fetch: typeof globalThis.fetch;
  /** Base of the releases API — `https://api.github.com` unless overridden. */
  readonly api: string;
  /** `owner/name`. */
  readonly repo: string;
  /** Version of this tool, for the User-Agent. */
  readonly version: string;
  readonly timeoutMs: number;
}

/** Reads the API base and repository from the environment, defaults otherwise. */
export function releaseSource(env: Readonly<Record<string, string | undefined>>): {
  readonly api: string;
  readonly repo: string;
} {
  const api = env[RELEASES_API_ENV_VAR]?.trim();
  const repo = env[RELEASES_REPO_ENV_VAR]?.trim();
  return {
    api: api === undefined || api === "" ? DEFAULT_RELEASES_API : api.replace(/\/+$/, ""),
    repo: repo === undefined || repo === "" ? DEFAULT_RELEASES_REPO : repo,
  };
}

/**
 * One request for the newest published release. `/releases/latest` is the right
 * endpoint rather than `/releases`: GitHub excludes drafts and pre-releases from
 * it, and a pre-release is not what "upgrade me" means.
 */
export async function lookupLatestRelease(options: LookupOptions): Promise<ReleaseLookup> {
  const url = `${options.api}/repos/${options.repo}/releases/latest`;

  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": userAgent(options.version),
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    return { kind: "unreachable", detail: `${url} could not be reached (${reason(cause)})` };
  }

  // A repository with no releases answers 404, which is a fact about the
  // distribution and not a failure to look.
  if (response.status === 404) return { kind: "none" };

  if (!response.ok) {
    const rateLimited =
      response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
    return {
      kind: "unreachable",
      detail: rateLimited
        ? `${url} answered 403: this IP has exhausted GitHub's unauthenticated rate limit; it resets within the hour`
        : `${url} answered ${String(response.status)} ${response.statusText}`.trimEnd(),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    return { kind: "unreachable", detail: `${url} did not answer JSON (${reason(cause)})` };
  }

  const parsed = ReleasePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { kind: "unreachable", detail: `${url} answered a release this tool cannot read` };
  }

  const tag = parsed.data.tag_name;
  return {
    kind: "found",
    release: {
      tag,
      version: tag.replace(/^v/, ""),
      notesUrl: parsed.data.html_url ?? null,
      assets: parsed.data.assets.map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
      })),
    },
  };
}

export interface ReleaseAssets {
  readonly tarball: ReleaseAsset;
  readonly checksum: ReleaseAsset;
}

export type AssetSelection =
  | { readonly kind: "ok"; readonly assets: ReleaseAssets }
  | { readonly kind: "missing"; readonly detail: string };

/**
 * The installable pair, found by **shape** rather than by name.
 *
 * The published package name is still provisional (`scripts/package-manifest.ts`
 * says so in as many words), so matching `corpus-<version>.tgz` would hard-code
 * a decision nobody has made and break the day it is made. What is not
 * provisional is the release workflow's structure: one `npm pack` tarball, and
 * beside it the same filename with `.sha256` appended, in `shasum -a 256`'s
 * two-field format (INFRA-016). Two tarballs is an ambiguity rather than a
 * choice to make — the whole posture of §2.4 is refusing rather than guessing.
 */
export function selectAssets(release: Release): AssetSelection {
  const tarballs = release.assets.filter((asset) => asset.name.endsWith(".tgz"));
  const tarball = tarballs[0];
  if (tarball === undefined) {
    return { kind: "missing", detail: `release ${release.tag} publishes no .tgz tarball` };
  }
  if (tarballs.length > 1) {
    return {
      kind: "missing",
      detail:
        `release ${release.tag} publishes ${String(tarballs.length)} tarballs ` +
        `(${tarballs.map((asset) => asset.name).join(", ")}) and nothing says which is the tool`,
    };
  }

  const checksum = release.assets.find((asset) => asset.name === `${tarball.name}.sha256`);
  if (checksum === undefined) {
    return {
      kind: "missing",
      detail:
        `release ${release.tag} publishes ${tarball.name} but no ${tarball.name}.sha256, ` +
        "so its bytes cannot be verified",
    };
  }
  return { kind: "ok", assets: { tarball, checksum } };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

/**
 * `-1`, `0`, `1`, or `undefined` when either side is not a version this tool can
 * order. Undefined is a real answer and never silently zero: an incomparable
 * pair means the caller must not claim an upgrade is available, and must not
 * claim the workspace is current either.
 */
export function compareVersions(one: string, other: string): number | undefined {
  const left = SEMVER.exec(one.replace(/^v/, ""));
  const right = SEMVER.exec(other.replace(/^v/, ""));
  if (left === null || right === null) return undefined;

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }

  // Same numbers: a pre-release precedes the release it leads to (semver §10),
  // so `0.4.0-rc.1` is older than `0.4.0` and never an upgrade target for it.
  const leftPre = left[4];
  const rightPre = right[4];
  if (leftPre === rightPre) return 0;
  if (leftPre === undefined) return 1;
  if (rightPre === undefined) return -1;
  return leftPre === rightPre ? 0 : leftPre > rightPre ? 1 : -1;
}

/** The check, and — when there is one to install — the pair of assets it names. */
export interface ReleaseVerdict {
  readonly check: UpgradeCheck;
  readonly release: Release | null;
  readonly assets: ReleaseAssets | null;
}

export function evaluateRelease(installed: string, lookup: ReleaseLookup): ReleaseVerdict {
  const empty = {
    installed,
    latest: null,
    upgradeAvailable: false,
    verifiable: false,
    notesUrl: null,
  };

  if (lookup.kind === "unreachable") {
    return {
      check: { ...empty, reachable: false, detail: lookup.detail },
      release: null,
      assets: null,
    };
  }
  if (lookup.kind === "none") {
    return {
      check: {
        ...empty,
        reachable: true,
        detail: "this distribution has published no releases yet",
      },
      release: null,
      assets: null,
    };
  }

  const release = lookup.release;
  const order = compareVersions(release.version, installed);
  const selection = selectAssets(release);
  const verifiable = selection.kind === "ok";
  const base = {
    installed,
    latest: release.version,
    notesUrl: release.notesUrl,
    reachable: true as const,
  };

  if (order === undefined) {
    return {
      check: {
        ...base,
        upgradeAvailable: false,
        verifiable,
        detail:
          `installed ${installed} and released ${release.version} cannot be ordered, ` +
          "so no upgrade is offered — install it by hand if it is the one you want",
      },
      release,
      assets: verifiable && selection.kind === "ok" ? selection.assets : null,
    };
  }

  const upgradeAvailable = order > 0;
  const detail =
    !upgradeAvailable || verifiable
      ? null
      : `${selection.kind === "missing" ? selection.detail : ""}; SPEC.md §2.4 has corpus verify a ` +
        "published checksum before installing, so this release is not an upgrade target";

  return {
    check: { ...base, upgradeAvailable, verifiable, detail },
    release,
    assets: selection.kind === "ok" ? selection.assets : null,
  };
}

function reason(cause: unknown): string {
  if (cause instanceof Error) {
    // `AbortSignal.timeout` rejects with a TimeoutError whose message is
    // "The operation was aborted due to timeout" — accurate but not obviously
    // about the network, which is what the reader needs to know.
    return cause.name === "TimeoutError" ? "timed out" : cause.message;
  }
  return String(cause);
}
