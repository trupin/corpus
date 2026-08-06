import { describe, expect, it } from "vitest";
import { stubFetch } from "../../testing/fetch.js";
import {
  compareVersions,
  evaluateRelease,
  lookupLatestRelease,
  releaseSource,
  selectAssets,
  userAgent,
  type Release,
} from "./release.js";

/**
 * The release check, exercised against a scripted `fetch` rather than GitHub.
 * SPEC.md §2.4's whole posture is "on demand, never in the background", and a
 * unit suite that reached the real Releases API would be a background check that
 * runs on every `npm test` — the exact thing the spec forbids, with a rate limit
 * attached.
 */

const ASSET = (name: string): { name: string; browser_download_url: string } => ({
  name,
  browser_download_url: `https://example.test/${name}`,
});

const options = {
  api: "https://api.example.test",
  repo: "trupin/corpus",
  version: "0.3.0",
  timeoutMs: 1000,
};

describe("compareVersions", () => {
  it.each([
    ["0.4.0", "0.3.0", 1],
    ["0.3.0", "0.4.0", -1],
    ["0.3.0", "0.3.0", 0],
    ["v0.3.1", "0.3.0", 1],
    ["1.0.0", "0.99.99", 1],
    ["0.10.0", "0.9.0", 1],
  ])("orders %s against %s", (one, other, expected) => {
    expect(compareVersions(one, other)).toBe(expected);
  });

  it("puts a pre-release before the release it leads to", () => {
    expect(compareVersions("0.4.0-rc.1", "0.4.0")).toBe(-1);
    expect(compareVersions("0.4.0", "0.4.0-rc.1")).toBe(1);
    expect(compareVersions("0.4.0-rc.2", "0.4.0-rc.1")).toBe(1);
  });

  it("answers undefined rather than guessing at an unparseable version", () => {
    // The caller must then neither offer an upgrade nor claim the tool is
    // current: "I cannot tell" is a third answer, not a zero.
    expect(compareVersions("nightly", "0.3.0")).toBeUndefined();
    expect(compareVersions("0.3.0", "latest")).toBeUndefined();
  });
});

describe("releaseSource", () => {
  it("defaults to the published distribution", () => {
    expect(releaseSource({})).toEqual({ api: "https://api.github.com", repo: "trupin/corpus" });
  });

  it("takes a fork or a mirror from the environment, without a trailing slash", () => {
    expect(
      releaseSource({
        CORPUS_RELEASES_API: "http://127.0.0.1:9999/",
        CORPUS_RELEASES_REPO: "me/fork",
      }),
    ).toEqual({ api: "http://127.0.0.1:9999", repo: "me/fork" });
  });

  it("ignores empty overrides", () => {
    expect(releaseSource({ CORPUS_RELEASES_API: "  " }).api).toBe("https://api.github.com");
  });
});

describe("lookupLatestRelease", () => {
  it("identifies itself, as GitHub requires, and reads the release", async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch((url, init) => {
        seen = { url, headers: (init?.headers ?? {}) as Record<string, string> };
        return Response.json({
          tag_name: "v0.4.0",
          html_url: "https://github.test/releases/v0.4.0",
          assets: [ASSET("corpus-0.4.0.tgz"), ASSET("corpus-0.4.0.tgz.sha256")],
        });
      }),
    });

    expect(seen?.url).toBe("https://api.example.test/repos/trupin/corpus/releases/latest");
    expect(seen?.headers["user-agent"]).toBe(userAgent("0.3.0"));
    expect(lookup).toMatchObject({
      kind: "found",
      release: { tag: "v0.4.0", version: "0.4.0", notesUrl: "https://github.test/releases/v0.4.0" },
    });
  });

  it("reads a 404 as 'no releases yet', not as a failure to look", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => new Response("", { status: 404 })),
    });
    expect(lookup.kind).toBe("none");
  });

  it("names the rate limit when GitHub says the budget is spent", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(
        () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      ),
    });
    expect(lookup).toMatchObject({ kind: "unreachable" });
    expect(lookup.kind === "unreachable" && lookup.detail).toContain("rate limit");
  });

  it("reports an offline machine as unreachable rather than throwing", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(lookup).toEqual({
      kind: "unreachable",
      detail:
        "https://api.example.test/repos/trupin/corpus/releases/latest could not be reached (fetch failed)",
    });
  });

  it("refuses to read a payload that is not a release", async () => {
    const lookup = await lookupLatestRelease({
      ...options,
      fetch: stubFetch(() => Response.json({ message: "Not Found" })),
    });
    expect(lookup.kind).toBe("unreachable");
  });
});

