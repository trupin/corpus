import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, isCliError } from "../../errors.js";
import { stubFetch } from "../../testing/fetch.js";
import {
  detectInstallMethod,
  discardDownload,
  downloadAndVerify,
  isWritable,
  npmInstall,
  parseChecksumFile,
  refuseUndetectable,
  refuseUnwritable,
  type InstallMethod,
} from "./install.js";

/**
 * The half of SPEC.md §2.4 that is allowed to touch the machine, tested without
 * touching it: nothing here installs anything, and the one test that writes
 * writes into a temporary directory it then removes.
 *
 * What is worth asserting is the refusals. Every one of them is a place the
 * spec says "refuse rather than guess", and a refusal that silently became a
 * guess would look exactly like success right up until it corrupted somebody's
 * installation.
 */

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `corpus-cli025-${label}-`));
  scratch.push(dir);
  return dir;
}

/** A platform-correct absolute path from POSIX-looking segments. */
function path(...segments: readonly string[]): string {
  return segments.join(sep);
}

const asset = (
  name: string,
  url = `https://example.test/${name}`,
): { name: string; url: string } => ({
  name,
  url,
});

describe("detectInstallMethod", () => {
  it("recognises a POSIX npm global install and derives the prefix from it", () => {
    const method = detectInstallMethod(
      path("", "usr", "local", "lib", "node_modules", "corpus"),
      "linux",
    );
    expect(method).toEqual({
      kind: "npm-global",
      packageRoot: path("", "usr", "local", "lib", "node_modules", "corpus"),
      packageName: "corpus",
      prefix: path("", "usr", "local"),
      globalRoot: path("", "usr", "local", "lib", "node_modules"),
    });
  });

  it("handles a homebrew prefix and a scoped package name", () => {
    const method = detectInstallMethod(
      path("", "opt", "homebrew", "lib", "node_modules", "@corpus", "cli"),
      "darwin",
    );
    expect(method).toMatchObject({
      kind: "npm-global",
      packageName: "@corpus/cli",
      prefix: path("", "opt", "homebrew"),
    });
  });

  it("refuses a project-local node_modules, which a global install would not replace", () => {
    const method = detectInstallMethod(
      path("", "home", "me", "app", "node_modules", "corpus"),
      "linux",
    );
    expect(method).toMatchObject({ kind: "undetectable" });
    expect(method.kind === "undetectable" && method.reason).toContain("project's node_modules");
  });

  it("refuses a source checkout", () => {
    const method = detectInstallMethod(
      path("", "home", "me", "code", "corpus", "apps", "cli"),
      "linux",
    );
    expect(method).toMatchObject({ kind: "undetectable" });
    expect(method.kind === "undetectable" && method.reason).toContain(
      "not installed under a node_modules",
    );
  });

  it("refuses a package nested inside another package's dependencies", () => {
    const method = detectInstallMethod(
      path("", "usr", "lib", "node_modules", "other", "vendor", "corpus"),
      "linux",
    );
    expect(method).toMatchObject({ kind: "undetectable" });
  });

  it("accepts Windows' prefix-level node_modules, which has no lib level", () => {
    const method = detectInstallMethod(
      ["C:", "Users", "me", "AppData", "npm", "node_modules", "corpus"].join(sep),
      "win32",
    );
    expect(method.kind).toBe("npm-global");
  });

  it("still refuses that same shape on POSIX, where it means a project", () => {
    const method = detectInstallMethod(path("", "srv", "app", "node_modules", "corpus"), "darwin");
    expect(method.kind).toBe("undetectable");
  });
});

describe("the refusals", () => {
  const undetectable: InstallMethod = {
    kind: "undetectable",
    packageRoot: "/home/me/code/corpus/apps/cli",
    reason: "it is not installed under a node_modules directory",
  };

  it("gives the operator a command to run instead of a guess", () => {
    const error = refuseUndetectable(undetectable, "https://example.test/corpus-0.4.0.tgz");
    expect(error.exitCode).toBe(ExitCode.refused);
    expect(error.code).toBe("upgrade_install_method_unknown");
    expect(error.hint).toContain("npm install -g https://example.test/corpus-0.4.0.tgz");
  });

  it("never elevates itself over an unwritable prefix", () => {
    const error = refuseUnwritable(
      {
        kind: "npm-global",
        packageRoot: "/usr/lib/node_modules/corpus",
        packageName: "corpus",
        prefix: "/usr",
        globalRoot: "/usr/lib/node_modules",
      },
      "https://example.test/corpus-0.4.0.tgz",
    );
    expect(error.code).toBe("upgrade_prefix_unwritable");
    expect(error.message).toContain("/usr/lib/node_modules is not writable");
    expect(error.hint).toContain("Corpus never elevates itself");
  });
});

