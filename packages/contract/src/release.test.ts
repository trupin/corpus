import { describe, expect, it } from "vitest";
import {
  compareVersions,
  DEFAULT_RELEASES_API,
  DEFAULT_RELEASES_REPO,
  evaluateRelease,
  lookupLatestRelease,
  releaseSource,
  selectAssets,
  userAgent,
  type Release,
  type ReleaseLookup,
} from "./release.js";

/**
 * The release check, exercised against a scripted `fetch` rather than GitHub.
 *
 * SPEC.md §2.4's whole posture is "on demand, never in the background", and a
 * unit suite that reached the real Releases API would be a background check
 * running on every `npm test` — the exact thing the spec forbids, with a rate
 * limit attached. So every response below is written out here.
 *
 * **Why this file exists beside `apps/cli/src/commands/upgrade/release.test.ts`
 * (INFRA-044).** The lookup moved here in CONTRACT-090 and the CLI kept a
 * re-export, deliberately, so the test that proved the move changed no
 * behaviour never had to be edited. That test still runs, and still proves the
 * re-export's names resolve — but it runs against `packages/contract/dist`,
 * which no instrument attributes back to this source. Under Vitest 4's
 * AST-aware remapping the file therefore reads 0 of 66 branches (INFRA-043),
 * and 66 uncovered branches in the module that decides whether an upgrade is
 * installable is not a measurement artefact worth keeping.
 *
 * What is pinned here is the pair of judgments §2.4 rests on, from the source
 * side: **what the check refuses** (an unorderable version, a tarball with no
 * checksum, two tarballs, an unreadable payload, an unreachable API — each a
 * described answer rather than a throw or a guess) and **what it accepts** (one
 * tarball with the `.sha256` published beside it, a strictly newer version).
 */

/** A scripted `fetch`: what was asked for, and what comes back. */
function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
): typeof globalThis.fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init));
  };
}

/**
 * A `fetch` that rejects, the way an offline machine's does. Written as a
 * rejecting promise rather than a `throw` so the cause can be any value —
 * including one that is not an `Error`, which is a real shape a host's fetch
 * can reject with and a branch `reason` has to answer for.
 */
function failingFetch(cause: unknown): typeof globalThis.fetch {
  return () =>
    Promise.resolve().then<Response>(() => {
      throw cause;
    });
}

const options = {
  api: "https://api.example.test",
  repo: "trupin/corpus",
  version: "0.3.0",
  timeoutMs: 1000,
};

const LATEST_URL = "https://api.example.test/repos/trupin/corpus/releases/latest";

const asset = (name: string): { name: string; browser_download_url: string } => ({
  name,
  browser_download_url: `https://example.test/${name}`,
});

const release = (version: string, names: readonly string[]): Release => ({
  tag: `v${version}`,
  version,
  notesUrl: "https://github.test/notes",
  assets: names.map((name) => ({ name, url: `https://example.test/${name}` })),
});

const found = (version: string, names: readonly string[]): ReleaseLookup => ({
  kind: "found",
  release: release(version, names),
});

/** The detail of an answer that has one, without a cast at every call site. */
function detailOf(lookup: ReleaseLookup): string {
  return lookup.kind === "unreachable" ? lookup.detail : `no detail: ${lookup.kind}`;
}

describe("userAgent", () => {
  it("identifies the tool and its version, which GitHub requires", () => {
    expect(userAgent("0.36.0")).toBe("corpus-cli/0.36.0");
  });
});