describe("selectAssets", () => {
  const release = (names: readonly string[]): Release => ({
    tag: "v0.4.0",
    version: "0.4.0",
    notesUrl: null,
    assets: names.map((name) => ({ name, url: `https://example.test/${name}` })),
  });

  it("pairs the tarball with the checksum published beside it", () => {
    const selection = selectAssets(release(["corpus-0.4.0.tgz", "corpus-0.4.0.tgz.sha256"]));
    expect(selection).toMatchObject({
      kind: "ok",
      assets: {
        tarball: { name: "corpus-0.4.0.tgz" },
        checksum: { name: "corpus-0.4.0.tgz.sha256" },
      },
    });
  });

  it("finds the pair whatever the package is called, since the name is still provisional", () => {
    const selection = selectAssets(
      release(["notes.md", "corpuz-9.9.9.tgz", "corpuz-9.9.9.tgz.sha256"]),
    );
    expect(selection.kind).toBe("ok");
  });

  it("refuses a release whose tarball has no checksum", () => {
    const selection = selectAssets(release(["corpus-0.4.0.tgz"]));
    expect(selection).toMatchObject({ kind: "missing" });
    expect(selection.kind === "missing" && selection.detail).toContain("corpus-0.4.0.tgz.sha256");
  });

  it("refuses a release with no tarball at all", () => {
    expect(selectAssets(release(["notes.md"]))).toMatchObject({ kind: "missing" });
  });

  it("refuses two tarballs rather than picking one", () => {
    const selection = selectAssets(release(["a-1.tgz", "a-1.tgz.sha256", "b-1.tgz"]));
    expect(selection).toMatchObject({ kind: "missing" });
    expect(selection.kind === "missing" && selection.detail).toContain("nothing says which");
  });
});

describe("evaluateRelease", () => {
  const found = (version: string, names: readonly string[]) =>
    ({
      kind: "found",
      release: {
        tag: `v${version}`,
        version,
        notesUrl: "https://github.test/notes",
        assets: names.map((name) => ({ name, url: `https://example.test/${name}` })),
      },
    }) as const;

  it("reports an installable upgrade", () => {
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
    expect(verdict.assets?.tarball.name).toBe("corpus-0.4.0.tgz");
  });

  it("separates 'newer exists' from 'newer can be installed'", () => {
    // The pair §2.4 depends on: a release cut before INFRA-016 published
    // checksums is a real release the upgrade will still refuse.
    const verdict = evaluateRelease("0.3.0", found("0.4.0", ["corpus-0.4.0.tgz"]));
    expect(verdict.check.upgradeAvailable).toBe(true);
    expect(verdict.check.verifiable).toBe(false);
    expect(verdict.check.detail).toContain("verify a published checksum");
    expect(verdict.assets).toBeNull();
  });

  it("says nothing is available when the installed version is the newest", () => {
    const verdict = evaluateRelease(
      "0.4.0",
      found("0.4.0", ["corpus-0.4.0.tgz", "corpus-0.4.0.tgz.sha256"]),
    );
    expect(verdict.check.upgradeAvailable).toBe(false);
    expect(verdict.check.detail).toBeNull();
  });

  it("offers no upgrade between versions it cannot order", () => {
    const verdict = evaluateRelease("0.3.0", found("nightly", ["x.tgz", "x.tgz.sha256"]));
    expect(verdict.check.upgradeAvailable).toBe(false);
    expect(verdict.check.detail).toContain("cannot be ordered");
  });

  it("carries an unreachable check through as a described answer", () => {
    const verdict = evaluateRelease("0.3.0", { kind: "unreachable", detail: "offline" });
    expect(verdict.check).toMatchObject({
      reachable: false,
      latest: null,
      upgradeAvailable: false,
      verifiable: false,
      detail: "offline",
    });
  });

  it("distinguishes 'nothing published yet' from 'could not look'", () => {
    const verdict = evaluateRelease("0.3.0", { kind: "none" });
    expect(verdict.check.reachable).toBe(true);
    expect(verdict.check.latest).toBeNull();
    expect(verdict.check.detail).toContain("no releases yet");
  });
});
