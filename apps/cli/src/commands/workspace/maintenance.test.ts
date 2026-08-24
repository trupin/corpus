import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { commitAll, initRepository, type GitRunner } from "../init/git.js";
import {
  ensureMaintenanceSettings,
  LOOSE_OBJECT_LIMIT,
  MAINTENANCE_SETTINGS,
  maintainOrWarn,
  maintainRepository,
  missingMaintenanceSettings,
  readRepositoryObjects,
  renderMaintenance,
} from "./maintenance.js";

/**
 * Real repositories throughout. The thing under test is a *claim about git* —
 * that these two settings stop it maintaining a repository behind us, and that
 * an explicit `gc` still packs one — and a stubbed runner can only ever restate
 * the claim back at itself. The stub appears in exactly one place below, where
 * the question is "what does this do when git fails", which no real repository
 * can be persuaded to answer on demand.
 */

const execFileAsync = promisify(execFile);
const PREFIX = "corpus-cli037-";
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function makeRepository(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), PREFIX));
  scratch.push(root);
  writeFileSync(join(root, "seed.md"), "seed\n", "utf8");
  await initRepository(root);
  await commitAll({ dir: root, message: "seed" });
  return root;
}

const git = async (repo: string, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, { cwd: repo, encoding: "utf8" });
  return stdout;
};

/** `n` commits, each adding one file, so the object store actually grows. */
async function commits(root: string, n: number): Promise<void> {
  mkdirSync(join(root, "notes"), { recursive: true });
  for (let i = 0; i < n; i++) {
    writeFileSync(join(root, "notes", `note-${String(i)}.md`), `note ${String(i)}\n`, "utf8");
    await commitAll({ dir: root, message: `note ${String(i)}` });
  }
}

