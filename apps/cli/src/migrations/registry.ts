import type { Actor } from "@corpus/contract";
import { readWorkspaceCorpus, type WorkspaceCorpus } from "./corpus.js";
import { viewsToBoard } from "./views-to-board.js";

/**
 * The **data migration registry** (CLI-061, SPEC.md §2.4 rider 8, signed
 * 2026-08-22).
 *
 * A breaking change to what the tool reads out of a workspace's files leaves
 * every existing workspace written for the version before it. §2.4's answer is
 * neither a silent rewrite nor a deprecation: the upgrade **reports** the
 * migration as the commands that perform it, and the operator — or the agent
 * running the upgrade — runs them. "The upgrade never performs a migration
 * itself" is the whole rule, and it is why this module produces strings and
 * touches nothing.
 *
 * Every later breaking change adds an entry here. That is the rule, not a
 * convention: an entry is a detector over the files plus an instruction writer,
 * both pure, so the cost of honouring §2.4 for the next change is one file and
 * one test rather than a decision about whether to bother.
 *
 * **Why the commands and not a flag.** An agent recovers from a message or it
 * does not recover at all. `corpus doc edit <id> --unset pinned` is something it
 * can run; "your views use a removed key" is something it has to guess at. The
 * commands are printed as the exact argv a person pastes, and every one of them
 * is **re-runnable**: unsetting a key a document does not carry is a no-op that
 * exits 0, so an interrupted migration is finished by pasting the whole block
 * again.
 */

/** What one migration wants done, in the form both the report and `--json` use. */
export interface DetectedMigration {
  /** Stable, kebab-case, never renamed — an agent may branch on it. */
  readonly id: string;
  /** One line: what the tool no longer reads, and what that costs this workspace. */
  readonly statement: string;
  /** The commands that perform it, in order, each runnable as printed. */
  readonly commands: readonly string[];
  /**
   * Commands that tidy up a key nothing reads any more but nothing depends on
   * either. Separate from {@link DetectedMigration.commands} because running
   * them is optional in the literal sense: skipping them leaves the workspace
   * working (SPEC.md §5 — an unrecognised frontmatter key parses and is kept).
   */
  readonly optional: readonly string[];
}

/** Everything a detector may look at. Files and the acting party, and nothing else. */
export interface MigrationContext {
  readonly corpus: WorkspaceCorpus;
  /**
   * Who will run the printed commands — the party that ran the upgrade, since
   * that is who is reading its output. It only decides whether `--from agent`
   * appears: `--from` defaults to `user` (CLI-003), so an agent pasting a block
   * written for a person would attribute the migration's commits to the wrong
   * party in a history whose whole point is that the author is real (SPEC.md §7).
   */
  readonly actor: Actor;
}

/**
 * One entry. `Hit` is whatever the detector found, threaded through to the two
 * writers so neither has to re-derive it — a report whose prose and whose
 * commands disagreed about which documents they mean is worse than no report.
 */
export interface Migration<Hit> {
  readonly id: string;
  /** What is wrong with this workspace's files, or `null` when nothing is. */
  detect(context: MigrationContext): Hit | null;
  statement(hit: Hit, context: MigrationContext): string;
  instruct(hit: Hit, context: MigrationContext): readonly string[];
  /** Optional tidy-up; absent when the entry has none. */
  optional?(hit: Hit, context: MigrationContext): readonly string[];
}

/**
 * A registered entry with its `Hit` type closed over.
 *
 * The registry holds entries with different hit shapes, and a
 * `readonly Migration<unknown>[]` does not typecheck under strict variance —
 * `detect` returns the hit and `instruct` consumes it, so `Hit` is both. Closing
 * it here is what lets the list be a plain array without an `any` in sight.
 */
export interface RegisteredMigration {
  readonly id: string;
  run(context: MigrationContext): DetectedMigration | null;
}

export function defineMigration<Hit>(migration: Migration<Hit>): RegisteredMigration {
  return {
    id: migration.id,
    run(context: MigrationContext): DetectedMigration | null {
      const hit = migration.detect(context);
      if (hit === null) return null;
      return {
        id: migration.id,
        statement: migration.statement(hit, context),
        commands: migration.instruct(hit, context),
        optional: migration.optional?.(hit, context) ?? [],
      };
    },
  };
}

/**
 * Every entry, in the order they are reported. Oldest first: a workspace that
 * skipped two releases has to do them in the order they were introduced.
 */
export const MIGRATIONS: readonly RegisteredMigration[] = [viewsToBoard];

export interface DetectMigrationsOptions {
  readonly root: string;
  /** `dataDir` from the workspace config — `data` in every workspace `corpus init` made. */
  readonly dataDir: string;
  readonly actor: Actor;
  /** Injected by tests that want to drive a detector without a directory tree. */
  readonly corpus?: WorkspaceCorpus;
}

/**
 * Runs the registry over one workspace. Reads files, writes nothing, and never
 * throws for a workspace's sake: an upgrade that failed because a document was
 * malformed would be a worse outcome than an upgrade that reported one migration
 * fewer.
 */
export function detectMigrations(options: DetectMigrationsOptions): readonly DetectedMigration[] {
  const context: MigrationContext = {
    corpus: options.corpus ?? readWorkspaceCorpus(options.root, options.dataDir),
    actor: options.actor,
  };
  const found: DetectedMigration[] = [];
  for (const migration of MIGRATIONS) {
    const detected = migration.run(context);
    if (detected !== null) found.push(detected);
  }
  return found;
}

/**
 * `--from agent`, or nothing. Written once so every entry's commands agree, and
 * so the default case stays short: a person reading `corpus doc edit x --unset
 * pinned` should not have to skip past a flag that changes nothing for them.
 */
export function fromFlag(actor: Actor): string {
  return actor === "user" ? "" : ` --from ${actor}`;
}

/** A title as it has to be typed: quoted, with any quote of its own escaped. */
export function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