describe("releaseSource", () => {
  it("defaults to the published distribution when the environment says nothing", () => {
    expect(releaseSource({})).toEqual({ api: DEFAULT_RELEASES_API, repo: DEFAULT_RELEASES_REPO });
    expect(DEFAULT_RELEASES_API).toBe("https://api.github.com");
    expect(DEFAULT_RELEASES_REPO).toBe("trupin/corpus");
  });

  it("takes a fork or a mirror from the environment, without a trailing slash", () => {
    // The URL is built by concatenation, so a trailing slash would produce
    // `…//repos/…`. Every trailing slash goes, not just the last.
    expect(
      releaseSource({
        CORPUS_RELEASES_API: "http://127.0.0.1:9999///",
        CORPUS_RELEASES_REPO: "me/fork",
      }),
    ).toEqual({ api: "http://127.0.0.1:9999", repo: "me/fork" });
  });

  it("reads an override that is only whitespace as no override at all", () => {
    expect(releaseSource({ CORPUS_RELEASES_API: "  ", CORPUS_RELEASES_REPO: "\t" })).toEqual({
      api: DEFAULT_RELEASES_API,
      repo: DEFAULT_RELEASES_REPO,
    });
  });

  it("reads an empty override as no override at all", () => {
    expect(releaseSource({ CORPUS_RELEASES_API: "", CORPUS_RELEASES_REPO: "" })).toEqual({
      api: DEFAULT_RELEASES_API,
      repo: DEFAULT_RELEASES_REPO,
    });
  });

  it("overrides each half independently", () => {
    expect(releaseSource({ CORPUS_RELEASES_REPO: "me/fork" })).toEqual({
      api: DEFAULT_RELEASES_API,
      repo: "me/fork",
    });
    expect(releaseSource({ CORPUS_RELEASES_API: "http://mirror.test" })).toEqual({
      api: "http://mirror.test",
      repo: DEFAULT_RELEASES_REPO,
    });
  });
});

describe("lookupLatestRelease", () => {
  it("asks for the latest release, identifying itself as GitHub requires", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch((url, init) => {
        seen = { url, init };
        return Response.json({
          tag_name: "v0.4.0",
          html_url: "https://github.test/releases/v0.4.0",
          assets: [asset("corpus-0.4.0.tgz"), asset("corpus-0.4.0.tgz.sha256")],
        });
      }),
    });

    // `/releases/latest`, not `/releases`: GitHub excludes drafts and
    // pre-releases from it, and a pre-release is not what "upgrade me" means.
    expect(seen?.url).toBe(LATEST_URL);
    const headers = (seen?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["user-agent"]).toBe("corpus-cli/0.3.0");
    expect(headers.accept).toBe("application/vnd.github+json");
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
    // On demand means bounded: the request carries the caller's timeout.
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);

    expect(lookup).toEqual({
      kind: "found",
      release: {
        tag: "v0.4.0",
        version: "0.4.0",
        notesUrl: "https://github.test/releases/v0.4.0",
        assets: [
          { name: "corpus-0.4.0.tgz", url: "https://example.test/corpus-0.4.0.tgz" },
          { name: "corpus-0.4.0.tgz.sha256", url: "https://example.test/corpus-0.4.0.tgz.sha256" },
        ],
      },
    });
  });

  it("reads a tag with no leading v, and a release with neither notes nor assets", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => Response.json({ tag_name: "0.4.0" })),
    });

    expect(lookup).toEqual({
      kind: "found",
      // No `html_url` is not an unreadable payload: notes are a convenience for
      // a human, and their absence must not cost the version comparison.
      release: { tag: "0.4.0", version: "0.4.0", notesUrl: null, assets: [] },
    });
  });

  it("reads a 404 as 'no releases yet', not as a failure to look", async () => {
    // A distribution that has published nothing is a fact about the
    // distribution. `evaluateRelease` reports it as reachable.
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => new Response("", { status: 404 })),
    });
    expect(lookup).toEqual({ kind: "none" });
  });

  it("names the rate limit when GitHub says the budget is spent", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(
        () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      ),
    });

    expect(lookup.kind).toBe("unreachable");
    expect(detailOf(lookup)).toContain("exhausted GitHub's unauthenticated rate limit");
    expect(detailOf(lookup)).toContain(LATEST_URL);
  });

  it("does not blame the rate limit for a 403 that still has budget", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(
        () =>
          new Response("", {
            status: 403,
            statusText: "Forbidden",
            headers: { "x-ratelimit-remaining": "57" },
          }),
      ),
    });

    expect(detailOf(lookup)).toBe(`${LATEST_URL} answered 403 Forbidden`);
  });

  it("reports any other refusal with the status it was given", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(
        () => new Response("", { status: 500, statusText: "Internal Server Error" }),
      ),
    });

    expect(detailOf(lookup)).toBe(`${LATEST_URL} answered 500 Internal Server Error`);
  });

  it("leaves no trailing space when the status has no text", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => new Response("", { status: 502, statusText: "" })),
    });

    expect(detailOf(lookup)).toBe(`${LATEST_URL} answered 502`);
  });

  it("reports an offline machine as unreachable rather than throwing", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: failingFetch(new TypeError("fetch failed")),
    });

    expect(lookup).toEqual({
      kind: "unreachable",
      detail: `${LATEST_URL} could not be reached (fetch failed)`,
    });
  });

  it("says 'timed out' rather than repeating the abort's wording", async () => {
    // `AbortSignal.timeout` rejects with "The operation was aborted due to
    // timeout" — accurate, and not obviously about the network.
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";

    const lookup = await lookupLatestRelease({ ...options, fetch: failingFetch(timeout) });

    expect(detailOf(lookup)).toBe(`${LATEST_URL} could not be reached (timed out)`);
  });

  it("describes a rejection that is not an Error at all", async () => {
    const lookup = await lookupLatestRelease({ ...options, fetch: failingFetch("captive portal") });

    expect(detailOf(lookup)).toBe(`${LATEST_URL} could not be reached (captive portal)`);
  });

  it("reports a body that is not JSON as unreachable, naming the URL", async () => {
    // A captive portal answering 200 with an HTML login page is the case.
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(
        () => new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } }),
      ),
    });

    expect(lookup.kind).toBe("unreachable");
    expect(detailOf(lookup)).toContain("did not answer JSON");
  });

  it("refuses a payload that is not a release rather than inventing a version", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => Response.json({ message: "Not Found" })),
    });

    expect(lookup).toEqual({
      kind: "unreachable",
      detail: `${LATEST_URL} answered a release this tool cannot read`,
    });
  });

  it("refuses a release whose tag is empty", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => Response.json({ tag_name: "" })),
    });

    expect(lookup.kind).toBe("unreachable");
  });
});

