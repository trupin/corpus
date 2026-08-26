import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { RefusedError } from "../../errors.js";
import type { VerifiedTarball } from "./install.js";

/**
 * `corpus upgrade --unstable` — installing a **pull-request build** rather than
 * a release (SPEC.md §2.4, rider signed 2026-08-12).
 *
 * This is a deliberate second source, kept whole and separate from
 * `@corpus/contract`'s release lookup. The stable path's guarantees — a
 * published release, a verified checksum, no credential — are the reason people
 * trust `corpus upgrade`, and the way to keep them is to not thread an
 * `unstable` boolean through the middle of that code. The *install* half is
 * shared; the *lookup* half is forked, which is this file.
 *
 * **Four deviations from the stable path, every one of them stated rather than
 * worked around**, because the rider requires the command to say what it is
 * giving up:
 *
 * 1. **A token is required.** Workflow artifacts are not anonymously
 *    downloadable even on a public repository — `actions: read` is needed — so
 *    the command refuses with instructions when it cannot find one, and never
 *    falls back to a release.
 * 2. **Artifacts expire**, on CI's retention schedule. An older PR routinely has
 *    no build at all, and that is an ordinary answer naming the window.
 * 3. **The download is a zip containing the tarball**, not the tarball.
 * 4. **There is no published checksum.** §2.4 has the stable path verify one
 *    before installing; this path cannot, so the verification does not run and
 *    every install says so.
 */

/** How long CI keeps a PR artifact (INFRA-026). Named so the refusals can say it. */
export const ARTIFACT_RETENTION_DAYS = 14;

export const CORPUS_TOKEN_ENV_VAR = "CORPUS_GITHUB_TOKEN";
export const GITHUB_TOKEN_ENV_VAR = "GITHUB_TOKEN";

/**
 * INFRA-026's scheme, as the one thing this command parses out of a name:
 * `corpus-<version>-pr<N>-<sha_short>`. `docs/RELEASING.md` is where it is
 * written down, and where the workflow is told it may not change it alone.
 *
 * Anything else in the repository's artifact list — the coverage bundles, a
 * build made before the scheme landed — simply does not match and is skipped.
 * Skipped, never crashed on: an artifact list is a shared namespace and a
 * command that fell over on somebody else's entry would be broken by a workflow
 * it has nothing to do with.
 */
const ARTIFACT_NAME = /^corpus-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-pr(\d+)-([0-9a-f]{7,40})$/;

export interface ArtifactName {
  readonly version: string;
  readonly pr: number;
  readonly sha: string;
}

export function parseArtifactName(name: string): ArtifactName | null {
  const match = ARTIFACT_NAME.exec(name);
  if (match === null) return null;
  const [, version, pr, sha] = match;
  if (version === undefined || pr === undefined || sha === undefined) return null;
  return { version, pr: Number(pr), sha };
}

/** One installable PR build, as the artifact listing describes it. */
export interface PrBuild {
  readonly pr: number;
  readonly version: string;
  readonly sha: string;
  readonly artifactId: number;
  readonly artifactName: string;
  readonly createdAt: string;
  readonly sizeBytes: number;
  readonly downloadUrl: string;
}

export type TokenSource = "env" | "gh";

export interface ResolvedToken {
  readonly token: string;
  readonly source: TokenSource;
  /** What to name in a message — the variable, or the CLI. */
  readonly detail: string;
}

/** Runs `gh auth token`; `null` when the CLI is absent or signed out. */
export type GhTokenReader = () => string | null;

/**
 * The shipped reader. Asking the GitHub CLI is the path most people already have
 * a working credential on, and it is asked **last** so an explicit variable
 * always wins over whatever `gh` happens to be signed in as.
 */
export const readGhToken: GhTokenReader = () => {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    // Not installed, not signed in, or too slow. All three mean the same thing
    // here — no token from this source — and none of them is an error worth
    // raising over a source that is one of three.
    return null;
  }
};

/**
 * `CORPUS_GITHUB_TOKEN`, then `GITHUB_TOKEN`, then the GitHub CLI.
 *
 * The dedicated variable comes first so a person can point this at a
 * `actions: read` token without disturbing whatever `GITHUB_TOKEN` is doing for
 * everything else on the machine.
 */
