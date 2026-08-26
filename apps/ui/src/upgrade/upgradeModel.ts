import type { UpgradeCheck } from "@corpus/contract";

/**
 * What the upgrade panel says, as functions of the server's answer rather than
 * as branches inside JSX (SPEC.md §2.4).
 *
 * The sentences live here so they can be asserted without rendering, and — more
 * to the point — so the **two verdicts stay separate**. `upgradeAvailable` says
 * a newer release exists; `verifiable` says it publishes the checksum the
 * upgrade verifies before installing. A panel that offered "Upgrade & restart"
 * on the first alone would offer an act the upgrade refuses, which is precisely
 * what the contract tells clients not to do.
 */

/** Where the panel is in §2.4's sequence. Only `idle` is reachable twice. */
export type UpgradePhase =
  /** Opened, nothing asked. Corpus never checks unless somebody asks. */
  | "idle"
  | "checking"
  | "checked"
  /** The check could not reach **this server** — distinct from an unreachable GitHub. */
  | "check-failed"
  /** `POST /api/upgrade` is in flight; no process exists yet. */
  | "starting"
  /** A process exists. The server is on its way out and the stream will drop. */
  | "upgrading"
  /** The server came back on a different version. */
  | "done"
  /** The wait ran out with no restart — the upgrade may have declined. */
  | "stalled"
  /** The trigger was refused — an upgrade is already running. */
  | "refused"
  /** The trigger failed outright. */
  | "start-failed";

/**
 * Whether "Upgrade & restart" is offered at all.
 *
 * Both flags, never one. A newer release that publishes no checksum is a real
 * release the upgrade will decline, and offering the button for it would hand a
 * person a refusal instead of an upgrade.
 */
export function canUpgrade(check: UpgradeCheck): boolean {
  return check.upgradeAvailable && check.verifiable;
}

/**
 * One sentence for a check that landed.
 *
 * `detail` is rendered where the server sent one, never parsed: the contract
 * says the wording is the server's and changes with the reason, and every
 * decision this component makes comes from the booleans.
 */
export function checkSentence(check: UpgradeCheck): string {
  if (!check.reachable) {
    return check.detail ?? "The release list could not be read, so there is nothing to compare.";
  }
  if (check.latest === null) {
    return check.detail ?? "This distribution has published no releases yet.";
  }
  if (canUpgrade(check)) {
    return `Corpus ${check.latest} is available. You are running ${check.installed}.`;
  }
  if (check.upgradeAvailable) {
    return (
      `Corpus ${check.latest} exists but cannot be installed automatically: ` +
      "it publishes no checksum, and Corpus does not install bytes it cannot verify. " +
      (check.detail ?? "Install it by hand if it is the one you want.")
    );
  }
  return `Corpus ${check.installed} is the newest release. Nothing to install.`;
}

/**
 * The heading beside the sentence — three words at most, and never a claim the
 * sentence does not also make.
 */
export function checkHeading(check: UpgradeCheck): string {
  if (!check.reachable) return "Could not look";
  if (canUpgrade(check)) return "Update available";
  if (check.upgradeAvailable) return "Update available, not installable";
  return "Up to date";
}

/**
 * What the panel says while the server it was talking to is being replaced.
 *
 * This is the sentence UI-035 exists for. The connection dropping *is* the
 * upgrade proceeding — §2.4 has the UI "ride out the restart with its normal SSE
 * reconnect" — so rendering the shell's ordinary "server unreachable" here would
 * report a fault at the exact moment the thing is working.
 */
export const UPGRADING_SENTENCE =
  "Upgrading. The server is being replaced, so it will be unreachable for a moment — " +
  "this page reconnects on its own.";

/** Where the report goes when the server did not say — the shipped default. */
export const DEFAULT_LOG_PATH = ".corpus/upgrade.log";

/**
 * Said when the wait ran out and the server never went away.
 *
 * It claims nothing about the outcome, because nothing is known: an upgrade
 * that declined after starting looks exactly like one still downloading. What
 * it does is stop saying "the server is being replaced" once that has stopped
 * being a description of anything.
 */
export function stalledSentence(logPath: string): string {
  return (
    "The upgrade was started and this server has not restarted. It may still be running, " +
    `or it may have declined after starting — ${logPath} says which.`
  );
}

/** Said once the server answers again on a version that is not the one we left. */
export function doneSentence(from: string, to: string): string {
  return `Upgraded from ${from} to ${to}. The report is in .corpus/upgrade.log.`;
}

/**
 * Said when the server answers again on the **same** version.
 *
 * Not a success and not a failure: an upgrade can decline for reasons it only
 * discovers after starting — the install method could not be detected, the
 * release stopped being verifiable — and every one of those is written down in
 * the report. Claiming success because the server came back would be a guess,
 * and claiming failure would be another.
 */
export function unchangedSentence(version: string, logPath: string): string {
  return (
    `The server is back on ${version}, the version it was already running. ` +
    `Whether that is because nothing needed installing or because the upgrade declined is in ${logPath}.`
  );
}