describe("selectAssets", () => {
  it("pairs the tarball with the checksum published beside it", () => {
    const selection = selectAssets(
      release("0.4.0", ["notes.md", "corpus-0.4.0.tgz", "corpus-0.4.0.tgz.sha256"]),
    );

    expect(selection).toEqual({
      kind: "ok",
      assets: {
        tarball: { name: "corpus-0.4.0.tgz", url: "https://example.test/corpus-0.4.0.tgz" },
        checksum: {
          name: "corpus-0.4.0.tgz.sha256",
          url: "https://example.test/corpus-0.4.0.tgz.sha256",
        },
      },
    });
  });

  it("finds the pair by shape, since the published name is still provisional", () => {
    // Matching `corpus-<version>.tgz` would hard-code a decision nobody has
    // made. One `.tgz` plus its `.sha256` is the release workflow's structure.
    const selection = selectAssets(
      release("9.9.9", ["corpuz-9.9.9.tgz", "corpuz-9.9.9.tgz.sha256"]),
    );

    expect(selection.kind).toBe("ok");
  });

  it("refuses a release with no tarball at all, naming the tag", () => {
    const selection = selectAssets(release("0.4.0", ["notes.md"]));

    expect(selection).toEqual({
      kind: "missing",
      detail: "release v0.4.0 publishes no .tgz tarball",
    });
  });

  it("refuses a tarball with no checksum beside it", () => {
    // A release cut before INFRA-016 published checksums is a real release
    // §2.4 will still not install.
    const selection = selectAssets(release("0.4.0", ["corpus-0.4.0.tgz"]));

    expect(selection.kind).toBe("missing");
    expect(selection.kind === "missing" && selection.detail).toContain(
      "publishes corpus-0.4.0.tgz but no corpus-0.4.0.tgz.sha256",
    );
    expect(selection.kind === "missing" && selection.detail).toContain("cannot be verified");
  });

  it("refuses a checksum that belongs to some other tarball", () => {
    const selection = selectAssets(
      release("0.4.0", ["corpus-0.4.0.tgz", "other-0.1.0.tgz.sha256"]),
    );

    expect(selection.kind).toBe("missing");
  });

  it("refuses two tarballs rather than picking one", () => {
    const selection = selectAssets(release("0.4.0", ["a-1.tgz", "a-1.tgz.sha256", "b-1.tgz"]));

    expect(selection.kind).toBe("missing");
    expect(selection.kind === "missing" && selection.detail).toContain(
      "publishes 2 tarballs (a-1.tgz, b-1.tgz)",
    );
    expect(selection.kind === "missing" && selection.detail).toContain("nothing says which");
  });
});

