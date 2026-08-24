// The bound on every git child the CLI spawns, asserted rather than assumed —
// and, since CLI-039, asserted about the whole **process group** rather than
// about the one pid.
//
// This lives in its own file because it is the one test here that must **not**
// run against real git: it replaces `node:child_process`'s `spawn` at module
// scope, which would break every other case in `git.test.ts`.
//
// Why it exists at all (PR #42 re-review, finding 4): `runGit` had no timeout
// until CLI-037's follow-up, and nothing would have noticed if it were dropped
// again — which is exactly how it went missing the first time. §4 now promises
// in signed text that "Maintenance never prevents a server from starting", and
// that promise rests entirely on this bound being present and reaching every
// process the child forked.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: Record<string, unknown>;
}

const calls: SpawnCall[] = [];

/** The signals `runGit` sent, and to which pid — negative means a process group. */
const signals: { pid: number; signal: string }[] = [];

/** A `ChildProcess` stand-in with the three streams and events `runGit` uses. */
class FakeChild extends EventEmitter {
  readonly pid = 4711;
  readonly stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
}

let child: FakeChild;

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (file: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options });
      child = new FakeChild();
      return child;
    },
  };
});

const { GIT_KILL_GRACE_MS, GIT_TIMEOUT_MS, runGit } = await import("./git.js");

beforeEach(() => {
  calls.length = 0;
  signals.length = 0;
  vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
    signals.push({ pid, signal: String(signal) });
    return true;
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("every git child the CLI spawns is bounded", () => {
  it("puts the child in its own process group, which is what makes the bound reach a repack", async () => {
    const pending = runGit(["gc"], "/tmp");
    // `detached` is the whole mechanism. Without it, `-pid` names this process's
    // own group and the bound would signal the CLI and its shell.
    expect(calls[0]?.options["detached"]).toBe(true);

    child.emit("close", 0, null);
    await pending;
  });

  it("keeps the sanitized environment alongside the bound, not instead of it", async () => {
    const pending = runGit(["--version"], "/tmp");
    const options = calls[0]?.options ?? {};
    // Both properties are load-bearing and were added by different issues; a
    // rewrite of this spawn call must not trade one for the other.
    expect(options["env"]).toBeDefined();
    expect((options["env"] as Record<string, string>)["GIT_DIR"]).toBeUndefined();
    expect(options["detached"]).toBe(true);

    child.emit("close", 0, null);
    await pending;
  });

  it("closes stdin, so a git that reads it fails instead of hanging out the bound", async () => {
    const pending = runGit(["commit"], "/tmp");
    expect(calls[0]?.options["stdio"]).toEqual(["ignore", "pipe", "pipe"]);

    child.emit("close", 0, null);
    await pending;
  });

  it("signals the group, not the pid, when the bound expires", async () => {
    const pending = runGit(["gc"], "/tmp");
    expect(signals).toEqual([]);

    await vi.advanceTimersByTimeAsync(GIT_TIMEOUT_MS);
    // The assertion CLI-039 is about: a **negative** pid is the process group,
    // so `git repack` and `pack-objects` are in the signalled set. A positive
    // 4711 here is the regression, and it looks identical in a log.
    expect(signals).toEqual([{ pid: -4711, signal: "SIGTERM" }]);

    child.emit("close", null, "SIGTERM");
    await expect(pending).rejects.toThrow();
  });

  it("escalates the whole group to SIGKILL when SIGTERM is ignored", async () => {
    const pending = runGit(["gc"], "/tmp");
    await vi.advanceTimersByTimeAsync(GIT_TIMEOUT_MS + GIT_KILL_GRACE_MS);

    expect(signals).toEqual([
      { pid: -4711, signal: "SIGTERM" },
      { pid: -4711, signal: "SIGKILL" },
    ]);

    child.emit("close", null, "SIGKILL");
    await expect(pending).rejects.toThrow();
  });

  it("stands the bound down when git finishes normally, signalling nothing", async () => {
    const pending = runGit(["--version"], "/tmp");
    child.stdout.emit("data", "git version 2.49.0\n");
    child.emit("close", 0, null);

    await expect(pending).resolves.toEqual({ stdout: "git version 2.49.0\n", stderr: "" });

    // Long past the bound: a timer that survived the call would signal a pid
    // this process no longer owns, which on a busy machine is somebody else's.
    await vi.advanceTimersByTimeAsync(GIT_TIMEOUT_MS + GIT_KILL_GRACE_MS);
    expect(signals).toEqual([]);
  });

  it("is generous enough to be a bound on pathology, not a performance budget", () => {
    // CLI-037 measured a real pack of 7028 loose objects at 0.16 s. If someone
    // ever tightens this toward the server's 30 s hook budget, they are
    // budgeting a repack with a number chosen for a pre-commit hook.
    expect(GIT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("the rejection shape every caller reads", () => {
  it("carries a numeric code, so `diff --cached --quiet`'s answer is still readable", async () => {
    const pending = runGit(["diff", "--cached", "--quiet"], "/tmp");
    child.emit("close", 1, null);

    // `hasStagedChanges` and `workspace upgrade` branch on exactly this.
    await expect(pending).rejects.toMatchObject({ code: 1 });
  });

  it("carries git's stderr, which is what `gitFailure` surfaces", async () => {
    const pending = runGit(["commit"], "/tmp");
    child.stderr.emit("data", "fatal: not a git repository\n");
    child.emit("close", 128, null);

    await expect(pending).rejects.toMatchObject({
      code: 128,
      stderr: "fatal: not a git repository\n",
    });
  });

  it("carries no numeric code when the group was killed at the bound", async () => {
    // Otherwise a group killed at 120 s would be indistinguishable from
    // `git diff --quiet` reporting staged changes, and the upgrade path would
    // read a wedged repack as an answer.
    const pending = runGit(["gc"], "/tmp");
    child.emit("close", null, "SIGKILL");

    await expect(pending).rejects.toMatchObject({ killed: true, signal: "SIGKILL" });
    await expect(pending).rejects.not.toHaveProperty("code");
  });

  it("passes a spawn failure through untouched, which is `requireGit`'s case", async () => {
    const pending = runGit(["--version"], "/tmp");
    const enoent = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    child.emit("error", enoent);

    await expect(pending).rejects.toBe(enoent);
  });
});
