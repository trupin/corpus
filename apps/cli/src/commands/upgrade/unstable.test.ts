import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { stubFetch } from "../../testing/fetch.js";
import { refuseUndetectable, refuseUnwritable } from "./install.js";
import {
  ARTIFACT_RETENTION_DAYS,
  buildAge,
  CORPUS_TOKEN_ENV_VAR,
  describeBuild,
  GITHUB_TOKEN_ENV_VAR,
  lookupPrBuilds,
  MAX_ARTIFACT_PAGES,
  parseArtifactName,
  refuseWithoutToken,
  resolveGithubToken,
  unzipSingleTarball,
  UNVERIFIED_NOTICE,
} from "./unstable.js";

/**
 * The forked half of `corpus upgrade --unstable` (CLI-034): finding a
 * pull-request build and unwrapping it. The shared install half is exercised
 * through `runUpgrade` in `index.test.ts`.
 */

const NOW = new Date("2026-08-26T12:00:00Z");

describe("parseArtifactName", () => {
  it("reads INFRA-026's scheme", () => {
    expect(parseArtifactName("corpus-0.24.0-pr63-a1b2c3d")).toEqual({
      version: "0.24.0",
      pr: 63,
      sha: "a1b2c3d",
    });
  });

  it("reads a prerelease version, since a build may carry one one day", () => {
    expect(parseArtifactName("corpus-1.0.0-rc.1-pr7-abcdef0")?.version).toBe("1.0.0-rc.1");
  });

  /*
   * A repository's artifact list is a shared namespace — the coverage bundles
   * outnumber the PR builds — and a command that fell over on somebody else's
   * entry would be broken by a workflow it has nothing to do with.
   */
  it.each([
    ["merged-coverage"],
    ["corpus-0.24.0-a1b2c3d"],
    ["corpus-0.24.0-pr63"],
    ["corpus-pr63-a1b2c3d"],
    ["corpus-0.24.0-prX-a1b2c3d"],
  ])("skips %s rather than mis-reading it", (name) => {
    expect(parseArtifactName(name)).toBeNull();
  });
});

describe("resolveGithubToken", () => {
  const never = (): string | null => null;

  it("prefers the dedicated variable, so GITHUB_TOKEN keeps its own job", () => {
    const found = resolveGithubToken(
      { [CORPUS_TOKEN_ENV_VAR]: "dedicated", [GITHUB_TOKEN_ENV_VAR]: "general" },
      never,
    );
    expect(found).toEqual({ token: "dedicated", source: "env", detail: CORPUS_TOKEN_ENV_VAR });
  });

  it("falls back to GITHUB_TOKEN, then to the GitHub CLI", () => {
    expect(resolveGithubToken({ [GITHUB_TOKEN_ENV_VAR]: "general" }, never)?.token).toBe("general");
    expect(resolveGithubToken({}, () => "from-gh")).toEqual({
      token: "from-gh",
      source: "gh",
      detail: "`gh auth token`",
    });
  });

  it("treats blank as absent, so an exported-but-empty variable is not a token", () => {
    expect(resolveGithubToken({ [CORPUS_TOKEN_ENV_VAR]: "   " }, never)).toBeNull();
    expect(resolveGithubToken({}, () => "  ")).toBeNull();
  });

  it("refuses with instructions, and says the stable path needs none", () => {
    const refusal = refuseWithoutToken();
    expect(refusal.message).toContain("actions: read");
    expect(refusal.hint).toContain("gh auth login");
    expect(refusal.hint).toContain(CORPUS_TOKEN_ENV_VAR);
    // Never a silent fallback: the sentence says the other path exists rather
    // than the command quietly taking it.
    expect(refusal.hint).toContain("`corpus upgrade` without the flag");
  });
});

/** One artifact, in the shape the API returns. */
function artifact(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 100,
    name: "corpus-0.24.0-pr63-a1b2c3d",
    size_in_bytes: 1024,
    archive_download_url: "https://api.github.test/artifacts/100/zip",
    expired: false,
    created_at: "2026-08-26T11:00:00Z",
    workflow_run: { repository_id: 1, head_repository_id: 1, head_sha: "a1b2c3d" },
    ...overrides,
  };
}

function listing(artifacts: readonly unknown[], status = 200): typeof globalThis.fetch {
  return stubFetch(() =>
    status === 200
      ? Response.json({ artifacts })
      : new Response("{}", { status, statusText: status === 403 ? "Forbidden" : "" }),
  );
}

const OPTIONS = {
  api: "https://api.github.test",
  repo: "trupin/corpus",
  version: "0.24.0",
  token: "tok",
  timeoutMs: 1_000,
};

