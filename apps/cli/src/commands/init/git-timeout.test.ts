// The bound on every git child the CLI spawns, asserted rather than assumed.
//
// This lives in its own file because it is the one test here that must **not**
// run against real git: it mocks `node:child_process` at module scope, which
// would break every other case in `git.test.ts`.
//
// Why it exists at all (PR #42 re-review, finding 4): `runGit` had no timeout
// until CLI-037's follow-up, and nothing would have noticed if it were dropped
// again — which is exactly how it went missing the first time. §4 now promises
// in signed text that "Maintenance never prevents a server from starting", and
// that promise rests entirely on this one option being present.

import { describe, expect, it, vi } from "vitest";

const calls: { args: readonly string[]; options: Record<string, unknown> }[] = [];

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: readonly string[],
    options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    calls.push({ args: [file, ...args], options });
    callback(null, "", "");
    return undefined;
  },
}));

const { GIT_TIMEOUT_MS, runGit } = await import("./git.js");

describe("every git child the CLI spawns is bounded", () => {
  it("passes the timeout to execFile, so a hung `git gc` cannot wedge a server start", async () => {
    calls.length = 0;
    await runGit(["gc"], "/tmp");

    expect(calls).toHaveLength(1);
    // The assertion that matters. Read the option rather than trusting the
    // constant: dropping `timeout` from the options object is the regression,
    // and it leaves the exported constant perfectly intact.
    expect(calls[0]?.options["timeout"]).toBe(GIT_TIMEOUT_MS);
  });

  it("keeps the sanitized environment alongside the bound, not instead of it", async () => {
    calls.length = 0;
    await runGit(["--version"], "/tmp");

    const options = calls[0]?.options ?? {};
    // Both properties are load-bearing and were added by different issues; a
    // rewrite of this options object must not trade one for the other.
    expect(options["timeout"]).toBe(GIT_TIMEOUT_MS);
    expect(options["env"]).toBeDefined();
    expect((options["env"] as Record<string, string>)["GIT_DIR"]).toBeUndefined();
  });

  it("is generous enough to be a bound on pathology, not a performance budget", () => {
    // CLI-037 measured a real pack of 7028 loose objects at 0.16 s. If someone
    // ever tightens this toward the server's 30 s hook budget, they are
    // budgeting a repack with a number chosen for a pre-commit hook.
    expect(GIT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