describe("the maintenance settings", () => {
  it("writes both into a repository that carries neither, and reports them", async () => {
    const root = await makeRepository();

    expect(await ensureMaintenanceSettings(root)).toEqual(["maintenance.auto", "gc.auto"]);
    expect((await git(root, "config", "--local", "--get", "maintenance.auto")).trim()).toBe(
      "false",
    );
    expect((await git(root, "config", "--local", "--get", "gc.auto")).trim()).toBe("0");
  });

  it("is idempotent: a second run writes nothing and reports nothing", async () => {
    const root = await makeRepository();
    await ensureMaintenanceSettings(root);

    expect(await ensureMaintenanceSettings(root)).toEqual([]);
  });

  it("corrects a repository that has maintenance switched back on", async () => {
    const root = await makeRepository();
    await ensureMaintenanceSettings(root);
    await git(root, "config", "--local", "maintenance.auto", "true");

    // Not a preference: leaving it would reinstate the corruption hazard the
    // setting exists to remove.
    expect(await ensureMaintenanceSettings(root)).toEqual(["maintenance.auto"]);
    expect((await git(root, "config", "--local", "--get", "maintenance.auto")).trim()).toBe(
      "false",
    );
  });

  it("names what is missing without writing it, which is what --dry-run reports", async () => {
    const root = await makeRepository();

    expect(await missingMaintenanceSettings(root)).toEqual(["maintenance.auto", "gc.auto"]);
    await expect(git(root, "config", "--local", "--get", "maintenance.auto")).rejects.toThrow();
  });

  it("is local to the repository, so nothing outside the workspace is touched", async () => {
    const root = await makeRepository();
    await ensureMaintenanceSettings(root);

    const local = await git(root, "config", "--local", "--list");
    expect(local).toContain("maintenance.auto=false");
    // `--local` reading it back is the assertion: a global write would not be here.
    for (const [name] of MAINTENANCE_SETTINGS) expect(local).toContain(`${name}=`);
  });

  /**
   * **An explicit budget, sized to a measurement** (CLI-068, INFRA-020's third
   * instance). This is the most expensive test in the file by a wide margin:
   * a real `git init`, **60 sequential real commits**, and a `git fsck --full`
   * over the result. Measured on this machine, with the load average recorded
   * for each shape:
   *
   * | shape | load | ms |
   * | --- | --- | --- |
   * | alone, `-t` filtered, 5 runs | 7.8–8.9 | 2056 · 2107 · 2304 · 2387 · 2480 |
   * | inside this file, 8 runs | 7.3–16.3 | 1605 · 1878 · 2107 · 2184 · 2370 · 3158 · 3197 · 3278 |
   * | inside the whole `apps/cli` suite, 2 runs | 11–16 | 2901 · 3483 |
   * | inside a full run beside another agent's | — | **timed out at 5000** |
   *
   * So it costs **32–70% of vitest's 5 s default**, median ~45%, against
   * INFRA-020's proposed rule that a test needing >20% of its timeout idle will
   * flake under the gate. The cheapest run ever seen is still over that rule,
   * so the timeout that prompted this was not pure load.
   *
   * **The spread is itself the diagnosis.** The same shape ranges 1605–3278 ms
   * at effectively the same reported load, because the cost here is 60
   * sequential `git commit`s: fsync and directory churn, which contend
   * machine-wide and are invisible to a CPU load average. A budget must cover
   * the bad end of that spread, not its middle.
   *
   * 20 s is ~9× the median in the shape the gate runs it and ~6× the worst run
   * observed, which clears a machine several times more contended than any seen
   * here while still failing fast if the commit loop stops making progress.
   * Sized to this test and **not raised across the board** — every other test in
   * this file keeps the default, and each builds at most a handful of commits.
   *
   * The real remedy is INFRA-020's second criterion, *make the work cheaper*,
   * and it does not apply here: the 60 is load-bearing. Git 2.54's
   * geometric-repack task was measured firing at the 41st commit through the
   * product, so the count cannot drop far below that without the test ceasing
   * to prove the thing it names.
   */
  it(
    "stops git repacking the repository behind us across a run of commits",
    { timeout: 20_000 },
    async () => {
      const root = await makeRepository();
      await ensureMaintenanceSettings(root);

      // Well past the point at which git 2.54's geometric-repack task fires on an
      // unconfigured repository — measured through the product at the 41st commit.
      await commits(root, 60);

      const objects = await readRepositoryObjects(root);
      expect(objects.packs).toBe(0);
      expect(objects.loose).toBeGreaterThan(100);
      expect(await git(root, "fsck", "--full")).toBe("");
    },
  );
});

describe("reading the object store", () => {
  it("reports loose, packed and pack counts", async () => {
    const root = await makeRepository();
    await ensureMaintenanceSettings(root);
    await commits(root, 3);

    const objects = await readRepositoryObjects(root);
    expect(objects.loose).toBeGreaterThan(0);
    expect(objects.packs).toBe(0);
    expect(objects.packed).toBe(0);
  });

  it("reads 0 for a key git did not report rather than NaN", async () => {
    const stub: GitRunner = () => Promise.resolve({ stdout: "count: 4\n", stderr: "" });

    expect(await readRepositoryObjects("/nowhere", stub)).toEqual({
      loose: 4,
      packed: 0,
      packs: 0,
    });
  });
});

