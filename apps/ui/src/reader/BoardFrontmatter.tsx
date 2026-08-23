import type { DocFrontmatter } from "@corpus/contract";
import type { ReactElement } from "react";
import { KanbanExplanation, KanbanGraph } from "./KanbanGraph";

/**
 * A board document's frontmatter, shown (`design/navigation.html`'s `fmBlock`,
 * and its one line: *"A board is a document. Edit columns here…"*).
 *
 * **Why the reader shows this at all.** SPEC.md §10 rider 2 makes a board a
 * document and nothing more, and the whole claim of the phase is that the bar
 * follows the file. A person who opens `boards/attention.md` and finds only a
 * markdown body has been told the opposite — the keys that decide what the bar
 * shows would be the one part of the document the document view hides.
 *
 * **It is a rendering, not a form.** The columns, the kanban block and
 * `default-open` are edited from the board bar and the column headers, which is
 * where those gestures live, and by the agent in the file. Adding a second
 * editable surface for the same keys would be two writers on one array — which
 * is exactly the drift `FrontmatterForm` avoids by owning title, tags, status and
 * due alone.
 *
 * The body below it stays the ordinary editable document view: a board may carry
 * prose about itself, and §10's two exceptions are `thread` and `view`.
 */

export const BOARD_TYPE = "board";

export interface BoardFrontmatterProps {
  readonly frontmatter: DocFrontmatter;
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(scalar).join(", ")}]`;
  return String(value);
}

export function BoardFrontmatter({ frontmatter }: BoardFrontmatterProps): ReactElement | null {
  if (frontmatter.type !== BOARD_TYPE) return null;
  const kanban = frontmatter.kanban;
  const columns = frontmatter.columns;

  return (
    <section className="board-fm" aria-label="Board frontmatter">
      {/*
       * The graph first (SPEC.md §10, rider 6: "the board document draws the
       * graph"). Above the keys rather than below them, because it *is* the
       * keys — a person opening a kanban's document is looking for what the
       * board does, and the `transitions` map is the one block that cannot be
       * read at a glance in YAML.
       */}
      {kanban === null ? null : <KanbanGraph kanban={kanban} />}
      <div className="fm-block">
        <span>---</span>
        <span>
          <b>type:</b> board
        </span>
        {frontmatter.order === null ? null : (
          <span>
            <b>order:</b> {frontmatter.order}
          </span>
        )}
        {frontmatter.defaultOpen ? (
          <span>
            <b>default-open:</b> true
          </span>
        ) : null}
        {kanban === null ? null : (
          <>
            <span>
              <b>kanban:</b>
            </span>
            <span>
              {"  "}
              <b>field:</b> {kanban.field}
            </span>
            <span>
              {"  "}
              <b>stages:</b> [{kanban.stages.join(", ")}]
            </span>
            {kanban.transitions === undefined
              ? null
              : Object.entries(kanban.transitions).map(([stage, to]) => (
                  <span key={`t:${stage}`}>
                    {"    "}
                    <b>{stage}:</b> [{to.join(", ")}]
                  </span>
                ))}
            {kanban.status === undefined
              ? null
              : Object.entries(kanban.status).map(([stage, status]) => (
                  <span key={`s:${stage}`}>
                    {"    "}
                    <b>{stage}:</b> {status}
                  </span>
                ))}
          </>
        )}
        {frontmatter.query === null ? null : (
          <>
            <span>
              <b>query:</b>
            </span>
            {Object.entries(frontmatter.query).map(([key, value]) => (
              <span key={`q:${key}`}>
                {"  "}
                <b>{key}:</b> {scalar(value)}
              </span>
            ))}
          </>
        )}
        {kanban !== null ? null : (
          <>
            <span>
              <b>columns:</b>
              {columns === null || columns.length === 0 ? " []" : ""}
            </span>
            {(columns ?? []).map((id, index) => (
              // A board may list the same view twice, so the index is part of
              // the key — the ids alone are not unique.
              <span key={`c:${String(index)}:${id}`}>{`  - ${id}`}</span>
            ))}
          </>
        )}
        <span>---</span>
      </div>
      {kanban === null ? (
        <p className="reader-note">
          A board is a document. Edit <b>columns</b> here, or ask the agent to — the board bar
          follows.
        </p>
      ) : (
        <KanbanExplanation kanban={kanban} />
      )}
    </section>
  );
}
