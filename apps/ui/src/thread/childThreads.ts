import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import type { ThreadTurn } from "@corpus/kit";
import { splitTurnAttachments } from "./attachmentRefs";
import { spanContaining, turnSpans } from "./turnAnchors";

/**
 * Which turn each child thread hangs off (SPEC.md §6's recursion: "commenting on
 * a turn creates a child thread").
 *
 * A child thread's `parent` is the *thread*, and the wire carries no
 * turn-to-thread link — because on disk there is none to carry: the anchor is a
 * text-quote selector into the parent thread's file, exactly as an anchor into a
 * document is. So the association has to be recovered from the anchor.
 *
 * **The server's own resolution decides it, wherever it is available.** The
 * thread document carries its anchors already resolved to character ranges in
 * its body (SPEC.md §6's ladder, run once, server-side); a range that falls
 * inside a turn's bytes belongs to that turn, full stop. Since UI-051 a comment
 * can anchor to a *phrase* rather than to a whole turn, and phrases repeat
 * across a conversation — a reply quoting the question is the ordinary case — so
 * a placement that searched for the quote itself would put the conversation
 * under the first turn that happened to contain those words. That is PR #19's
 * MAJOR, one layer up.
 *
 * The quote search survives as the fallback for the hosts that have only a list
 * row: an expanded chip in a column knows a child's `anchorQuote` and not the
 * parent's body. It is honest about being approximate, and it is what shipped
 * before whole-turn quotes had any competition.
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

/** The thread's own document, when the card has it: the exact placement. */
export interface ChildThreadContext {
  /** The thread's markdown — what its anchors' ranges index into. */
  readonly body: string;
  readonly anchors: readonly ResolvedAnchor[];
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
  context?: ChildThreadContext,
): ChildThreadPlacement {
  const byTurn = new Map<string, DocRow[]>();
  const unanchored: DocRow[] = [];
  const spans = context === undefined ? [] : turnSpans(context.body, turns);

  for (const row of rows) {
    const host = hostTurn(row, turns, spans, context);
    if (host === undefined) {
      unanchored.push(row);
      continue;
    }
    const existing = byTurn.get(host);
    if (existing === undefined) byTurn.set(host, [row]);
    else existing.push(row);
  }

  return { byTurn, unanchored };
}

/** The `ts` of the turn a child belongs under, resolved before it is guessed. */
function hostTurn(
  row: DocRow,
  turns: readonly ThreadTurn[],
  spans: ReturnType<typeof turnSpans>,
  context: ChildThreadContext | undefined,
): string | undefined {
  const anchor = context?.anchors.find((entry) => entry.threadId === row.id);
  if (anchor !== undefined) {
    // The server resolved it or declared it orphaned; either way this is the
    // answer, and falling through to the quote search would overrule it.
    return anchor.range === null ? undefined : spanContaining(spans, anchor.range)?.ts;
  }
  const quote = row.anchorQuote?.trim() ?? "";
  if (quote === "") return undefined;
  return turns.find((turn) => turn.body.includes(quote))?.ts;
}
