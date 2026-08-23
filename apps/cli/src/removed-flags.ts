/**
 * Flags this CLI **used to have**, and what to do instead.
 *
 * A removed flag is a different kind of mistake from a misspelled one, and the
 * generic "unknown flag" answer serves it badly: the caller's spelling is right,
 * the flag simply no longer exists, and the useful reply names the version that
 * took it away and the thing that replaced it. That is worth a line here because
 * the caller most likely to type one is an **agent working from an older skill**
 * — a prompt, a habit, a shell snippet in a document — and it recovers from the
 * message or it does not recover at all.
 *
 * This is deliberately **not** part of the registry. A registry entry drives
 * `--help` and `docs/cli.md`, and a removed flag must appear in neither: it is
 * not part of the surface, it is an epitaph. Removing a flag is still one edit —
 * delete the `FlagSpec`, add a line here.
 *
 * The list is expected to stay short. An entry earns its place while callers may
 * still be carrying the old spelling, and it may be dropped once they cannot.
 */

export interface RemovedFlag {
  /** The release that removed it — a fact about the past, so it is written, not derived. */
  readonly removedIn: string;
  /** One sentence: what replaced it, or why nothing did. */
  readonly reason: string;
  /** Where the caller goes next. */
  readonly hint: string;
}

export const REMOVED_FLAGS: Readonly<Record<string, RemovedFlag>> = {
  /**
   * Rider 2, signed 2026-08-22: a view document is a saved query and nothing
   * more, and what puts a column on a board is the board's own `columns` list.
   * Removed rather than deprecated, by the user's decision the same day — a key
   * nothing reads is not a core key — with `corpus upgrade` naming the migration
   * for a workspace whose files still carry one (SPEC.md §2.4).
   */
  pinned: {
    removedIn: "0.19.0",
    reason: "a board lists its columns",
    hint:
      "A `type: view` document is a saved query and nothing more (SPEC.md §10, rider 2): it " +
      "appears on a board because that board names its id — `corpus doc edit <board-id> " +
      "--columns <id>,<id>` — and `corpus doc list --type board` finds the boards. A workspace " +
      "whose files still carry a `pinned:` key is told what to run by `corpus upgrade`; the " +
      "migration itself is `corpus doc edit <id> --unset pinned`.",
  },
};

/** The sentence a removed flag is refused with, or nothing when the flag is merely unknown. */
export function removedFlagMessage(name: string): string | undefined {
  const removed = REMOVED_FLAGS[name];
  if (removed === undefined) return undefined;
  return `\`--${name}\` was removed in ${removed.removedIn}: ${removed.reason} — see \`corpus upgrade\`.`;
}

export function removedFlagHint(name: string): string | undefined {
  return REMOVED_FLAGS[name]?.hint;
}
