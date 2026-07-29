import type { ManifestEntry } from "./manifest.js";

/**
 * The three-way compare behind `corpus workspace upgrade` (SPEC.md §2.1), as a
 * pure function over hashes.
 *
 * Three facts per path, and the whole verb is what they imply:
 *
 * - **baseline** — the sha the manifest recorded when the file was installed.
 * - **workspace** — the sha of the file as it stands now, or `null` when it was
 *   deleted.
 * - **incoming** — the sha the new tool would install, or `null` when the file
 *   is gone from the template.
 *
 * The rule that matters is the one cell that writes: a file is overwritten
 * **only** when the workspace never touched it (`workspace === baseline`) and the
 * incoming copy differs. Installed skills are workspace-owned documents that the
 * agent evolves; clobbering one is the failure this verb exists to prevent, so
 * every other combination either leaves the file alone or merely reports it.
 *
 * Keeping this a pure function of three strings is deliberate: the interesting
 * part of an upgrade is the decision, and a decision that needs a filesystem to
 * test is a decision nobody exhaustively tests.
 */

export const UPGRADE_ACTIONS = [
  /** Unmodified here, changed upstream → overwrite. The only writing verdict. */
  "update",
  /** Not in the manifest and not on disk → write it for the first time. */
  "install",
  /** Modified here and changed upstream → leave it, and say so. */
  "keep-modified",
  /** Modified here, unchanged upstream → leave it, and say nothing: there is nothing to upgrade. */
  "keep-silent",
  /** Deleted here → report; reinstall only under `--restore`. */
  "restore-candidate",
  /** In the manifest, gone from the template → report, leave the copy, drop the entry. */
  "retired",
  /** Already identical to the incoming copy → nothing to do, nothing to say. */
  "current",
] as const;

export type UpgradeAction = (typeof UPGRADE_ACTIONS)[number];

/** Verdicts a human is told about; the other three are silent by design. */
const REPORTED: ReadonlySet<UpgradeAction> = new Set<UpgradeAction>([
  "update",
  "install",
  "keep-modified",
  "restore-candidate",
  "retired",
]);

export function isReported(action: UpgradeAction): boolean {
  return REPORTED.has(action);
}

/** Verdicts that put bytes on disk — `restore-candidate` only under `--restore`. */
export function writes(action: UpgradeAction, restore: boolean): boolean {
  return action === "update" || action === "install" || (restore && action === "restore-candidate");
}

export interface UpgradeInput {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  /** Sha the manifest recorded, or `null` for a path the manifest does not know. */
  readonly baseline: string | null;
  /** Sha of the file in the workspace, or `null` when it is not there. */
  readonly workspace: string | null;
  /** Sha the new tool would install, or `null` when the source no longer has it. */
  readonly incoming: string | null;
}

/**
 * The verdict for one path. Exhaustive over (baseline × workspace × incoming),
 * and every branch is one of {@link UPGRADE_ACTIONS}.
 */
export function decide(input: UpgradeInput): UpgradeAction {
  const { baseline, workspace, incoming } = input;

  // Gone from the source: the workspace copy may carry the agent's edits, so it
  // stays. Only the manifest entry is dropped.
  if (incoming === null) return "retired";

  // Not in the manifest — either genuinely new upstream, or a file this
  // workspace has that we have no baseline for.
  if (baseline === null) {
    if (workspace === null) return "install";
    // Never overwrite a file we have no baseline for: without one we cannot
    // tell an untouched old copy from an edited one, and guessing wrong
    // destroys work. Identical bytes are simply adopted.
    return workspace === incoming ? "current" : "keep-modified";
  }

  if (workspace === null) return "restore-candidate";

  if (workspace === baseline) {
    // Untouched here. This is the one cell that writes.
    return incoming === baseline ? "current" : "update";
  }

  // Modified here. Reported only when there was something to upgrade.
  if (workspace === incoming) return "current";
  return incoming === baseline ? "keep-silent" : "keep-modified";
}

export interface UpgradeDecision extends UpgradeInput {
  readonly action: UpgradeAction;
  /** Where the incoming bytes come from: `undefined` for the template, `"plugin:<dir>"` otherwise. */
  readonly source?: string;
}

/**
 * The whole plan: one decision per path known to the manifest **or** to the
 * current sources, sorted by path so two runs read the same and the manifest a
 * run writes is stable.
 */
export function planUpgrade(
  manifest: readonly ManifestEntry[],
  incoming: readonly IncomingFile[],
  workspaceSha: (path: string) => string | null,
): readonly UpgradeDecision[] {
  const baselines = new Map(manifest.map((entry) => [entry.path, entry.sha256]));
  const sources = new Map(incoming.map((file) => [file.path, file]));
  const paths = [...new Set([...baselines.keys(), ...sources.keys()])].sort();

  return paths.map((path) => {
    const source = sources.get(path);
    const input: UpgradeInput = {
      path,
      baseline: baselines.get(path) ?? null,
      workspace: workspaceSha(path),
      incoming: source?.sha256 ?? null,
    };
    return {
      ...input,
      action: decide(input),
      ...(source?.source === undefined ? {} : { source: source.source }),
    };
  });
}

/** One file the current tool would install, hashed. */
export interface IncomingFile {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  /** Absolute path of the bytes to copy. */
  readonly from: string;
  readonly sha256: string;
  /** `"plugin:<dir>"` when the bytes come from a plugin; absent for the template. */
  readonly source?: string;
}

/**
 * The manifest an upgrade writes.
 *
 * The recorded sha is always **the baseline** — the bytes the tool installed —
 * never "what the file happens to contain now". That distinction is the whole
 * safety property: adopting a modified file's current sha as its baseline would
 * make it read as unmodified on the next run, and the next template change would
 * then overwrite the very edit this verb refused to touch.
 *
 * So: a path this run wrote records the bytes it wrote; a path with a known
 * baseline keeps it (including a `restore-candidate` nobody restored, so a later
 * `--restore` still knows what it was); a path with no baseline is recorded only
 * when the workspace copy already matches the incoming one, and is otherwise
 * left out — unknown, and reported again next time. `retired` entries are
 * dropped; their files stay.
 */
export function nextManifestFiles(
  decisions: readonly UpgradeDecision[],
  restore: boolean,
): readonly ManifestEntry[] {
  const files: ManifestEntry[] = [];
  for (const decision of decisions) {
    if (decision.action === "retired" || decision.incoming === null) continue;

    const sha = writes(decision.action, restore)
      ? decision.incoming
      : (decision.baseline ?? adoptable(decision));
    if (sha === null) continue;
    files.push({
      path: decision.path,
      sha256: sha,
      ...(decision.source === undefined ? {} : { source: decision.source }),
    });
  }
  return files;
}

/** A baseline-less path is adopted only when it already *is* the incoming copy. */
function adoptable(decision: UpgradeDecision): string | null {
  return decision.workspace !== null && decision.workspace === decision.incoming
    ? decision.workspace
    : null;
}
