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
  /**
   * In the manifest, gone from the incoming set → report, leave the copy, drop
   * the entry. This covers a file the tool stopped shipping *and* a file an
   * older tool installed from a source this build no longer has at all: either
   * way the workspace's copy is the user's, so it stays on disk untouched.
   */
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

/** A file's two identities: its bytes, and its bytes minus the ignored keys. */
export interface ContentShas {
  readonly sha256: string;
  /** Sha with `UPGRADE_IGNORED_KEYS` frontmatter lines removed (`ignored-keys.ts`). */
  readonly normalizedSha256: string;
}

export interface UpgradeInput {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  /** Sha the manifest recorded, or `null` for a path the manifest does not know. */
  readonly baseline: string | null;
  /**
   * Normalized sha the manifest recorded, or `null` when it recorded none — a
   * manifest written before CLI-083 holds only raw shas, and the baseline's
   * bytes are gone, so its normalized form is **unrecoverable**. Never guessed:
   * a legacy entry simply compares raw (sprint-024 P4, O2).
   */
  readonly baselineNormalized: string | null;
  /** Sha of the file in the workspace, or `null` when it is not there. */
  readonly workspace: string | null;
  /** Normalized sha of the workspace's copy, `null` exactly when `workspace` is. */
  readonly workspaceNormalized: string | null;
  /** Sha the new tool would install, or `null` when the source no longer has it. */
  readonly incoming: string | null;
  /** Normalized sha of the incoming copy, `null` exactly when `incoming` is. */
  readonly incomingNormalized: string | null;
}

/**
 * Whether two copies are the same document: byte-identical, or — when both
 * normalized identities are known — differing only in ignored frontmatter keys
 * (CLI-083, UI-189). A server-stamped `updated:` or a board-written `width:` is
 * not an edit, so it must not read as one in any cell of the matrix.
 */
function same(
  rawA: string,
  normalizedA: string | null,
  rawB: string,
  normalizedB: string | null,
): boolean {
  if (rawA === rawB) return true;
  return normalizedA !== null && normalizedB !== null && normalizedA === normalizedB;
}

/**
 * The verdict for one path. Exhaustive over (baseline × workspace × incoming),
 * and every branch is one of {@link UPGRADE_ACTIONS}.
 *
 * Every equality runs through {@link same}, so a copy that differs only in
 * ignored keys reads as unchanged on that side. The one asymmetry is the
 * baseline (sprint-024 P4): its bytes are gone and only its recorded shas
 * remain, so a legacy manifest entry — raw sha only — compares raw, and the
 * residual case (upstream changed the file, and the workspace's only delta is
 * ignored keys) honestly reads `keep-modified` there rather than guessing a
 * baseline. Manifests written since CLI-083 record the normalized sha too, and
 * the same case reads `update`.
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
    return same(workspace, input.workspaceNormalized, incoming, input.incomingNormalized)
      ? "current"
      : "keep-modified";
  }

  if (workspace === null) return "restore-candidate";

  if (same(workspace, input.workspaceNormalized, baseline, input.baselineNormalized)) {
    // Untouched here. This is the one cell that writes.
    return same(incoming, input.incomingNormalized, baseline, input.baselineNormalized)
      ? "current"
      : "update";
  }

  // Modified here. Reported only when there was something to upgrade.
  if (same(workspace, input.workspaceNormalized, incoming, input.incomingNormalized)) {
    return "current";
  }
  return same(incoming, input.incomingNormalized, baseline, input.baselineNormalized)
    ? "keep-silent"
    : "keep-modified";
}

export interface UpgradeDecision extends UpgradeInput {
  readonly action: UpgradeAction;
  /**
   * The manifest marked this path **deliberately diverged** (`corpus workspace
   * keep`, CLI-081). The verdict itself is unchanged — kept is a reporting and
   * writing fact, not a comparison fact: the upgrade neither reports nor writes
   * a kept path, and {@link nextManifestFiles} advances its baseline to the
   * incoming copy so an un-keep compares against the current template.
   */
  readonly kept: boolean;
}

/**
 * The whole plan: one decision per path known to the manifest **or** to the
 * current sources, sorted by path so two runs read the same and the manifest a
 * run writes is stable.
 */