describe("maintaining the repository", () => {
  it("packs nothing while the loose count is under the threshold", async () => {
    const root = await makeRepository();
    await commits(root, 5);

    const outcome = await maintainRepository({ dir: root });

    expect(outcome.packed).toBe(false);
    expect(outcome.after).toBeNull();
    expect(outcome.threshold).toBe(LOOSE_OBJECT_LIMIT);
    expect((await readRepositoryObjects(root)).packs).toBe(0);
  });

  it("packs once the loose count is above the threshold, and leaves the history intact", async () => {
    const root = await makeRepository();
    await commits(root, 12);
    const history = await git(root, "log", "--oneline");

    const outcome = await maintainRepository({ dir: root, threshold: 10 });

    expect(outcome.packed).toBe(true);
    expect(outcome.before.loose).toBeGreaterThan(10);
    expect(outcome.after?.loose).toBe(0);
    expect(outcome.after?.packs).toBe(1);
    expect(await git(root, "log", "--oneline")).toBe(history);
    expect(await git(root, "fsck", "--full")).toBe("");
  });

  it("packs on --force however few objects there are", async () => {
    const root = await makeRepository();

    const outcome = await maintainRepository({ dir: root, force: true });

    expect(outcome.packed).toBe(true);
    expect(outcome.after?.packs).toBe(1);
  });

  it("packs nothing under settingsOnly, even when it is due", async () => {
    const root = await makeRepository();
    await commits(root, 12);

    const outcome = await maintainRepository({ dir: root, threshold: 10, settingsOnly: true });

    expect(outcome.packed).toBe(false);
    expect(outcome.settings).toEqual(["maintenance.auto", "gc.auto"]);
    expect((await readRepositoryObjects(root)).packs).toBe(0);
  });

  it("applies the settings before it packs, so packing is never the first commit's problem", async () => {
    const root = await makeRepository();

    const outcome = await maintainRepository({ dir: root, force: true });

    expect(outcome.settings).toEqual(["maintenance.auto", "gc.auto"]);
    expect((await git(root, "config", "--local", "--get", "maintenance.auto")).trim()).toBe(
      "false",
    );
  });
});

describe("what a person sees", () => {
  it("says nothing at all when there was nothing to do", () => {
    expect(
      renderMaintenance({
        settings: [],
        before: { loose: 12, packed: 0, packs: 0 },
        after: null,
        packed: false,
        threshold: LOOSE_OBJECT_LIMIT,
      }),
    ).toEqual([]);
  });

  it("names the settings the first time a workspace comes under the rule", () => {
    const lines = renderMaintenance({
      settings: ["maintenance.auto", "gc.auto"],
      before: { loose: 12, packed: 0, packs: 0 },
      after: null,
      packed: false,
      threshold: LOOSE_OBJECT_LIMIT,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("maintenance.auto, gc.auto");
    expect(lines[0]).toContain("corpus packs it at server start");
  });

  it("reports what was packed, with the counts on both sides", () => {
    const lines = renderMaintenance({
      settings: [],
      before: { loose: 7000, packed: 0, packs: 0 },
      after: { loose: 0, packed: 7000, packs: 1 },
      packed: true,
      threshold: LOOSE_OBJECT_LIMIT,
    });

    expect(lines).toEqual(["git: packed 7000 loose objects (now 0 loose in 1 pack)"]);
  });
});

describe("maintenance never blocks a server start", () => {
  it("reports a git failure as a warning instead of throwing", async () => {
    const failing: GitRunner = () => Promise.reject(new Error("git exploded"));

    const result = await maintainOrWarn({ dir: "/nowhere", git: failing });

    expect(result.outcome).toBeNull();
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^warning: maintaining the workspace repository failed/);
  });

  it("passes the ordinary outcome through untouched", async () => {
    const root = await makeRepository();

    const result = await maintainOrWarn({ dir: root });

    expect(result.outcome?.settings).toEqual(["maintenance.auto", "gc.auto"]);
    expect(result.lines[0]).toContain("background maintenance");
  });
});

describe("the settings match the server's", () => {
  it("carries exactly the two keys, in the order the server writes them", () => {
    // `apps/server/src/git/maintenance.ts` applies the same pair to its test
    // fixtures; two spellings of "how a corpus repository is configured" is how
    // the CLI and the server end up disagreeing about a workspace.
    expect(MAINTENANCE_SETTINGS).toEqual([
      ["maintenance.auto", "false"],
      ["gc.auto", "0"],
    ]);
  });

  it("packs at git's own gc.auto default rather than a number of our own", () => {
    expect(LOOSE_OBJECT_LIMIT).toBe(6700);
  });
});
