import type { ReactElement } from "react";
import type { KanbanSpec } from "../board/boardDoc";
import { leadsTo } from "../board/kanban";

/**
 * The transition graph, drawn (`design/navigation.html`'s `graphSVG`, ported).
 *
 * SPEC.md §10 asks for it in one clause — *"each column shows where it leads;
 * the board document draws the graph"* — and the two halves answer different
 * questions. A column's dashed chips say where a card in **this** column may go,
 * which is what a person about to drag one needs. The graph says what the whole
 * board is, which is what a person deciding whether the board is right needs,
 * and it is the only place a backward edge and a dead end are visible at once.
 *
 * **It draws the funnel too.** A board carrying no `transitions` has a graph —
 * the linear funnel — and drawing nothing for it would make the absent key look
 * like an absent rule. {@link leadsTo} is the one function that answers "where
 * does this stage lead", so the picture and the drag can never disagree.
 *
 * Nodes sit in a row in `stages` order, forward edges arc above, backward edges
 * arc below and dashed, and a node the `status` map names is outlined — the
 * three distinctions the prototype draws.
 */

export interface KanbanGraphProps {
  readonly kanban: KanbanSpec;
}

/** The prototype's geometry, named so the arithmetic below reads. */
const NODE_RADIUS = 14;
const HEIGHT = 140;
const BASELINE = 70;
const MIN_WIDTH = 360;
const STEP = 120;

export function KanbanGraph({ kanban }: KanbanGraphProps): ReactElement | null {
  const count = kanban.stages.length;
  if (count === 0) return null;

  const width = Math.max(MIN_WIDTH, count * STEP);
  const step = width / count;
  const centre = (index: number): number => step * index + step / 2;

  const edges: ReactElement[] = [];
  kanban.stages.forEach((stage, from) => {
    for (const target of leadsTo(kanban, stage)) {
      const to = kanban.stages.indexOf(target);
      if (to < 0) continue;
      const forward = to > from;
      const lift = Math.min(44, 14 + Math.abs(to - from) * 10);
      const x1 = centre(from) + (forward ? step / 2 - 12 : -(step / 2 - 12));
      const x2 = centre(to) + (forward ? -(step / 2 - 12) : step / 2 - 12);
      const y = forward ? BASELINE - NODE_RADIUS : BASELINE + NODE_RADIUS;
      const control = forward ? y - lift : y + lift;
      const tip = forward ? -6 : 6;
      const flare = forward ? -4 : 4;
      const notch = forward ? 1 : -1;
      edges.push(
        <g key={`${stage}->${target}`}>
          <path
            className={forward ? "fwd" : "back"}
            d={`M${String(x1)},${String(y)} Q${String((x1 + x2) / 2)},${String(control)} ${String(x2)},${String(y)}`}
          />
          <polygon
            className={forward ? "arrow" : "arrow back"}
            points={`${String(x2)},${String(y)} ${String(x2 + tip)},${String(y + flare)} ${String(x2 + tip)},${String(y + notch)}`}
          />
        </g>,
      );
    }
  });

  return (
    <svg
      className="graph"
      viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
      width={width}
      role="img"
      aria-label={`Stage transitions: ${kanban.stages.join(", ")}`}
    >
      {edges}
      {kanban.stages.map((stage, index) => (
        <g key={stage}>
          <rect
            className={kanban.status?.[stage] === undefined ? "node" : "node mapped"}
            x={centre(index) - step / 2 + 10}
            y={BASELINE - NODE_RADIUS}
            width={step - 20}
            height={NODE_RADIUS * 2}
            rx={7}
          />
          <text x={centre(index)} y={BASELINE + 4} textAnchor="middle">
            {stage}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * The paragraphs under the graph — the prototype's own explanation, which is
 * the only place the two rules a kanban runs on are stated in words: what a drag
 * follows, and what the `status` map does on entry.
 */
export function KanbanExplanation({ kanban }: KanbanGraphProps): ReactElement {
  const mapped = Object.entries(kanban.status ?? {});
  return (
    <div className="doc-body kanban-explanation">
      <p>
        Its columns are its stages, one per value of <b>{kanban.field}</b>.{" "}
        {kanban.transitions === undefined
          ? "No transitions are written, so a drag reaches the next or previous stage only."
          : "A drag follows the transitions drawn above and nothing else."}{" "}
        To go anywhere else, set the field in the document.
      </p>
      {mapped.length === 0 ? null : (
        <p>
          While a document is here, its stage decides its status:{" "}
          {mapped.map(([stage, status], index) => (
            <span key={stage}>
              {index === 0 ? "" : ", "}
              <b>{stage}</b> writes <b>{status}</b>
            </span>
          ))}
          , every other stage writes <b>open</b>. Setting status by hand never moves a stage.
        </p>
      )}
    </div>
  );
}
