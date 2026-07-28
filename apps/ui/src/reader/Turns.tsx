import { MarkdownView, type ThreadTurn } from "@corpus/kit";
import type { ReactElement } from "react";

/**
 * A conversation's turns, rendered read-only (`design/index.html`'s `.turn`).
 *
 * This is the reading half of SPEC.md §11's thread view and nothing else: the
 * composer, the "ask agent" toggle, attachments, live forms and per-turn
 * deletion are UI-008's, and are **absent rather than half-built** — a disabled
 * composer would claim a capability that has not shipped.
 *
 * Turn bodies are markdown and go through the same `MarkdownView` as a document
 * body, so a `[[ref]]` written in a comment is a link there too (SPEC.md §5 puts
 * refs in "any body").
 */

export interface TurnListProps {
  readonly turns: readonly ThreadTurn[];
  readonly onOpenRef: (docId: string) => void;
}

/** `2026-07-19T10:05:00Z` → `Jul 19, 10:05`, the prototype's stamp. */
export function turnStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TurnList({ turns, onOpenRef }: TurnListProps): ReactElement {
  if (turns.length === 0) {
    return <p className="turn-empty">No turns yet.</p>;
  }
  return (
    <>
      {turns.map((turn) => (
        <div className="turn" key={`${turn.author}-${turn.ts}`}>
          <div className="turn-who">
            <span className={turn.author === "agent" ? "who agent" : "who"}>{turn.author}</span>
            <span>{turnStamp(turn.ts)}</span>
          </div>
          <div className="turn-body">
            <MarkdownView
              markdown={turn.body}
              className="doc-body turn-markdown"
              onOpenRef={onOpenRef}
            />
          </div>
        </div>
      ))}
    </>
  );
}
