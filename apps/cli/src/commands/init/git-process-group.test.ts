// CLI-039's measurement, with **real processes and real signals**.
//
// `git-timeout.test.ts` replaces `spawn` at module scope to observe the bound's
// arithmetic without waiting two minutes. This file does the opposite: nothing
// is mocked, `runGit` really spawns, and the question is the one the issue asked
// — when a `gc` forks a `repack` and the bound expires, does the fork die too?
//
// The bound itself is 120 s and is not waited out. A fake `git` on `PATH` forks
// a long-lived child and hangs, exactly as the issue's Testing Strategy asks,
// and the signal `runGit` sends at expiry is then sent by hand. What is measured
// is the property the signal depends on: whether the child git leads a process
// group of its own, which is the whole of what `detached: true` buys and the
// whole of why `execFile` could not be kept.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runGit } from "./git.js";

const scratch = mkdtempSync(join(tmpdir(), "cli039-"));
const PID_FILE = join(scratch, "children.pid");

/**
 * A `git` that behaves like a wedged `gc`: it forks a child that outlives it —
 * standing in for `git repack` / `pack-objects` — records both pids, and then
 * never returns.
 */
const FAKE_GIT = `#!/bin/sh
sh -c 'while true; do sleep 5; done' &
printf '%s %s\\n' "$$" "$!" > ${PID_FILE}
while true; do sleep 5; done
`;

const originalPath = process.env["PATH"];

beforeAll(() => {
  const path = join(scratch, "git");
  writeFileSync(path, FAKE_GIT);
  chmodSync(path, 0o755);
  // `sanitizeGitEnv` strips only the `GIT_` namespace, so PATH reaches the child.
  process.env["PATH"] = `${scratch}:${originalPath ?? ""}`;
});

afterAll(() => {
  process.env["PATH"] = originalPath;
  rmSync(scratch, { recursive: true, force: true });
});

const settle = (ms = 500): Promise<void> => new Promise((done) => setTimeout(done, ms));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The process group a pid belongs to, read from `ps` rather than assumed. */
const groupOf = (pid: number): number =>
  Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());

let started: { gc: number; forked: number } | undefined;

afterEach(async () => {
  if (started === undefined) return;
  for (const pid of [started.gc, started.forked]) {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  started = undefined;
  await settle(100);
});

describe("a git child that forks and hangs", () => {
  it("leads a process group of its own, so the bound can signal the fork with it", async () => {
    rmSync(PID_FILE, { force: true });

    // Real `runGit`, real spawn. It never settles — the fake git hangs — so the
    // rejection is caught rather than awaited here.
    const pending = runGit(["gc"], scratch);
    pending.catch(() => undefined);

    await settle();
    expect(existsSync(PID_FILE)).toBe(true);
    const [gc, forked] = readFileSync(PID_FILE, "utf8").trim().split(" ").map(Number);
    expect(typeof gc).toBe("number");
    expect(typeof forked).toBe("number");
    started = { gc: gc as number, forked: forked as number };

    expect(alive(started.gc)).toBe(true);
    expect(alive(started.forked)).toBe(true);

    // The property the whole fix rests on, measured rather than argued from the
    // manual page. Before CLI-039 the child shared **this** process's group, so
    // `process.kill(-pid)` would have signalled the CLI and its shell — which is
    // why the old code could only ever kill the direct pid, leaving the repack.
    expect(groupOf(started.gc)).toBe(started.gc);
    expect(groupOf(started.gc)).not.toBe(groupOf(process.pid));
    // The fork inherited that group, which is what puts it in the signalled set.
    expect(groupOf(started.forked)).toBe(started.gc);
  });

  it("ends with its fork when the group is signalled, which is what expiry does", async () => {
    rmSync(PID_FILE, { force: true });

    const pending = runGit(["gc"], scratch);
    const rejected = pending.then(
      () => "resolved",
      (error: unknown) => error,
    );

    await settle();
    const [gc, forked] = readFileSync(PID_FILE, "utf8").trim().split(" ").map(Number);
    started = { gc: gc as number, forked: forked as number };
    expect(alive(started.forked)).toBe(true);

    // Exactly what `boundToGroup` sends at GIT_TIMEOUT_MS.
    process.kill(-started.gc, "SIGTERM");
    await settle();

    expect(alive(started.gc)).toBe(false);
    // The assertion CLI-039 exists for: no unsupervised writer outlives the call.
    expect(alive(started.forked)).toBe(false);

    // …and `runGit` reports it as a killed child rather than as an exit status,
    // so `hasStagedChanges` cannot read a wedged repack as `diff`'s exit 1.
    expect(await rejected).toMatchObject({ killed: true });
  });
});