describe("isWritable", () => {
  it("answers for a directory this user owns, and for one that does not exist", () => {
    expect(isWritable(tempDir("writable"))).toBe(true);
    expect(isWritable(join(tempDir("gone"), "missing"))).toBe(false);
  });
});

describe("parseChecksumFile", () => {
  const digest = "a".repeat(64);

  it("reads shasum's two-field format, which is what the release workflow writes", () => {
    expect(parseChecksumFile(`${digest}  corpus-0.4.0.tgz\n`, "corpus-0.4.0.tgz")).toBe(digest);
  });

  it("tolerates binary mode's asterisk and upper-case hex", () => {
    expect(parseChecksumFile(`${digest.toUpperCase()} *corpus-0.4.0.tgz`, "corpus-0.4.0.tgz")).toBe(
      digest,
    );
  });

  it("refuses a checksum that attests to a different artifact", () => {
    // Not a mismatch to forgive: verifying against somebody else's digest
    // verifies nothing at all.
    expect(() => parseChecksumFile(`${digest}  other.tgz\n`, "corpus-0.4.0.tgz")).toThrowError(
      /does not attest to corpus-0.4.0.tgz/,
    );
  });

  it("refuses a malformed file", () => {
    expect(() => parseChecksumFile("not a checksum", "corpus-0.4.0.tgz")).toThrowError();
  });
});