describe("lookupPrBuilds", () => {
  it("finds the newest build and names its pull request", async () => {
    const found = await lookupPrBuilds({
      ...OPTIONS,
      fetch: listing([
        artifact({ id: 1, name: "corpus-0.24.0-pr60-aaaaaaa", created_at: "2026-08-25T09:00:00Z" }),
        artifact({ id: 2, name: "corpus-0.24.0-pr63-bbbbbbb", created_at: "2026-08-26T09:00:00Z" }),
        artifact({ id: 3, name: "merged-coverage" }),
      ]),
    });

    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    // Newest by build time, not by PR number: the highest-numbered pull request
    // is frequently not the most recently pushed.
    expect(found.build.pr).toBe(63);
    expect(found.build.sha).toBe("bbbbbbb");
    expect(found.truncated).toBe(false);
  });

  it("takes the pull request it was given, and does not fall back to another", async () => {
    const found = await lookupPrBuilds({
      ...OPTIONS,
      pr: 60,
      fetch: listing([
        artifact({ id: 1, name: "corpus-0.24.0-pr60-aaaaaaa", created_at: "2026-08-25T09:00:00Z" }),
        artifact({ id: 2, name: "corpus-0.24.0-pr63-bbbbbbb", created_at: "2026-08-26T09:00:00Z" }),
      ]),
    });
    expect(found.kind === "found" && found.build.pr).toBe(60);
  });

  it("names the retention window when every build for a PR has expired", async () => {
    const none = await lookupPrBuilds({
      ...OPTIONS,
      pr: 63,
      fetch: listing([artifact({ expired: true })]),
    });
    expect(none.kind).toBe("none");
    expect(none.kind === "none" && none.detail).toContain(String(ARTIFACT_RETENTION_DAYS));
    expect(none.kind === "none" && none.detail).toContain("PR #63");
  });

  /*
   * INFRA-026 records what the workflow actually does for a fork: it runs, and
   * it uploads. So the build is reachable and cannot be refused by absence — the
   * run's own `head_repository_id` is the only thing that says where the code
   * came from.
   */
  it("refuses a fork's build, and says how to take it anyway", async () => {
    const fork = listing([
      artifact({
        workflow_run: { repository_id: 1, head_repository_id: 999, head_sha: "a1b2c3d" },
      }),
    ]);
    const none = await lookupPrBuilds({ ...OPTIONS, fetch: fork });
    expect(none.kind).toBe("none");
    expect(none.kind === "none" && none.detail).toContain("fork");
    expect(none.kind === "none" && none.detail).toContain("--allow-fork");

    const allowed = await lookupPrBuilds({ ...OPTIONS, fetch: fork, allowFork: true });
    expect(allowed.kind).toBe("found");
  });

  it("treats a build that cannot say where it came from as one that came from elsewhere", async () => {
    const none = await lookupPrBuilds({
      ...OPTIONS,
      fetch: listing([artifact({ workflow_run: { repository_id: 1, head_sha: "a1b2c3d" } })]),
    });
    expect(none.kind).toBe("none");
  });

  it("tells a rejected token from an under-privileged one", async () => {
    const unauthorized = await lookupPrBuilds({ ...OPTIONS, fetch: listing([], 401) });
    expect(unauthorized.kind === "unreachable" && unauthorized.detail).toContain("401");
    expect(unauthorized.kind === "unreachable" && unauthorized.detail).toContain("revoked");

    const forbidden = await lookupPrBuilds({ ...OPTIONS, fetch: listing([], 403) });
    expect(forbidden.kind === "unreachable" && forbidden.detail).toContain("actions: read");
  });

  it("reports an unreachable API rather than throwing", async () => {
    const offline = await lookupPrBuilds({
      ...OPTIONS,
      fetch: stubFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(offline.kind).toBe("unreachable");
  });

  /*
   * No silent caps. The listing mixes every workflow's artifacts, so the search
   * is bounded — and a bounded search that reported "no build" indistinguishably
   * from an exhaustive one would be a lie by omission.
   */
  it("says when it stopped short of the whole list", async () => {
    let page = 0;
    const paged = stubFetch(() => {
      page += 1;
      return Response.json({
        artifacts: Array.from({ length: 100 }, (_unused, index) =>
          artifact({ id: page * 1000 + index, name: "merged-coverage" }),
        ),
      });
    });
    const none = await lookupPrBuilds({ ...OPTIONS, fetch: paged });
    expect(page).toBe(MAX_ARTIFACT_PAGES);
    expect(none.kind === "none" && none.truncated).toBe(true);
  });

  it("stops early on a short page rather than asking for more", async () => {
    let page = 0;
    const short = stubFetch(() => {
      page += 1;
      return Response.json({ artifacts: [artifact()] });
    });
    const found = await lookupPrBuilds({ ...OPTIONS, fetch: short });
    expect(page).toBe(1);
    expect(found.kind === "found" && found.truncated).toBe(false);
  });
});

describe("describeBuild", () => {
  it("names the PR, the version, the commit and the age, in one line", () => {
    const said = describeBuild(
      {
        pr: 63,
        version: "0.24.0",
        sha: "a1b2c3d",
        artifactId: 1,
        artifactName: "corpus-0.24.0-pr63-a1b2c3d",
        createdAt: "2026-08-26T11:30:00Z",
        sizeBytes: 10,
        downloadUrl: "https://example.test/zip",
      },
      NOW,
    );
    expect(said).toBe("PR #63 — corpus 0.24.0, commit a1b2c3d, built 30 minutes ago");
  });

  it.each([
    ["2026-08-26T11:59:00Z", "1 minute ago"],
    ["2026-08-26T09:00:00Z", "3 hours ago"],
    ["2026-08-20T12:00:00Z", "6 days ago"],
    ["not a date", "at an unknown time"],
  ])("says %s was %s", (at, expected) => {
    expect(buildAge(at, NOW)).toBe(expected);
  });
});

describe("the unverified notice", () => {
  it("says what did not run, and how to get back", () => {
    expect(UNVERIFIED_NOTICE).toContain("no checksum");
    expect(UNVERIFIED_NOTICE).toContain("verification");
    expect(UNVERIFIED_NOTICE).toContain("`corpus upgrade` reinstalls");
  });
});

/** A one-entry zip, built by hand so the reader is tested against real bytes. */
function makeZip(name: string, body: Buffer, method: 0 | 8): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const stored = method === 0 ? body : deflateRawSync(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(stored.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(stored.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const localPart = Buffer.concat([local, nameBytes, stored]);
  eocd.writeUInt32LE(localPart.length + central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, central, nameBytes, eocd]);
}

describe("unzipSingleTarball", () => {
  const tarball = Buffer.from("corpus tarball bytes, repeated ".repeat(40));

  it("reads a deflated entry, which is what upload-artifact produces", () => {
    const entry = unzipSingleTarball(makeZip("corpus-0.24.0.tgz", tarball, 8), "artifact");
    expect(entry.name).toBe("corpus-0.24.0.tgz");
    expect(entry.bytes.equals(tarball)).toBe(true);
  });

  it("reads a stored entry too, since a small tarball may not compress", () => {
    const entry = unzipSingleTarball(makeZip("corpus-0.24.0.tgz", tarball, 0), "artifact");
    expect(entry.bytes.equals(tarball)).toBe(true);
  });

  it("refuses an archive with no tarball rather than guessing", () => {
    expect(() => unzipSingleTarball(makeZip("notes.txt", tarball, 8), "artifact")).toThrow(
      /contains no .tgz tarball/,
    );
  });

  it("refuses bytes that are not a zip at all", () => {
    expect(() => unzipSingleTarball(Buffer.from("not a zip"), "artifact")).toThrow(
      /not a zip archive/,
    );
  });
});

/**
 * The by-hand instruction, which is where "instructions that are not runnable
 * are not instructions" met a second reader.
 *
 * A release's URL is a tarball, so `npm install -g <url>` pastes and works. A
 * pull-request build's URL is an artifact **zip behind an authenticated API**,
 * and the same line cannot work — a refusal carrying it would hand somebody a
 * command that fails, which is worse than handing them none. Caught by the real
 * E2E run, not by a review.
 */
describe("the refusals' by-hand instruction", () => {
  const undetectable = {
    kind: "undetectable",
    packageRoot: "/home/me/code/corpus/apps/cli",
    reason: "a source checkout",
  } as const;

  it("pastes a command for a release", () => {
    const refusal = refuseUndetectable(undetectable, "https://example.test/corpus-0.4.0.tgz");
    expect(refusal.hint).toContain("`npm install -g https://example.test/corpus-0.4.0.tgz`");
  });

  it("describes the two steps for a PR build, and offers no unrunnable line", () => {
    const refusal = refuseUndetectable(
      undetectable,
      "https://api.github.test/artifacts/900/zip",
      "by downloading corpus-0.4.0-pr63-a1b2c3d from pull request #63 and running `npm install -g <path-to-tgz>` on the tarball inside it",
    );
    expect(refusal.hint).toContain("pull request #63");
    expect(refusal.hint).toContain("<path-to-tgz>");
    // The zip URL never appears as something to install.
    expect(refusal.hint).not.toContain("/zip");
  });

  it("does the same for an unwritable prefix", () => {
    const refusal = refuseUnwritable(
      {
        kind: "npm-global",
        packageRoot: "/usr/lib/node_modules/corpus",
        packageName: "corpus",
        prefix: "/usr",
        globalRoot: "/usr/lib/node_modules",
      },
      "https://api.github.test/artifacts/900/zip",
      "by downloading it from pull request #63",
    );
    expect(refusal.hint).toContain("pull request #63");
    expect(refusal.hint).not.toContain("/zip");
  });
});
