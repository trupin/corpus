// SERVER-089. `CI / validate` failed twice in a server test that built a
// fifty-one-commit history (since removed with §7's rollback verb), with git
// refusing to walk the history it had just built — `error: Could not
// read <sha>` / `fatal: cannot simplify commit X (because of Y)` — and it never
// reproduced on a developer's machine. The cause is in `./maintenance.ts`: git
// spawns a *detached background* maintenance process after every commit, and on
// git 2.54 it starts repacking from the tenth commit into a fresh repository,
// concurrently with everything that follows.
//
// The guard below is written against the mechanism rather than the corruption,
// because the corruption is a race — it appeared in 8 of 25 runs under git 2.54
// and never under git 2.37, so an assertion about a broken repository would be
// a coin flip on one machine and vacuously green on the other. Whether git was
// *asked* to maintain the repository is deterministic on every version since
// 2.29 and observable from one commit.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";
import { sanitizeGitEnv } from "./env.js";

let ws: WriteWorkspace | undefined;
let control: string | undefined;

afterEach(() => {
  ws?.close();
  ws = undefined;
  if (control !== undefined) rmSync(control, { recursive: true, force: true });
  control = undefined;
});

/**
 * Commit into `root` under `GIT_TRACE`, answering what git ran as a child.
 *
 * `GIT_TRACE` is the only way to see the maintenance child: it is spawned
 * `--detach`, writes nothing to the commit's own output, and has usually not
 * finished by the time the commit returns.
 */
function childCommandsOfACommit(root: string, name: string): string[] {
  writeFileSync(join(root, name), `${name}\n`, "utf8");
  const result = spawnSync("git", ["add", "-A", "--", name], {
    cwd: root,
    env: sanitizeGitEnv(),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const committed = spawnSync("git", ["commit", "-q", "-m", name], {
    cwd: root,
    env: { ...sanitizeGitEnv(), GIT_TRACE: "1" },
    encoding: "utf8",
  });
  expect(committed.status, committed.stderr).toBe(0);
  return committed.stderr
    .split("\n")
    .filter((line) => line.includes("run_command:"))
    .map((line) => line.slice(line.indexOf("run_command:") + "run_command:".length).trim());
}

/** A repository built exactly like the fixture's, minus the settings. */
function controlRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-s028-maintenance-control-"));
  const git = (...args: string[]): void => {
    const result = spawnSync("git", args, { cwd: root, env: sanitizeGitEnv(), encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Workspace Owner");
  git("config", "user.email", "owner@example.test");
  return root;
}

const AUTO_MAINTENANCE = /^git maintenance run --auto\b/;

describe("automatic maintenance in the repositories these tests create", () => {
  it("is what a repository without the settings asks for, on every commit", () => {
    // Non-vacuity, and the guard's own tripwire: the assertion below is only
    // worth anything while git still spawns this dispatcher. When a future git
    // stops, or renames it, this fails first and says so — rather than the
    // fixture's assertion passing for the wrong reason.
    control = controlRepository();
    expect(childCommandsOfACommit(control, "first.txt")).toContainEqual(
      expect.stringMatching(AUTO_MAINTENANCE),
    );
  });

  it("is never asked for by a fixture workspace's repository", () => {
    ws = createWriteWorkspace("maintenance", { sprint: "s028" });
    expect(childCommandsOfACommit(ws.root, "first.txt")).not.toContainEqual(
      expect.stringMatching(AUTO_MAINTENANCE),
    );
  });

  it("leaves the object store exactly as the commits left it", () => {
    ws = createWriteWorkspace("maintenance-burst", { sprint: "s028" });
    // Past the point where git 2.54 starts repacking a fresh repository — it
    // packed at the tenth commit of that loop, which wrote six objects a
    // commit, so this writes the same shape with margin.
    for (let index = 0; index < 15; index += 1) {
      ws.write(
        ".claude/skills/orchestrate/SKILL.md",
        `---\nname: orchestrate\n---\n\n${String(index)}\n`,
      );
      ws.git("add", "-A", "--", ".claude");
      ws.git("commit", "-q", "-m", `edit ${String(index)}`);
    }

    // Nothing repacked behind us: every object is still the loose one its
    // commit wrote. This is the observable that flips on git 2.54 without the
    // settings — a pack appears — and it is what the corruption came out of.
    const packs = join(ws.root, ".git", "objects", "pack");
    expect(existsSync(packs) ? readdirSync(packs) : []).toEqual([]);
    expect(ws.git("fsck", "--no-progress").trim()).toBe("");
    expect(ws.git("log", "--format=%H").trim().split("\n")).toHaveLength(16);
  });
});