export function planUpgrade(
  manifest: readonly ManifestEntry[],
  incoming: readonly IncomingFile[],
  workspaceShas: (path: string) => ContentShas | null,
): readonly UpgradeDecision[] {
  const baselines = new Map(manifest.map((entry) => [entry.path, entry]));
  const sources = new Map(incoming.map((file) => [file.path, file]));
  const paths = [...new Set([...baselines.keys(), ...sources.keys()])].sort();

  return paths.map((path) => {
    const entry = baselines.get(path);
    const disk = workspaceShas(path);
    const source = sources.get(path);
    const input: UpgradeInput = {
      path,
      baseline: entry?.sha256 ?? null,
      // A hand-damaged optional field degrades to the raw comparison rather
      // than comparing a string against whatever it holds.
      baselineNormalized:
        typeof entry?.normalizedSha256 === "string" ? entry.normalizedSha256 : null,
      workspace: disk?.sha256 ?? null,
      workspaceNormalized: disk?.normalizedSha256 ?? null,
      incoming: source?.sha256 ?? null,
      incomingNormalized: source?.normalizedSha256 ?? null,
    };
    return { ...input, action: decide(input), kept: entry?.kept === true };
  });
}

/** One file the current tool would install, hashed both ways. */
export interface IncomingFile extends ContentShas {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  /** Absolute path of the bytes to copy. */
  readonly from: string;
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
 *
 * `written` is what the run **actually** put on disk, not what its verdicts said
 * it would: the two differ in a workspace with no baseline, where `--adopt`
 * records a manifest without applying the plan. Recording an incoming sha for a
 * file nobody installed made the manifest claim a path that is not on disk, and
 * the next run then read that absence as "the user deleted it" (CLI-014). A
 * manifest is a record of what happened, so it takes what happened as its input
 * — and since CLI-083 the input carries **both hashes** of each written file,
 * because an `update` no longer writes the template's exact bytes: it preserves
 * the workspace's ignored keys, so the bytes on disk are the merge, and the
 * manifest records the merge. The normalized sha travels beside the raw one so
 * the next run can still tell "differs only in ignored keys" from "edited".
 *
 * A kept baseline carries its recorded normalized sha forward when it has one,
 * and stays raw-only when it does not — a legacy entry never gains a normalized
 * sha it cannot prove (sprint-024 P4: never guess a baseline).
 *
 * One deliberate exception to "a path with a known baseline keeps it": an entry
 * marked **kept** (CLI-081) advances to the incoming copy's shas instead. Those
 * are the tool's own bytes, never the workspace's, so the safety property
 * holds — the modified file still reads modified — while an un-keep compares
 * against the template as it stands now.
 */
export function nextManifestFiles(
  decisions: readonly UpgradeDecision[],
  written: ReadonlyMap<string, ContentShas>,
): readonly ManifestEntry[] {
  const files: ManifestEntry[] = [];
  for (const decision of decisions) {
    if (decision.action === "retired" || decision.incoming === null) continue;

    // A kept path advances to the **incoming copy's** shas (CLI-081): keeping
    // is not merging, so the file on disk is never written, but the recorded
    // baseline follows the template — an un-keep then compares against the
    // current template rather than the one in force when the file was kept.
    // This never trips the safety property above: the incoming shas are the
    // tool's own bytes, so a modified workspace copy still reads modified.
    if (decision.kept) {
      files.push({
        path: decision.path,
        sha256: decision.incoming,
        ...(decision.incomingNormalized === null
          ? {}
          : { normalizedSha256: decision.incomingNormalized }),
        kept: true,
      });
      continue;
    }

    const wrote = written.get(decision.path);
    if (wrote !== undefined) {
      files.push({ path: decision.path, ...wrote });
      continue;
    }
    if (decision.baseline !== null) {
      files.push({
        path: decision.path,
        sha256: decision.baseline,
        ...(decision.baselineNormalized === null
          ? {}
          : { normalizedSha256: decision.baselineNormalized }),
      });
      continue;
    }
    const adopted = adoptable(decision);
    if (adopted !== null) files.push({ path: decision.path, ...adopted });
  }
  return files;
}

/**
 * A baseline-less path is adopted only when it already *is* the incoming copy —
 * byte-identical, or the same document up to ignored keys. What is recorded is
 * the **workspace copy's** own hashes: those are the bytes on disk, and any
 * ignored-key delta they carry over the incoming copy is exactly the kind of
 * delta the comparison exists to not care about.
 */
function adoptable(decision: UpgradeDecision): ContentShas | null {
  if (decision.workspace === null || decision.workspaceNormalized === null) return null;
  if (decision.incoming === null) return null;
  const matches = same(
    decision.workspace,
    decision.workspaceNormalized,
    decision.incoming,
    decision.incomingNormalized,
  );
  return matches
    ? { sha256: decision.workspace, normalizedSha256: decision.workspaceNormalized }
    : null;
}
