import type { DocRow } from "@corpus/contract";
import type { ThreadTurn } from "@corpus/kit";
import { splitTurnAttachments } from "./attachmentRefs";

/**
 * Which turn each child thread hangs off (SPEC.md §6's recursion: "commenting on
 * a turn creates a child thread").
 *
 * A child thread's `parent` is the *thread*, and the wire carries no
 * turn-to-thread link — because on disk there is none to carry: the anchor is a
 * text-quote selector into the parent thread's file, exactly as an anchor into a
 * document is. So the association is recovered the same way the server resolves
 * it, by the quote: a child whose `anchorQuote` appears in a turn belongs under
 * that turn.
 *
 * A child with no quote (a whole-thread comment, or one whose anchor went
 * orphaned) belongs to the conversation rather than to one of its turns and is
 * listed after the last turn — visible rather than silently dropped.
 */

export interface ChildThreadPlacement {
  /** Child threads by the `ts` of the turn they are anchored into. */
  readonly byTurn: ReadonlyMap<string, readonly DocRow[]>;
  /** Children that belong to no single turn. */
  readonly unanchored: readonly DocRow[];
}

/** The text a comment on this turn anchors to: its first line of prose. */
export function turnAnchorText(turn: ThreadTurn): string {
  const { prose } = splitTurnAttachments(turn.body);
  const line = prose
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== "");
  return (line ?? prose.trim()).slice(0, 160);
}

export function placeChildThreads(
  rows: readonly DocRow[],
  turns: readonly ThreadTurn[],
): ChildThreadPlacement {
  const byTurn = new Map<string, DocRow[]>();
  const unanchored: DocRow[] = [];

  for (const row of rows) {
    const quote = row.anchorQuote?.trim() ?? "";
    const host = quote === "" ? undefined : turns.find((turn) => turn.body.includes(quote));
    if (host === undefined) {
      unanchored.push(row);
      continue;
    }
    const existing = byTurn.get(host.ts);
    if (existing === undefined) byTurn.set(host.ts, [row]);
    else existing.push(row);
  }

  return { byTurn, unanchored };
}
