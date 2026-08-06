import { execFile } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { PartialFailureError, RefusedError } from "../../errors.js";
import { sha256 } from "../../template/manifest.js";
import { cliPackageRoot, readPackageVersion } from "../../version.js";
import type { ReleaseAsset, ReleaseAssets } from "./release.js";

/**
 * The three acts SPEC.md §2.4 puts between "a newer release exists" and "the new
 * tool is installed": work out how this copy was installed, fetch the bytes and
 * prove they are the published ones, and hand them to the same npm that put the
 * current copy where it is.
 *
 * Every failure in this file **up to the moment npm is spawned** is a refusal,
 * and that is the design rather than an accident of error handling. §2.4: "if
 * the install method cannot be detected it refuses with instructions rather
 * than guessing". A tool that guesses how it was installed corrupts an
 * installation it does not understand; a tool that installs unverified bytes is
 * a supply-chain hole with a progress bar. So each refusal names what it could
 * not establish and gives the operator the command they would have run
 * themselves — which is strictly more useful than a wrong guess, and is the
 * only thing that keeps `sudo` out of this file.
 *
 * The exception is `npmInstall` itself, and it is the whole reason exit 8
 * exists (CLI-030). By the time npm has been spawned the caller has already
 * stopped the workspace's server and npm may have half-replaced the package, so
 * "refused — nothing was changed" would be a lie told to the one caller least
 * able to check: an agent. Its failure is a `PartialFailureError`.
 */

const execFileAsync = promisify(execFile);

export type InstallMethod =
  | {
      readonly kind: "npm-global";
      /** Directory of the installed package — `<prefix>/lib/node_modules/<name>`. */
      readonly packageRoot: string;
      /** The package name npm knows it by, scope included. */
      readonly packageName: string;
      /** What `npm install -g --prefix` is given, so the reinstall lands where this copy did. */
      readonly prefix: string;
      /** The `node_modules` npm would write into; its writability is the go/no-go. */
      readonly globalRoot: string;
    }
  | {
      readonly kind: "undetectable";
      readonly packageRoot: string;
      /** One clause completing "…, so the install method cannot be detected". */
      readonly reason: string;
    };

/**
 * How this copy of the tool was installed, decided from **its own location** and
 * nothing else.
 *
 * The location is the evidence §2.4 asks for — "the same npm-global path the
 * tool was installed with" — and it is evidence the process cannot be wrong
 * about, unlike `npm prefix -g` (which reports the npm on today's `PATH`, not
 * the one that did the install) or an environment variable (which reports what
 * the current shell believes). A global npm install is `<prefix>/lib/node_modules/<name>`
 * on every POSIX platform and `<prefix>/node_modules/<name>` on Windows; nothing
 * else is recognised, on purpose. Running from a monorepo checkout, from a
 * project-local `node_modules`, from an `npx` cache or from a bundler's output
 * all land in `undetectable` — each of which is a case where reinstalling
 * globally would install *a* Corpus, just not the one being run.
 */
export function detectInstallMethod(
  packageRoot: string = cliPackageRoot(),
  platform: NodeJS.Platform = process.platform,
): InstallMethod {
  const segments = packageRoot.split(sep);
  const marker = segments.lastIndexOf("node_modules");
  if (marker === -1) {
    return {
      kind: "undetectable",
      packageRoot,
      reason:
        "it is not installed under a node_modules directory (a source checkout, or an unpacked build)",
    };
  }

  const trailing = segments.slice(marker + 1);
  const packageName = packageNameOf(trailing);
  if (packageName === undefined) {
    return {
      kind: "undetectable",
      packageRoot,
      reason: `the path below node_modules (${trailing.join("/")}) is not a package directory npm would install into`,
    };
  }

  const container = segments.slice(0, marker);
  const isPosixGlobal = container[container.length - 1] === "lib";
  // Windows has no `lib` level: npm's global root there *is* `<prefix>/node_modules`,
  // which is the same shape as a project-local install and cannot be told apart
  // by path alone. Accepting it on win32 only keeps every POSIX install honest.
  const isWindowsGlobal = platform === "win32";
  if (!isPosixGlobal && !isWindowsGlobal) {
    return {
      kind: "undetectable",
      packageRoot,
      reason: `it sits in a project's node_modules (${container.join(sep) || sep}) rather than in an npm global root`,
    };
  }

  const prefix = (isPosixGlobal ? container.slice(0, -1) : container).join(sep) || sep;
  return {
    kind: "npm-global",
    packageRoot,
    packageName,
    prefix,
    globalRoot: segments.slice(0, marker + 1).join(sep),
  };
}

/** `["corpus"]` or `["@scope", "corpus"]`; anything deeper is somebody's dependency. */
function packageNameOf(trailing: readonly string[]): string | undefined {
  const [first, second] = trailing;
  if (first === undefined || first === "") return undefined;
  if (first.startsWith("@")) {
    return trailing.length === 2 && second !== undefined && second !== ""
      ? `${first}/${second}`
      : undefined;
  }
  return trailing.length === 1 ? first : undefined;
}

