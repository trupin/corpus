/**
 * The rehearsal driver (INFRA-033): for each scenario, for each run,
 * seed → spawn → wait → observe → score. Invoked as `npm run rehearse`.
 *
 * The runner is `claude`, headless, started as an ordinary child process in
 * the seeded workspace. Its prompt is built by {@link runnerPrompt} and
 * carries exactly two facts — the workspace path and the instruction to follow
 * the orchestrate skill installed there. Rule 1 lives or dies in that
 * function, which is why it is exported and asserted against its literal
 * output in `run.test.ts`.
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  corpusCli,
  createWorkspace,
  destroyWorkspace,
  sanitizedEnv,
  seedContext,
  snapshotSeed,
  stopServer,
  waitForCleanTree,
  type RehearsalWorkspace,
} from "./fixture.js";
import { observeDisk, readQueueState, type Observation } from "./observe.js";
import type { RunMeta, RunRecord, Scenario } from "./scenario.js";
import { renderScorecard, scoreScenario, type PassInfo, type ScenarioResult } from "./score.js";
import { SCENARIOS } from "./scenarios/index.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** `CLAUDE_BIN` overrides where the runner binary is found; PATH otherwise. */
export const RUNNER_BIN = process.env.CLAUDE_BIN ?? "claude";

/**
 * An operational constant, not a subject: what the *dispatched* work runs at
 * is chosen by the skill per launch and read back from the corpus's records.
 */
export const RUNNER_MODEL = "sonnet";

/** Runs are agents, not workers: low cap, staggered starts. */
export const MAX_CONCURRENT_RUNS = 3;
export const STAGGER_MS = 15_000;

/** How long queue quiescence must hold before the run is called settled. */
export const QUIESCENCE_HOLD_MS = 20_000;
const QUIESCENCE_POLL_MS = 5_000;
const SIGTERM_GRACE_MS = 15_000;

/**
 * Rule 1. The whole prompt: the workspace path, and the instruction to follow
 * the skill installed there. Nothing else may ever be appended — no scenario
 * name, no expected outcome, no hint of what is read afterwards.
 */
export function runnerPrompt(workspaceRoot: string): string {
  return (
    `You are the agent for the Corpus workspace at ${workspaceRoot}. ` +
    "That workspace is your working directory. " +
    "Follow the orchestrate skill installed in this workspace: " +
    "invoke /orchestrate and run its loop until the session is stopped."
  );
}

/** The full argv after the binary. The prompt rides as one argv entry, never a shell. */
export function runnerArgv(prompt: string): readonly string[] {
  return [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
    "--setting-sources",
    "project",
    "--model",
    RUNNER_MODEL,
  ];
}

interface RunnerHandle {
  readonly pid: number;
  readonly exited: Promise<number | null>;
  kill(): Promise<void>;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function spawnRunner(handle: RehearsalWorkspace): RunnerHandle {
  const child = spawn(RUNNER_BIN, [...runnerArgv(runnerPrompt(handle.workspaceRoot))], {
    cwd: handle.workspaceRoot,
    env: sanitizedEnv(handle.binDir),
    stdio: ["ignore", "pipe", "pipe"],
    // Its own group, so ending the run also ends whatever it spawned.
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
    child.once("error", () => resolveExit(null));
  });
  const pid = child.pid ?? -1;
  return {
    pid,
    exited,
    stdout: () => stdout,
    stderr: () => stderr,
    kill: async () => {
      if (pid <= 0) return;
      const signalGroup = (signal: NodeJS.Signals): void => {
        try {
          process.kill(-pid, signal);
        } catch {
          // Already gone — the exit promise settles either way.
        }
      };
      signalGroup("SIGTERM");
      const term = await Promise.race([
        exited,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), SIGTERM_GRACE_MS)),
      ]);
      if (term === "timeout") {
        signalGroup("SIGKILL");
        await exited;
      }
    },
  };
}

type WaitResult = Pick<RunMeta, "overBudget" | "endedBy">;

/**
 * A run ends on the first of: the queue going quiet (nothing pending, nothing
 * in progress, something settled — held for {@link QUIESCENCE_HOLD_MS}), the
 * scenario's wall-clock budget, or the runner exiting on its own.
 */
async function waitForRunEnd(
  handle: RehearsalWorkspace,
  runner: RunnerHandle,
  budgetMs: number,
): Promise<WaitResult> {
  const deadline = Date.now() + budgetMs;
  let quietSince: number | null = null;
  let exited = false;
  // Fire-and-forget on purpose: the loop below reads the flag each pass, and
  // the promise itself is awaited by `kill` when the run ends any other way.
  void runner.exited.then(() => {
    exited = true;
  });
  for (;;) {
    if (exited) return { overBudget: false, endedBy: "exit" };
    if (Date.now() >= deadline) {
      await runner.kill();
      return { overBudget: true, endedBy: "budget" };
    }
    const queue = await readQueueState(handle.workspaceRoot);
    const pending = queue.byStatus.pending.length;
    const inProgress = queue.byStatus["in-progress"].length;
    const settled =
      queue.byStatus.processed.length +
      queue.byStatus.failed.length +
      queue.byStatus.abandoned.length;
    const quiet = pending === 0 && inProgress === 0 && settled > 0;
    if (quiet) {
      quietSince = quietSince ?? Date.now();
      if (Date.now() - quietSince >= QUIESCENCE_HOLD_MS) {
        await runner.kill();
        return { overBudget: false, endedBy: "quiescence" };
      }
    } else {
      quietSince = null;
    }
    await new Promise((r) => setTimeout(r, QUIESCENCE_POLL_MS));
  }
}