describe("compareVersions", () => {
  it.each([
    ["0.4.0", "0.3.0", 1],
    ["0.3.0", "0.4.0", -1],
    ["1.0.0", "0.99.99", 1],
    ["0.99.99", "1.0.0", -1],
    ["0.10.0", "0.9.0", 1],
    ["0.9.0", "0.10.0", -1],
    ["0.3.1", "0.3.0", 1],
    ["0.3.0", "0.3.1", -1],
    ["0.3.0", "0.3.0", 0],
  ])("orders %s against %s", (one, other, expected) => {
    expect(compareVersions(one, other)).toBe(expected);
  });

  it("ignores a leading v on either side", () => {
    expect(compareVersions("v0.3.1", "0.3.0")).toBe(1);
    expect(compareVersions("0.3.0", "v0.3.1")).toBe(-1);
    expect(compareVersions("v0.3.0", "v0.3.0")).toBe(0);
  });

  it("puts a pre-release before the release it leads to", () => {
    // semver §10. `0.4.0-rc.1` is older than `0.4.0`, so a workspace on
    // `0.4.0` is never offered `0.4.0-rc.1` as an upgrade.
    expect(compareVersions("0.4.0-rc.1", "0.4.0")).toBe(-1);
    expect(compareVersions("0.4.0", "0.4.0-rc.1")).toBe(1);
  });

  it("orders two pre-releases of the same version against each other", () => {
    expect(compareVersions("0.4.0-rc.2", "0.4.0-rc.1")).toBe(1);
    expect(compareVersions("0.4.0-rc.1", "0.4.0-rc.2")).toBe(-1);
    expect(compareVersions("0.4.0-rc.1", "0.4.0-rc.1")).toBe(0);
  });

  it("reads trailing build metadata as part of neither comparison", () => {
    expect(compareVersions("0.4.0+build.9", "0.4.0")).toBe(0);
  });

  it("answers undefined rather than guessing at a version it cannot parse", () => {
    // "I cannot tell" is a third answer, never a zero: a caller must then
    // neither offer an upgrade nor claim the workspace is current.
    expect(compareVersions("nightly", "0.3.0")).toBeUndefined();
    expect(compareVersions("0.3.0", "latest")).toBeUndefined();
    expect(compareVersions("0.3", "0.3.0")).toBeUndefined();
    expect(compareVersions("", "")).toBeUndefined();
  });
});