/**
 * The refusal for an install this tool does not recognise, carrying the exact
 * command the operator can run instead. Instructions rather than a guess is the
 * literal requirement (§2.4), and instructions that are not runnable are not
 * instructions.
 */
export function refuseUndetectable(
  method: InstallMethod & { kind: "undetectable" },
  tarballUrl: string,
): RefusedError {
  return new RefusedError(`this copy of corpus cannot upgrade itself: ${method.reason}`, {
    code: "upgrade_install_method_unknown",
    hint:
      `Install the release the way you installed this copy, e.g. \`npm install -g ${tarballUrl}\`. ` +
      "Corpus refuses to guess: reinstalling globally from here would install a second copy rather than replace this one.",
    details: { packageRoot: method.packageRoot },
  });
}

/**
 * The version actually sitting in the install directory now, or `undefined` if
 * it cannot be read.
 *
 * Asked *after* the install, because the release's tag and the tarball's own
 * manifest are two different claims and only the second one is what the operator
 * ends up running. They agree for every release the workflow cuts (the tag guard
 * in `release.yml` sees to that), and the point is precisely that the report
 * should not have to trust that: `corpus upgrade` says what is installed,
 * verified by reading it, not what the release list said would be.
 */
export function installedVersionAt(packageRoot: string): string | undefined {
  try {
    return readPackageVersion(packageRoot);
  } catch {
    return undefined;
  }
}

/** Whether npm could write into the global root without being elevated. */
export function isWritable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function refuseUnwritable(
  method: InstallMethod & { kind: "npm-global" },
  tarballUrl: string,
): RefusedError {
  return new RefusedError(
    `${method.globalRoot} is not writable by this user, so the install would fail halfway`,
    {
      code: "upgrade_prefix_unwritable",
      hint:
        `Take ownership of the npm prefix (\`sudo chown -R $(whoami) ${method.prefix}\`) and run \`corpus upgrade\` again, ` +
        `or install it yourself with \`sudo npm install -g ${tarballUrl}\`. Corpus never elevates itself.`,
      details: { prefix: method.prefix, globalRoot: method.globalRoot },
    },
  );
}

/**
 * The one line of a `shasum -a 256` file that attests to `expectedName`.
 *
 * INFRA-016 writes it from inside the staging directory precisely so the
 * recorded name is the bare filename a downloader has on disk, and this reads it
 * back the same way: two fields, hash then name, with `*` (shasum's binary-mode
 * marker) tolerated in front of the name. A file that attests to some *other*
 * name is not a mismatch to be forgiven — it is a checksum for a different
 * artifact, and using it would verify nothing.
 */
export function parseChecksumFile(text: string, expectedName: string): string {
  for (const line of text.split("\n")) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match === null) continue;
    const [, hash, name] = match;
    if (name === expectedName && hash !== undefined) return hash.toLowerCase();
  }
  throw new RefusedError(`the published checksum does not attest to ${expectedName}`, {
    code: "upgrade_checksum_unreadable",
    hint: "The release's .sha256 asset is malformed or belongs to another artifact; report it rather than installing around it.",
    details: { expectedName, checksumFile: text.slice(0, 400) },
  });
}

export interface DownloadOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly assets: ReleaseAssets;
  readonly version: string;
  readonly timeoutMs: number;
}

export interface VerifiedTarball {
  /** Absolute path of the downloaded file. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Temporary directory holding it; the caller removes it when done. */
  readonly directory: string;
}

/**
 * Downloads the checksum, then the tarball, and writes the tarball to disk
 * **only after** its digest matches.
 *
 * The order is deliberate. Verifying a file already on disk leaves a window in
 * which unverified bytes exist somewhere a later step could pick up; holding the
 * bytes in memory until they are proven means a mismatch leaves nothing behind
 * at all, which is the strongest form of §2.4's "nothing was installed". A
 * release tarball is tens of megabytes — small enough that this costs nothing
 * and large enough that the guarantee is worth stating.
 */
export async function downloadAndVerify(options: DownloadOptions): Promise<VerifiedTarball> {
  const { tarball, checksum } = options.assets;
  assertTransportIsSafe(tarball);
  assertTransportIsSafe(checksum);

  const expected = parseChecksumFile(await fetchText(options, checksum), tarball.name);

  const body = await fetchBytes(options, tarball);
  const actual = sha256(body);
  if (actual !== expected) {
    throw new RefusedError(
      `${tarball.name} does not match its published checksum — nothing was written`,
      {
        code: "upgrade_checksum_mismatch",
        hint:
          "Retry once in case the download was truncated; if it persists, the release asset and its checksum disagree and " +
          "corpus will not install it.",
        details: { asset: tarball.name, expected, actual, bytes: body.byteLength },
      },
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "corpus-upgrade-"));
  const path = join(directory, tarball.name);
  writeFileSync(path, body);
  return { path, sha256: actual, bytes: body.byteLength, directory };
}

