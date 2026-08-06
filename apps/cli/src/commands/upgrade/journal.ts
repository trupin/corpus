import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { UPGRADE_LOG_RELATIVE_PATH, upgradeLogPath } from "../../paths.js";

/**
 * The upgrade's report, written where it can still be read afterwards
 * (SPEC.md §2.4, CONTRACT-027's `UpgradeStarted.logPath`).
 *
 * An upgrade started from the UI is spawned **detached by the server**, and its
 * last act is stopping and restarting that server. So the connection that asked
 * for it is gone before the answer exists, and stdout belongs to a parent that
 * is being replaced. Everything §2.4 requires the upgrade to report — what was
 * installed, what the template sync updated, what it left alone, and above all
 * which files are in conflict — would have nowhere to land.
 *
 * Hence a file, and hence these three properties:
 *
 * - **Truncated at the start of each run.** The file answers "what did the last
 *   upgrade do", which is the question anyone actually has. An append-only
 *   history would make a client parse for the boundary.
 * - **Written as it goes.** A run that is killed mid-install still leaves
 *   everything up to that point, which is the only forensics available for a
 *   process nobody was watching.
 * - **Ending in one JSON object**, on its own line after a `report:` marker, so
 *   the conflicts §2.4 insists must be legible "without parsing prose" are
 *   legible to a reader of this file too — not only to a caller who passed
 *   `--json`.
 */

/** Marks the last line of a finished run; a client can find the machine-readable half by it. */
export const REPORT_MARKER = "report:";

export interface Journal {
  /** Workspace-relative path, or `null` when there is no workspace to write into. */
  readonly relativePath: string | null;
  /** Absolute path, or `null` as above. */
  readonly path: string | null;
  note(line: string): void;
  finish(report: unknown): void;
}

/** A journal that writes nothing — `--check`, or a run outside any workspace. */
export const silentJournal: Journal = {
  relativePath: null,
  path: null,
  note: () => undefined,
  finish: () => undefined,
};

export interface JournalOptions {
  readonly root: string;
  readonly startedAt: Date;
  readonly from: string;
  readonly to: string;
}

export function openJournal(options: JournalOptions): Journal {
  const path = upgradeLogPath(options.root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `corpus upgrade ${options.from} → ${options.to}\nstarted ${options.startedAt.toISOString()}\n`,
    "utf8",
  );

  return {
    path,
    relativePath: UPGRADE_LOG_RELATIVE_PATH,
    note(line: string): void {
      appendFileSync(path, `${line}\n`, "utf8");
    },
    finish(report: unknown): void {
      appendFileSync(path, `\n${REPORT_MARKER} ${JSON.stringify(report)}\n`, "utf8");
    },
  };
}