describe("evaluateRelease", () => {
  it("reports an installable upgrade, and names the pair to install", () => {
    const verdict = evaluateRelease(
      "0.3.0",
      found("0.4.0", ["corpus-0.4.0.tgz", "corpus-0.4.0.tgz.sha256"]),
    );

    expect(verdict.check).toEqual({
      installed: "0.3.0",
      latest: "0.4.0",
      upgradeAvailable: true,
      verifiable: true,
      notesUrl: "https://github.test/notes",
      reachable: true,
      detail: null,
    });
    expect(verdict.release?.tag).toBe("v0.4.0");
    expect(verdict.assets?.tarball.name).toBe("corpus-0.4.0.tgz");
    expect(verdict.assets?.checksum.name).toBe("corpus-0.4.0.tgz.sha256");
  });

  it("separates 'newer exists' from 'newer can be installed'", () => {
    const verdict = evaluateRelease("0.3.0", found("0.4.0", ["corpus-0.4.0.tgz"]));

    expect(verdict.check.upgradeAvailable).toBe(true);
    expect(verdict.check.verifiable).toBe(false);
    // The detail carries the selection's own refusal *and* why it matters, so
    // a person reading the board is not left to guess at "not verifiable".
    expect(verdict.check.detail).toContain("no corpus-0.4.0.tgz.sha256");
    expect(verdict.check.detail).toContain("verify a published checksum");
    // No assets: nothing here is offered as an installation target.
    expect(verdict.assets).toBeNull();
    expect(verdict.release?.version).toBe("0.4.0");
  });

  it("says nothing is available when the installed version is the newest", () => {
    const verdict = evaluateRelease(
      "0.4.0",
      found("0.4.0", ["corpus-0.4.0.tgz", "corpus-0.4.0.tgz.sha256"]),
    );

    expect(verdict.check.upgradeAvailable).toBe(false);
    expect(verdict.check.verifiable).toBe(true);
    // Being current is not a problem to explain.
    expect(verdict.check.detail).toBeNull();
    expect(verdict.assets?.tarball.name).toBe("corpus-0.4.0.tgz");
  });

  it("offers no upgrade when the published release is older than the installed one", () => {
    const verdict = evaluateRelease("0.5.0", found("0.4.0", ["corpus-0.4.0.tgz"]));

    expect(verdict.check.upgradeAvailable).toBe(false);
    expect(verdict.check.verifiable).toBe(false);
    // An older release being unverifiable is not worth a warning: it was never
    // going to be installed.
    expect(verdict.check.detail).toBeNull();
  });

  it("offers no upgrade between versions it cannot order, and says so", () => {
    const verdict = evaluateRelease("0.3.0", found("nightly", ["corpus.tgz", "corpus.tgz.sha256"]));

    expect(verdict.check.upgradeAvailable).toBe(false);
    expect(verdict.check.verifiable).toBe(true);
    expect(verdict.check.latest).toBe("nightly");
    expect(verdict.check.detail).toContain("cannot be ordered");
    expect(verdict.check.detail).toContain("install it by hand");
    // Unorderable but verifiable: the pair is still named, because a person
    // who decides by hand is entitled to the bytes and their checksum.
    expect(verdict.assets?.tarball.name).toBe("corpus.tgz");
  });

  it("names no assets for a release it can neither order nor verify", () => {
    const verdict = evaluateRelease("0.3.0", found("nightly", ["corpus.tgz"]));

    expect(verdict.check.upgradeAvailable).toBe(false);
    expect(verdict.check.verifiable).toBe(false);
    expect(verdict.check.detail).toContain("cannot be ordered");
    expect(verdict.assets).toBeNull();
  });

  it("carries an unreachable lookup through as a described answer", () => {
    // Offline, captive portal, rate limit: ordinary conditions for a
    // local-first tool, and the check succeeded at reporting them.
    const verdict = evaluateRelease("0.3.0", { kind: "unreachable", detail: "offline" });

    expect(verdict.check).toEqual({
      installed: "0.3.0",
      latest: null,
      upgradeAvailable: false,
      verifiable: false,
      notesUrl: null,
      reachable: false,
      detail: "offline",
    });
    expect(verdict.release).toBeNull();
    expect(verdict.assets).toBeNull();
  });

  it("distinguishes 'nothing published yet' from 'could not look'", () => {
    const verdict = evaluateRelease("0.3.0", { kind: "none" });

    expect(verdict.check).toEqual({
      installed: "0.3.0",
      latest: null,
      upgradeAvailable: false,
      verifiable: false,
      notesUrl: null,
      reachable: true,
      detail: "this distribution has published no releases yet",
    });
    expect(verdict.release).toBeNull();
    expect(verdict.assets).toBeNull();
  });
});

describe("the lookup and the verdict, end to end", () => {
  it("turns one HTTP answer into an installable upgrade", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() =>
        Response.json({
          tag_name: "v0.36.0",
          html_url: "https://github.test/releases/v0.36.0",
          assets: [asset("corpus-0.36.0.tgz"), asset("corpus-0.36.0.tgz.sha256")],
        }),
      ),
    });
    const verdict = evaluateRelease("0.35.0", lookup);

    expect(verdict.check.upgradeAvailable).toBe(true);
    expect(verdict.check.verifiable).toBe(true);
    expect(verdict.assets?.checksum.url).toBe("https://example.test/corpus-0.36.0.tgz.sha256");
  });

  it("turns a refused lookup into a refusal a person can act on", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: failingFetch(new TypeError("fetch failed")),
    });
    const verdict = evaluateRelease("0.35.0", lookup);

    expect(verdict.check.reachable).toBe(false);
    expect(verdict.check.detail).toContain("could not be reached");
    expect(verdict.assets).toBeNull();
  });
});
