/**
 * The declarative shape of one rehearsal scenario (INFRA-033), and the run
 * record its scorer reads. INFRA-034 fills `scenarios/` with these.
 *
 * A scenario never talks to the runner: its `seed` builds workspace state
 * through the `corpus` CLI, and its `score` is a pure function over what the
 * observer read back. Nothing here can reach the prompt the spawned agent gets
 * — that is rule 1 enforced by construction, not by discipline.
 */

import type { QueueEventStatus } from "@corpus/contract";
import type { Observation } from "./observe.js";

/** See README.md — the two grades are different tests, not two strictnesses. */
export type Grade = "invariant" | "judgment";

export interface CorpusResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What a scenario's `seed` gets: the workspace, reachable only through the CLI. */
export interface SeedContext {
  readonly workspaceRoot: string;
  /**
   * Run one `corpus` invocation in the workspace. Never throws on a non-zero
   * exit — a seed that expects a refusal asserts on `code` itself.
   */
  corpus(args: readonly string[]): Promise<CorpusResult>;
}

/** What seeding produced: the ids the scorer will need, by name. */
export interface Seed {
  readonly refs: Readonly<Record<string, string>>;
}

/** The workspace as it stood the moment seeding finished. */
export interface SeedSnapshot {
  /** `git rev-parse HEAD` after the seed — the boundary for the authorship invariant. */
  readonly head: string;
  /**
   * The boundary commit's tree hash. The server closes a party's commit window
   * lazily — the next actor's first write amends the window's commit into its
   * "editing session" relabel — so the seed's own `user` commit reappears
   * after the boundary under a new hash. The amend changes no content, which
   * makes this tree the exact fingerprint the scorer uses to recognise it.
   */
  readonly headTree: string;
  /** Event ids per queue status directory at seed time. */
  readonly queue: Readonly<Record<QueueEventStatus, readonly string[]>>;
}

export type RunEnd = "quiescence" | "budget" | "exit";

export interface RunMeta {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  /** True when the wall-clock budget ended the run: recorded, never retried. */
  readonly overBudget: boolean;
  readonly endedBy: RunEnd;
  readonly runnerExitCode: number | null;
}

export interface RunRecord {
  readonly scenarioId: string;
  readonly runIndex: number;
  readonly seed: Seed;
  readonly seedSnapshot: SeedSnapshot;
  readonly observation: Observation;
  readonly meta: RunMeta;
}

export type ScenarioRunScore =
  /** One breach fails the scenario; `findings` empty means the run held. */
  | { readonly kind: "invariant"; readonly findings: readonly string[] }
  /** One sample of a stochastic subject; `label` feeds the distribution. */
  | { readonly kind: "judgment"; readonly pass: boolean; readonly label: string };

export interface Scenario {
  /** File-name id, e.g. `03-one-question-one-answer`. */
  readonly id: string;
  /** The user story, in the product's own terms. */
  readonly story: string;
  /** The issue this is a regression for, or null for an untested spec promise. */
  readonly regressionFor: string | null;
  readonly grade: Grade;
  /** N. Small for invariants (repetition is not what they are for), large for judgments. */
  readonly runs: number;
  /** Judgments only: the minimum k out of `runs` that passes. */
  readonly threshold?: number;
  /** Wall clock per run. Exceeding it records `over-budget`, never a failure. */
  readonly budgetMs: number;
  /** Build the workspace state, through the `corpus` CLI only. */
  seed(ctx: SeedContext): Promise<Seed>;
  /** Pure. Reads the record, asserts nothing about prose or transcripts. */
  score(record: RunRecord): ScenarioRunScore;
}