export function resolveGithubToken(
  env: Readonly<Record<string, string | undefined>>,
  readGhToken: GhTokenReader,
): ResolvedToken | null {
  for (const name of [CORPUS_TOKEN_ENV_VAR, GITHUB_TOKEN_ENV_VAR]) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") {
      return { token: value, source: "env", detail: name };
    }
  }
  const fromGh = readGhToken()?.trim();
  if (fromGh !== undefined && fromGh !== "") {
    return { token: fromGh, source: "gh", detail: "`gh auth token`" };
  }
  return null;
}

export function refuseWithoutToken(): RefusedError {
  return new RefusedError(
    "--unstable needs a GitHub token with `actions: read`, and none was found",
    {
      code: "upgrade_unstable_no_token",
      hint:
        "Workflow artifacts are not anonymously downloadable, even on a public repository. " +
        `Sign in with \`gh auth login\`, or set ${CORPUS_TOKEN_ENV_VAR} (or ${GITHUB_TOKEN_ENV_VAR}) ` +
        "to a token with `actions: read`. Nothing was downloaded or installed. " +
        "`corpus upgrade` without the flag installs the newest published release and needs no token.",
    },
  );
}

const ArtifactPayloadSchema = z.looseObject({
  artifacts: z
    .array(
      z.looseObject({
        id: z.number(),
        name: z.string(),
        size_in_bytes: z.number().optional(),
        archive_download_url: z.string().optional(),
        expired: z.boolean().optional(),
        created_at: z.string().optional(),
        workflow_run: z
          .looseObject({
            repository_id: z.number().optional(),
            head_repository_id: z.number().optional(),
            head_sha: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

/**
 * How many pages of the artifact listing to read before stopping.
 *
 * The listing is newest-first and mixes every workflow's artifacts — coverage
 * bundles outnumber PR builds several to one — so one page is not always
 * enough. Five pages of a hundred covers weeks of activity against a fourteen-day
 * retention window, which means the cap is reached only when there is nothing to
 * find. **When it is reached, the command says so**: a bounded search that
 * reported "no build" would be indistinguishable from an exhaustive one.
 */
export const MAX_ARTIFACT_PAGES = 5;
const PER_PAGE = 100;

export interface PrBuildLookupOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly api: string;
  readonly repo: string;
  /** This tool's version, for the User-Agent. */
  readonly version: string;
  readonly token: string;
  readonly timeoutMs: number;
  /** Restrict to one pull request; omitted, every PR is considered. */
  readonly pr?: number | undefined;
  /** Install a build produced from a fork's branch. Off, and deliberately so. */
  readonly allowFork?: boolean | undefined;
}

export type PrBuildLookup =
  | { readonly kind: "found"; readonly build: PrBuild; readonly truncated: boolean }
  /** Nothing installable — `detail` says why, in the terms the caller asked in. */
  | { readonly kind: "none"; readonly detail: string; readonly truncated: boolean }
  | { readonly kind: "unreachable"; readonly detail: string };

/**
 * The newest installable PR build, across every open pull request or for one.
 *
 * "Newest" is by the artifact's creation time and not by pull-request number: a
 * build is newer because it was built later, and the highest-numbered PR is
 * frequently not the most recently pushed. Bare `--unstable` therefore takes
 * whatever CI produced last, which is why the command **names the PR it chose
 * before installing** — the newest build is not always the caller's own.
 */
export async function lookupPrBuilds(options: PrBuildLookupOptions): Promise<PrBuildLookup> {
  const builds: PrBuild[] = [];
  let sawForeign = false;
  let sawExpired = false;
  let truncated = false;

  for (let page = 1; page <= MAX_ARTIFACT_PAGES; page += 1) {
    const url = `${options.api}/repos/${options.repo}/actions/artifacts?per_page=${String(PER_PAGE)}&page=${String(page)}`;
    let response: Response;
    try {
      response = await options.fetch(url, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${options.token}`,
          "user-agent": `corpus-cli/${options.version}`,
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (cause) {
      return { kind: "unreachable", detail: `${url} could not be reached (${reason(cause)})` };
    }

    // A `401` and a `403` are different problems with different fixes, and a
    // caller told "forbidden" for an expired token has been told nothing.
    if (response.status === 401) {
      return {
        kind: "unreachable",
        detail: "the GitHub token was rejected (401) — it is invalid, revoked or expired",
      };
    }
    if (response.status === 403) {
      return {
        kind: "unreachable",
        detail:
          "the GitHub token was refused (403) — it is valid but lacks `actions: read` on this " +
          "repository, or the API's rate limit is exhausted",
      };
    }
    if (response.status === 404) {
      return { kind: "unreachable", detail: `${options.repo} has no artifact list to read (404)` };
    }
    if (!response.ok) {
      return {
        kind: "unreachable",
        detail: `${url} answered ${String(response.status)} ${response.statusText}`.trimEnd(),
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      return { kind: "unreachable", detail: `${url} did not answer JSON (${reason(cause)})` };
    }
    const parsed = ArtifactPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        kind: "unreachable",
        detail: `${url} answered an artifact list this tool cannot read`,
      };
    }

    for (const artifact of parsed.data.artifacts) {
      const named = parseArtifactName(artifact.name);
      if (named === null) continue;
      if (options.pr !== undefined && named.pr !== options.pr) continue;
      if (artifact.expired === true) {
        sawExpired = true;
        continue;
      }
      /*
       * A fork's build is untrusted code. INFRA-026 records what the workflow
       * actually does: it runs on a fork's pull request and it does upload an
       * artifact — only the sticky comment fails, because a fork's token is
       * read-only. So the build is reachable, and refusing it by absence would
       * not work. The run's own `head_repository_id` is what says where the code
       * came from, and an artifact that cannot say is treated as one that came
       * from somewhere else.
       */
      const run = artifact.workflow_run;
      const sameRepo =
        run?.repository_id !== undefined &&
        run.head_repository_id !== undefined &&
        run.repository_id === run.head_repository_id;
      if (!sameRepo && options.allowFork !== true) {
        sawForeign = true;
        continue;
      }
      const downloadUrl =
        artifact.archive_download_url ??
        `${options.api}/repos/${options.repo}/actions/artifacts/${String(artifact.id)}/zip`;
      builds.push({
        pr: named.pr,
        version: named.version,
        sha: named.sha,
        artifactId: artifact.id,
        artifactName: artifact.name,
        createdAt: artifact.created_at ?? "",
        sizeBytes: artifact.size_in_bytes ?? 0,
        downloadUrl,
      });
    }

    if (parsed.data.artifacts.length < PER_PAGE) break;
    if (page === MAX_ARTIFACT_PAGES) truncated = true;
  }

  const newest = [...builds].sort((one, other) => other.createdAt.localeCompare(one.createdAt))[0];
  if (newest !== undefined) return { kind: "found", build: newest, truncated };

  const subject = options.pr === undefined ? "any open pull request" : `PR #${String(options.pr)}`;
  if (sawExpired) {
    return {
      kind: "none",
      truncated,
      detail:
        `the only builds found for ${subject} have expired — CI keeps them for ` +
        `${String(ARTIFACT_RETENTION_DAYS)} days, and these are older than that`,
    };
  }
  if (sawForeign) {
    return {
      kind: "none",
      truncated,
      detail:
        `every build found for ${subject} was produced from a fork, and a fork's build is ` +
        "untrusted code — pass --allow-fork to install one anyway",
    };
  }
  return { kind: "none", truncated, detail: `no packaged build was found for ${subject}` };
}

/** How old a build is, in the words a person would use. */
export function buildAge(createdAt: string, now: Date): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return "at an unknown time";
  const minutes = Math.max(0, Math.round((now.getTime() - at) / 60_000));
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} day${days === 1 ? "" : "s"} ago`;
}

/** One line naming what would be, or was, installed. Never silent about the PR. */
export function describeBuild(build: PrBuild, now: Date): string {
  return (
    `PR #${String(build.pr)} — corpus ${build.version}, commit ${build.sha}, ` +
    `built ${buildAge(build.createdAt, now)}`
  );
}

/**
 * The sentence every unstable install prints, because the rider requires it.
 *
 * It is not a warning that can be suppressed and it does not depend on a flag.
 * A path that quietly skipped a step §2.4 advertises is exactly what the rider
 * exists to prevent.
 */
export const UNVERIFIED_NOTICE =
  "This is a pre-release build from CI, not a published release. It carries no checksum, " +
  "so the verification `corpus upgrade` performs did not run. `corpus upgrade` reinstalls " +
  "the newest stable release.";

export interface DownloadPrBuildOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly build: PrBuild;
  readonly token: string;
  readonly version: string;
  readonly timeoutMs: number;
}

/**
 * Downloads the artifact zip and unwraps the one tarball inside it.
 *
 * The result has the same shape the release path produces, so the install half
 * takes it unchanged — with one field telling the truth: `sha256` is the digest
 * of what arrived, computed here, and **not** a digest anything published. It is
 * recorded so "which bytes am I running" stays answerable, never compared.
 */
export async function downloadPrBuild(options: DownloadPrBuildOptions): Promise<VerifiedTarball> {
  const url = options.build.downloadUrl;
  assertHttps(url);

  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "user-agent": `corpus-cli/${options.version}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    throw new RefusedError(`${options.build.artifactName} could not be downloaded`, {
      code: "upgrade_unstable_download_failed",
      details: { url, cause: reason(cause) },
    });
  }
  if (!response.ok) {
    throw new RefusedError(
      `${options.build.artifactName} could not be downloaded (${String(response.status)})`,
      {
        code: "upgrade_unstable_download_failed",
        hint:
          response.status === 403 || response.status === 401
            ? "The token was accepted for the listing but refused for the download; it needs `actions: read`."
            : "The artifact may have expired since it was listed.",
        details: { url, status: response.status },
      },
    );
  }

  const zip = Buffer.from(await response.arrayBuffer());
  const entry = unzipSingleTarball(zip, options.build.artifactName);
  const directory = mkdtempSync(join(tmpdir(), "corpus-unstable-"));
  const path = join(directory, entry.name);
  writeFileSync(path, entry.bytes);
  return { path, sha256: sha256Of(entry.bytes), bytes: entry.bytes.byteLength, directory };
}

function assertHttps(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RefusedError("the artifact's download URL is unusable", {
      code: "upgrade_unstable_url_invalid",
      details: { url },
    });
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) {
    throw new RefusedError(
      `the artifact would be downloaded over ${parsed.protocol.replace(":", "")}, not HTTPS`,
      {
        code: "upgrade_insecure_transport",
        hint: "SPEC.md §2.4 downloads installables over HTTPS; the unstable path bends none of that.",
        details: { url },
      },
    );
  }
}

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

/**
 * The one tarball inside a workflow artifact's zip.
 *
 * Hand-parsed rather than pulled in as a dependency, and the scope is what makes
 * that reasonable: this reads **one** archive, produced by one workflow, holding
 * one `npm pack` tarball. It walks the central directory — the authoritative
 * index, unlike the local headers, whose sizes may be deferred to a data
 * descriptor — and supports the two methods `upload-artifact` produces, stored
 * and deflate. Anything else is refused by name rather than mis-decoded.
 */
export function unzipSingleTarball(zip: Buffer, artifactName: string): ZipEntry {
  const eocd = findEndOfCentralDirectory(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  const found: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) break;
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (!name.endsWith(".tgz")) continue;
    found.push({ name, bytes: readLocalEntry(zip, localOffset, method, compressedSize, name) });
  }

  const only = found[0];
  if (only === undefined) {
    throw new RefusedError(`${artifactName} contains no .tgz tarball`, {
      code: "upgrade_unstable_artifact_shape",
      hint: "The Package workflow attaches exactly one tarball; this artifact is not one of its builds.",
    });
  }
  if (found.length > 1) {
    // Two tarballs is an ambiguity, not a choice to make — the same posture the
    // release path takes when a release publishes more than one.
    throw new RefusedError(
      `${artifactName} contains ${String(found.length)} tarballs and nothing says which is the tool`,
      { code: "upgrade_unstable_artifact_shape", details: { names: found.map((one) => one.name) } },
    );
  }
  return only;
}

function readLocalEntry(
  zip: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  name: string,
): Buffer {
  if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new RefusedError(`the artifact's entry for ${name} is not where its index says`, {
      code: "upgrade_unstable_artifact_shape",
    });
  }
  const nameLength = zip.readUInt16LE(localOffset + 26);
  const extraLength = zip.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const body = zip.subarray(start, start + compressedSize);
  if (method === 0) return Buffer.from(body);
  if (method === 8) return inflateRawSync(body);
  throw new RefusedError(
    `the artifact stores ${name} with compression method ${String(method)}, which corpus cannot read`,
    { code: "upgrade_unstable_artifact_shape" },
  );
}

const EOCD_SIGNATURE = 0x06054b50;

function findEndOfCentralDirectory(zip: Buffer): number {
  // The record is at the end, after a comment of up to 64 KiB. Scanning
  // backwards from the end is the only way to find it, and is what every zip
  // reader does.
  for (let at = zip.length - 22; at >= 0; at -= 1) {
    if (zip.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new RefusedError("the downloaded artifact is not a zip archive", {
    code: "upgrade_unstable_artifact_shape",
    hint: "The download may have been truncated; try again.",
  });
}

/** The digest of what actually arrived — recorded so the run is identifiable, never compared. */
function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function reason(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === "TimeoutError" ? "timed out" : cause.message;
  }
  return String(cause);
}