describe("downloadAndVerify", () => {
  const body = Buffer.from("pretend this is a tarball");
  const digest = createHash("sha256").update(body).digest("hex");

  function serve(checksumText: string, bytes = body): typeof globalThis.fetch {
    return stubFetch((url) =>
      url.endsWith(".sha256")
        ? new Response(checksumText)
        : new Response(new Uint8Array(bytes), { status: 200 }),
    );
  }

  const assets = {
    tarball: asset("corpus-0.4.0.tgz"),
    checksum: asset("corpus-0.4.0.tgz.sha256"),
  };

  it("writes the tarball only once its digest matches the published one", async () => {
    const download = await downloadAndVerify({
      fetch: serve(`${digest}  corpus-0.4.0.tgz\n`),
      assets,
      version: "0.3.0",
      timeoutMs: 1000,
    });
    scratch.push(download.directory);

    expect(download.sha256).toBe(digest);
    expect(download.bytes).toBe(body.byteLength);
    expect(readFileSync(download.path)).toEqual(body);

    discardDownload(download);
    expect(existsSync(download.directory)).toBe(false);
  });

  it("refuses a mismatch and leaves nothing behind", async () => {
    // The bytes never reach the disk, so "nothing was installed" is not a
    // promise to clean up — there is nothing to clean up. Asserted by listing
    // the temporary directory `downloadAndVerify` would have staged into.
    //
    // **That directory is a private one for the length of this test**, and it
    // has to be. `install.ts` stages with `mkdtemp(tmpdir(), "corpus-upgrade-")`,
    // and `index.test.ts` exercises the same function in another vitest worker
    // against the *same* OS temp directory — so listing the real one compared a
    // neighbour's in-flight staging directory against this call's, and the whole
    // suite went red on a test that passes alone. `os.tmpdir()` reads `TMPDIR`
    // on every call, so redirecting it is enough, and it makes the assertion
    // stronger rather than weaker: the expected listing is now *empty* rather
    // than "whatever happened to be there beforehand".
    //
    // **Restore by deletion when there was nothing to restore.** Assigning
    // `undefined` into `process.env` coerces it to the *string* `"undefined"`,
    // so `os.tmpdir()` then answers `"undefined"` and every later `mkdtemp`
    // fails with `ENOENT`. macOS always sets `TMPDIR`, so this is invisible
    // there and red on Linux CI — which is exactly what it did (PR #61).
    const staging = mkdtempSync(join(tmpdir(), "corpus-cli025-staging-"));
    scratch.push(staging);
    const outerTmp = process.env["TMPDIR"];
    process.env["TMPDIR"] = staging;

    try {
      expect(readdirSync(staging)).toEqual([]);
      await expect(
        downloadAndVerify({
          fetch: serve(`${"b".repeat(64)}  corpus-0.4.0.tgz\n`),
          assets,
          version: "0.3.0",
          timeoutMs: 1000,
        }),
      ).rejects.toMatchObject({ code: "upgrade_checksum_mismatch", exitCode: ExitCode.refused });
      expect(readdirSync(staging)).toEqual([]);
    } finally {
      if (outerTmp === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = outerTmp;
    }
  });

  it("refuses a download that is not HTTPS", async () => {
    await expect(
      downloadAndVerify({
        fetch: serve(`${digest}  corpus-0.4.0.tgz\n`),
        assets: {
          tarball: asset("corpus-0.4.0.tgz", "http://mirror.example.test/corpus-0.4.0.tgz"),
          checksum: assets.checksum,
        },
        version: "0.3.0",
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: "upgrade_insecure_transport" });
  });

  it("allows a loopback origin, so a fixture release can be driven end to end", async () => {
    const download = await downloadAndVerify({
      fetch: serve(`${digest}  corpus-0.4.0.tgz\n`),
      assets: {
        tarball: asset("corpus-0.4.0.tgz", "http://127.0.0.1:9/corpus-0.4.0.tgz"),
        checksum: asset("corpus-0.4.0.tgz.sha256", "http://127.0.0.1:9/corpus-0.4.0.tgz.sha256"),
      },
      version: "0.3.0",
      timeoutMs: 1000,
    });
    scratch.push(download.directory);
    expect(download.sha256).toBe(digest);
  });

  it("reports a failed download as a refusal, not a crash", async () => {
    const failing = stubFetch(() => new Response("", { status: 502 }));
    const error = await downloadAndVerify({
      fetch: failing,
      assets,
      version: "0.3.0",
      timeoutMs: 1000,
    }).catch((cause: unknown) => cause);
    expect(isCliError(error) && error.code).toBe("upgrade_download_failed");
  });
});

describe("npmInstall", () => {
  it("names the same npm-global path this copy was installed with, and reports a failure as a partial one", async () => {
    // A real `npm`, given a tarball that does not exist: it fails immediately,
    // touches no network, and installs nothing — which exercises the command
    // this verb builds and the refusal it turns a non-zero exit into.
    const prefix = tempDir("prefix");
    const error = await npmInstall({
      method: {
        kind: "npm-global",
        packageRoot: join(prefix, "lib", "node_modules", "corpus"),
        packageName: "corpus",
        prefix,
        globalRoot: join(prefix, "lib", "node_modules"),
      },
      tarballPath: join(prefix, "corpus-0.4.0.tgz"),
      env: process.env,
      timeoutMs: 120_000,
    }).catch((cause: unknown) => cause);

    if (!isCliError(error)) throw new Error(`expected a CliError, got ${String(error)}`);
    expect(error.code).toBe("upgrade_install_failed");
    // Not a refusal: npm was spawned against the real prefix, so "nothing was
    // changed" is no longer something this can promise (CLI-030).
    expect(error.exitCode).toBe(ExitCode.partialFailure);
    expect(error.changed).toBe(true);
    expect(error.hint).toContain("corpus --version");
    expect(error.message).toContain(`--prefix ${prefix}`);
    expect(existsSync(join(prefix, "lib", "node_modules", "corpus"))).toBe(false);
  }, 130_000);

  it("hands its abort signal to the child, so an interrupt ends npm too", async () => {
    // The wiring, asserted offline and deterministically: a signal that is
    // already aborted must end the run rather than be ignored. What Node does
    // with it after that — killing the child — is Node's guarantee, and the real
    // kill is what CLI-030's E2E watched with `pgrep`.
    const prefix = tempDir("aborted-prefix");
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();

    const error = await npmInstall({
      method: {
        kind: "npm-global",
        packageRoot: join(prefix, "lib", "node_modules", "corpus"),
        packageName: "corpus",
        prefix,
        globalRoot: join(prefix, "lib", "node_modules"),
      },
      tarballPath: join(prefix, "corpus-0.4.0.tgz"),
      env: process.env,
      timeoutMs: 120_000,
      signal: controller.signal,
    }).catch((cause: unknown) => cause);

    if (!isCliError(error)) throw new Error(`expected a CliError, got ${String(error)}`);
    expect(error.code).toBe("upgrade_install_failed");
    expect(error.exitCode).toBe(ExitCode.partialFailure);
    // The abort ended it, not the 120-second timeout.
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(existsSync(join(prefix, "lib", "node_modules", "corpus"))).toBe(false);
  }, 40_000);
});