export function discardDownload(download: VerifiedTarball): void {
  rmSync(download.directory, { recursive: true, force: true });
}

/**
 * §2.4 says "over HTTPS", and this is where that is true rather than assumed —
 * GitHub's own asset URLs are HTTPS, but they arrive from a response body and a
 * configurable API base, so they are input. Loopback is admitted so the fixture
 * server the tests and the E2E run drive is reachable; nothing else about the
 * rule bends.
 */
function assertTransportIsSafe(asset: ReleaseAsset): void {
  let url: URL;
  try {
    url = new URL(asset.url);
  } catch {
    throw new RefusedError(`release asset ${asset.name} has an unusable download URL`, {
      code: "upgrade_asset_url_invalid",
      details: { url: asset.url },
    });
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new RefusedError(
      `release asset ${asset.name} would be downloaded over ${url.protocol.replace(":", "")}, not HTTPS`,
      {
        code: "upgrade_insecure_transport",
        hint: "SPEC.md §2.4 downloads releases over HTTPS; corpus will not fetch an installable over a plaintext connection.",
        details: { url: asset.url },
      },
    );
  }
}

async function fetchAsset(options: DownloadOptions, asset: ReleaseAsset): Promise<Response> {
  let response: Response;
  try {
    response = await options.fetch(asset.url, {
      headers: {
        accept: "application/octet-stream",
        "user-agent": `corpus-cli/${options.version}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    throw new RefusedError(`${asset.name} could not be downloaded`, {
      code: "upgrade_download_failed",
      hint: "Nothing was installed. Check the network and run `corpus upgrade` again.",
      details: { url: asset.url, reason: cause instanceof Error ? cause.message : String(cause) },
      cause,
    });
  }
  if (!response.ok) {
    throw new RefusedError(
      `${asset.name} could not be downloaded (${String(response.status)} ${response.statusText})`.trimEnd(),
      {
        code: "upgrade_download_failed",
        hint: "Nothing was installed.",
        details: { url: asset.url, status: response.status },
      },
    );
  }
  return response;
}

async function fetchText(options: DownloadOptions, asset: ReleaseAsset): Promise<string> {
  return (await fetchAsset(options, asset)).text();
}

async function fetchBytes(options: DownloadOptions, asset: ReleaseAsset): Promise<Buffer> {
  return Buffer.from(await (await fetchAsset(options, asset)).arrayBuffer());
}

export interface NpmInstallOptions {
  readonly method: InstallMethod & { kind: "npm-global" };
  readonly tarballPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  /**
   * Aborting it kills the npm child. The caller arms this from its interrupt
   * handler, so a Ctrl-C during a fifteen-minute install ends the child rather
   * than orphaning it under a parent that is about to exit (CLI-030).
   */
  readonly signal?: AbortSignal;
}

export interface NpmInstallResult {
  readonly command: string;
  readonly output: string;
}

/** How npm is spawned; injected so tests never reinstall anything. */
export type NpmRunner = (options: NpmInstallOptions) => Promise<NpmInstallResult>;

/**
 * `npm install --global --prefix <prefix> <tarball>` — the same npm-global path
 * this copy was installed with, named explicitly rather than inherited.
 *
 * `--prefix` is what makes "the same path" true: npm's default global prefix is
 * whichever npm is first on today's `PATH`, and a laptop with nvm has several.
 * Passing the prefix derived from this process's own location means the
 * replacement lands on top of the copy that is running, not beside it.
 */
export const npmInstall: NpmRunner = async (options) => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["install", "--global", "--prefix", options.method.prefix, options.tarballPath];
  const command = `${npm} ${args.join(" ")}`;

  try {
    const { stdout, stderr } = await execFileAsync(npm, args, {
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { command, output: `${stdout}${stderr}`.trim() };
  } catch (cause) {
    // Not a refusal: npm was spawned against the real global prefix, so which
    // version is installed is now a question rather than a known fact — and the
    // caller stopped the server to get here. The hint says what to look at
    // instead of guessing on the operator's behalf (CLI-030).
    throw new PartialFailureError(`the install command failed: ${command}`, {
      code: "upgrade_install_failed",
      hint:
        "npm reported the failure below. Check `corpus --version` for the version that is actually installed — it may be " +
        "the old one, the new one, or a partly-replaced package — and run the command by hand to see the whole log.",
      details: { command, npm: npmFailureDetail(cause) },
      cause,
    });
  }
};

function npmFailureDetail(cause: unknown): string {
  if (typeof cause === "object" && cause !== null) {
    const record = cause as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const text = [record.stderr, record.stdout]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join("\n")
      .trim();
    if (text !== "") return tail(text, 2000);
    if (typeof record.message === "string") return record.message;
  }
  return String(cause);
}

function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`;
}