/** The run's last write may still be inside a commit window when it ends. */
const OBSERVE_CLEAN_TREE_WAIT_MS = 60_000;

async function observeRun(handle: RehearsalWorkspace, seedHead: string): Promise<Observation> {
  // The product's own validator needs the server, and so does committing the
  // run's last window. The wait is bounded and non-fatal on purpose: a tree
  // still dirty a minute after the run ended, with the server stopped, is a
  // genuine observation for the scorer, not something to wait away.
  const docCheck = await corpusCli(handle, ["doc", "check", "--json"]);
  await waitForCleanTree(handle.workspaceRoot, OBSERVE_CLEAN_TREE_WAIT_MS);
  await stopServer(handle);
  const disk = await observeDisk(handle.workspaceRoot, seedHead);
  // The base directory is the driver's to read — `observeDisk` knows only the
  // workspace. Sorted so run records diff cleanly.
  const baseDirEntries = [...(await readdir(handle.baseDir))].sort();
  return { docCheck: { code: docCheck.code, stdout: docCheck.stdout }, baseDirEntries, ...disk };
}

async function runOnce(scenario: Scenario, runIndex: number, outDir: string): Promise<RunRecord> {
  const handle = await createWorkspace();
  let runner: RunnerHandle | null = null;
  try {
    const seed = await scenario.seed(seedContext(handle));
    const seedSnapshot = await snapshotSeed(handle);
    const startedAt = new Date();
    runner = spawnRunner(handle);
    const ended = await waitForRunEnd(handle, runner, scenario.budgetMs);
    const endedAt = new Date();
    const observation = await observeRun(handle, seedSnapshot.head);
    const record: RunRecord = {
      scenarioId: scenario.id,
      runIndex,
      seed,
      seedSnapshot,
      observation,
      meta: {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        overBudget: ended.overBudget,
        endedBy: ended.endedBy,
        runnerExitCode: await Promise.race([runner.exited, Promise.resolve(null)]),
      },
    };
    await writeFile(
      join(outDir, `${scenario.id}.run-${String(runIndex + 1)}.json`),
      `${JSON.stringify(
        { ...record, runner: { stdout: runner.stdout(), stderr: runner.stderr() } },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return record;
  } finally {
    if (runner !== null) await runner.kill();
    await stopServer(handle).catch(() => undefined);
    await destroyWorkspace(handle).catch((error: unknown) => {
      console.error(`teardown failed for ${handle.baseDir}:`, error);
    });
  }
}

/** N runs, staggered, at most {@link MAX_CONCURRENT_RUNS} at once. */
export async function runScenario(scenario: Scenario, outDir: string): Promise<ScenarioResult> {
  const records: RunRecord[] = [];
  const errors: unknown[] = [];
  let next = 0;
  const worker = async (slot: number): Promise<void> => {
    await new Promise((r) => setTimeout(r, slot * STAGGER_MS));
    for (;;) {
      const index = next;
      next += 1;
      if (index >= scenario.runs) return;
      try {
        records.push(await runOnce(scenario, index, outDir));
      } catch (error) {
        errors.push(error);
        console.error(`${scenario.id} run ${String(index + 1)} did not complete:`, error);
      }
    }
  };
  const slots = Math.min(MAX_CONCURRENT_RUNS, scenario.runs);
  await Promise.all(Array.from({ length: slots }, (_, slot) => worker(slot)));
  if (records.length === 0 && errors.length > 0) {
    throw new Error(`${scenario.id}: no run completed`, { cause: errors[0] });
  }
  records.sort((a, b) => a.runIndex - b.runIndex);
  return scoreScenario(scenario, records);
}

interface CliArgs {
  readonly scenarioIds: readonly string[];
  readonly release: string | null;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const scenarioIds: string[] = [];
  let release: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--release") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--release needs a value");
      release = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else if (arg !== undefined) {
      scenarioIds.push(arg);
    }
  }
  return { scenarioIds, release };
}

async function passInfo(release: string | null): Promise<PassInfo> {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: REPO_ROOT,
  });
  return {
    release: release ?? `unreleased (tree v${manifest.version})`,
    date: new Date().toISOString(),
    treeVersion: manifest.version,
    treeCommit: stdout.trim(),
    runnerModel: RUNNER_MODEL,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios =
    args.scenarioIds.length === 0
      ? SCENARIOS
      : SCENARIOS.filter((scenario) => args.scenarioIds.includes(scenario.id));
  if (scenarios.length === 0) {
    throw new Error(
      `no scenario matched ${args.scenarioIds.join(", ")} — known: ${SCENARIOS.map((s) => s.id).join(", ")}`,
    );
  }
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outDir = join(REPO_ROOT, "rehearsals", "out", stamp);
  await mkdir(outDir, { recursive: true });

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    console.log(`— ${scenario.id}: ${String(scenario.runs)} run(s), grade ${scenario.grade}`);
    results.push(await runScenario(scenario, outDir));
  }

  const scorecard = renderScorecard(await passInfo(args.release), results);
  const scorecardPath = join(REPO_ROOT, "rehearsals", "scorecard.md");
  await writeFile(scorecardPath, scorecard, "utf8");
  console.log(`\n${scorecard}`);
  console.log(`scorecard: ${scorecardPath}`);
  console.log(`raw run records: ${outDir}`);

  const allPassed = results.every((result) => result.grade === "pass");
  if (!allPassed) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
