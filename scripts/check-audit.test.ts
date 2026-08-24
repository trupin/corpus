/**
 * The runner half of the audit gate, exercised as a process (INFRA-015).
 *
 * `scripts/check-audit.ts` is a top-level script with nothing to import, so the
 * only honest way to test it is to run it — and the only honest way to test the
 * branches that matter here is to *cause* the failures rather than describe
 * them. Each case below puts a purpose-built `npm` on `PATH` (or removes npm
 * from `PATH` entirely) and reads the real exit code.
 *
 * What is being pinned: the tolerate flag `.githooks/pre-commit` passes covers
 * an unanswering registry and nothing else. A gate that could not run must fail
 * in **both** callers' forms, because "the check reported nothing" and "the
 * check found nothing" are otherwise the same output.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const checker = resolve(repoRoot, "scripts/check-audit.ts");

/** The flag `.githooks/pre-commit` passes; CI passes nothing. Both forms are tested. */
const TOLERATE = "--tolerate-unreachable-registry";

/** Comfortably over the runner's 64 MiB `maxBuffer`, so the capture really does overflow. */
const OVERFLOW_MIB = 65;

/** One directory per shim, each becoming the whole of `PATH` for its run. */
let shimRoot: string;
let overflowingNpm: string;
let absentNpm: string;
let unreachableNpm: string;

function shimDir(name: string): string {
  const dir = join(shimRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeShim(dir: string, body: string): void {
  const shim = join(dir, "npm");
  writeFileSync(shim, `#!/bin/sh\n${body}\n`);
  chmodSync(shim, 0o755);
}

interface RunResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

/** Runs the real checker with `PATH` set to exactly `pathDir`. */
function runChecker(pathDir: string, args: readonly string[]): RunResult {
  const result = spawnSync(process.execPath, ["--import", "tsx", checker, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    // PATH is replaced, not extended: that is what makes "npm is absent" real.
    env: { ...process.env, PATH: pathDir },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

beforeAll(() => {
  shimRoot = mkdtempSync(join(tmpdir(), "corpus-infra-015-"));

  overflowingNpm = shimDir("overflowing");
  writeShim(
    overflowingNpm,
    `exec "${process.execPath}" -e "const chunk = 'x'.repeat(1024 * 1024); ` +
      `for (let i = 0; i < ${String(OVERFLOW_MIB)}; i += 1) process.stdout.write(chunk);"`,
  );

  // Recorded from `npm_config_registry=http://127.0.0.1:9/ npm audit --json`: npm
  // answered, and its answer was that it could not reach the registry.
  unreachableNpm = shimDir("unreachable");
  const unreachablePayload = JSON.stringify({
    message:
      "request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, " +
      "reason: connect ECONNREFUSED 127.0.0.1:9",
    error: { summary: "", detail: "" },
  });
  writeShim(unreachableNpm, `printf '%s' '${unreachablePayload}'\nexit 1`);

  // Deliberately left empty: there is no npm on this PATH.
  absentNpm = shimDir("absent");
});

afterAll(() => {
  rmSync(shimRoot, { recursive: true, force: true });
});

const BOTH_FORMS: readonly (readonly [string, readonly string[]])[] = [
  ["pre-commit form, tolerate flag passed", [TOLERATE]],
  ["CI form, no flag", []],
];

describe("check-audit.ts fails closed when the gate itself could not run", () => {
  it.each(BOTH_FORMS)(
    "exits non-zero when npm audit overflows the capture buffer — %s",
    (_label, args) => {
      const run = runChecker(overflowingNpm, args);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("THE SUPPLY-CHAIN GATE COULD NOT RUN");
      expect(run.stderr).toContain("truncated");
      // The bug this replaced: the same situation printed the registry's headline
      // and let the commit through.
      expect(run.stderr).not.toContain("THE SUPPLY-CHAIN GATE DID NOT RUN");
      expect(run.stdout).not.toContain("0 vulnerabilities");
    },
    60_000,
  );

  it.each(BOTH_FORMS)(
    "exits non-zero when npm cannot be started at all — %s",
    (_label, args) => {
      const run = runChecker(absentNpm, args);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("THE SUPPLY-CHAIN GATE COULD NOT RUN");
      expect(run.stderr).toContain("ENOENT");
      expect(run.stderr).not.toContain("THE SUPPLY-CHAIN GATE DID NOT RUN");
      expect(run.stdout).not.toContain("0 vulnerabilities");
    },
    30_000,
  );
});

describe("check-audit.ts keeps the one branch the tolerate flag is for", () => {
  it("warns and proceeds locally when the registry itself did not answer", () => {
    const run = runChecker(unreachableNpm, [TOLERATE]);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("THE SUPPLY-CHAIN GATE DID NOT RUN");
    expect(run.stderr).toContain("ECONNREFUSED");
    expect(run.stderr).toContain("Proceeding anyway");
  }, 30_000);

  it("fails closed on the same payload without the flag, which is what CI runs", () => {
    const run = runChecker(unreachableNpm, []);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("THE SUPPLY-CHAIN GATE DID NOT RUN");
    expect(run.stderr).toContain("Failing closed");
  }, 30_000);
});
