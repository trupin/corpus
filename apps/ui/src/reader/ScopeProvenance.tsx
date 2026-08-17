import { ORCHESTRATOR_LANE } from "@corpus/contract";
import { LaneDot, useResidentLane } from "@corpus/kit";
import type { ReactElement } from "react";

/**
 * **What conversation this document belongs to** — SPEC.md §7's scope, said out
 * loud on the artifact rather than only on the conversation.
 *
 * §7's whole argument for scope is that *"a conversation that produces a draft,
 * and a comment left on that draft, reach the same agent — which is the point:
 * the alternative is a resident that owns the talking and loses the artifacts
 * the talking produced."* That is invisible on the document itself: a draft
 * written out of a designated conversation looks exactly like any other note,
 * and the person commenting on it has no way to know their comment will reach a
 * resident rather than the orchestrator. This line is that fact, and it is the
 * reason it links: the conversation is somewhere you can go.
 *
 * ## Scope is the walk, and this describes the walk
 *
 * It says *what this document is part of*, never *the scope it is in* — §7 makes
 * membership computed by climbing `origin` then `parent`, and nothing carries a
 * marker. So the line is the walk's answer, drawn with the same
 * `useResidentLane` the composer and the pending row use, and it degrades the
 * same way: a chain whose reads have not landed says nothing rather than naming
 * the orchestrator (SHARED-044; CLI-043, AGENT-025 and UI-108 word it the same).
 *
 * ## Four silences
 *
 * Nothing is drawn when the walk cannot say, when it lands on the orchestrator
 * (which is *"belongs to no conversation"*, the ordinary case and not a fact
 * worth a line), when the roster has no row for the lane it named, and when the
 * document **is** the designated root — that conversation wears its own badge in
 * the thread head, and a line under it saying it is part of itself is noise.
 */

export interface ScopeProvenanceProps {
  /** The document open in the reader; a thread document is a document (SPEC.md §6). */
  readonly docId: string;
  /** Opens the conversation this document came out of. */
  readonly onOpenDoc: (docId: string) => void;
}

/** The lead-in, in the app's own voice: what it is part of, not what owns it. */
export const PROVENANCE_LEAD = "part of";

export function ScopeProvenance({ docId, onOpenDoc }: ScopeProvenanceProps): ReactElement | null {
  const { lane, row } = useResidentLane(docId);
  if (lane === undefined || lane === ORCHESTRATOR_LANE || lane === docId) return null;
  if (row === undefined) return null;

  return (
    <div className="scope-provenance" data-provenance-lane={lane}>
      <LaneDot liveness={row.liveness} />
      <span>{PROVENANCE_LEAD}</span>
      <button
        type="button"
        className="provenance-link"
        data-provenance-open={lane}
        onClick={() => {
          onOpenDoc(lane);
        }}
      >
        {row.conversation ?? lane}
      </button>
      <span className="provenance-resident">— {row.name}</span>
    </div>
  );
}
