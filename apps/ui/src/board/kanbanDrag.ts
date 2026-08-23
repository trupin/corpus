import {
  DOC_STATUSES,
  type DocFrontmatter,
  type DocRow,
  type DocStatus,
  type Warning,
} from "@corpus/contract";
import { useSetDocArchived, useUpdateDocById, type RowNotice } from "@corpus/kit";
import { useCallback, useRef, useState, type DragEvent } from "react";
import type { Board, KanbanSpec } from "./boardDoc";
import { canMove, refusalMessage } from "./kanban";
import type { BoardColumn, StageColumn } from "./viewDoc";

/**
 * Dragging a row between a kanban's stage columns (SPEC.md §10, rider 6).
 *
 * **The restriction lives here and nowhere else.** §10 is explicit that the
 * server enforces the status map and never the transitions, and SERVER-138
 * accepts a stage off the graph with a `200`. So a refused drop is refused
 * because this module refused it: there is no second gate behind it, and a test
 * that only watches the toast would pass with the restriction removed. What
 * proves it is that nothing reached the wire.
 *
 * **Anything the graph forbids is still done by setting the field**, from the
 * reader's `stage ▾` control or the CLI. The refusal says so, in the prototype's
 * own words ({@link refusalMessage}), because a person who cannot drag a card
 * two columns along needs the other route named rather than discovered.
 *
 * **The UI never computes the coupling.** On a kanban over `stage` the write
 * carries `stage` **alone**; the server writes the status from `kanban.status`
 * and reports it in a `stage_status` warning (SERVER-138). Sending both would be
 * this client re-deriving a rule that has one home.
 */

/** How one column is painted while a row is in flight (`design/navigation.html`). */
export type DropState = "can-drop" | "no-drop" | "drop-over" | "drop-bad";

/** What is in flight: the row, and the stage column it was picked up from. */
export interface RowDrag {
  readonly row: DocRow;
  readonly from: StageColumn;
}

/**
 * The class one stage column carries while a drag is live, or `null`.
 *
 * The source column carries nothing: it is neither a target nor a refusal, and
 * dimming the column a card came from is how a person loses sight of the card.
 */
export function dropStateFor(
  kanban: KanbanSpec,
  drag: RowDrag | null,
  column: StageColumn,
  overColumnId: string | null,
  columnId: string,
): DropState | null {
  if (drag === null) return null;
  if (column.stage === drag.from.stage) return null;
  const allowed = canMove(kanban, drag.from.stage, column.stage);
  if (overColumnId === columnId) return allowed ? "drop-over" : "drop-bad";
  return allowed ? "can-drop" : "no-drop";
}

/**
 * The fields a landed write actually moved, as the toast names them.
 *
 * Read off the **response**, never off what was sent: on a kanban over `stage`
 * the caller asked for one field and the server may have written two, and the
 * whole point of §11's `stage_status` warning is that a caller is told rather
 * than left to read `git log`.
 */
export function changedFieldsMessage(
  title: string,
  before: { readonly stage: string | null; readonly status: string },
  after: DocFrontmatter,
  warnings: readonly Warning[],
): string {
  const moved: string[] = [];
  if (after.stage !== before.stage) moved.push(`stage → ${after.stage ?? "none"}`);
  if (after.status !== before.status) moved.push(`status → ${after.status}`);
  if (moved.length === 0) return `“${title}” — nothing changed; it was already there.`;
  const coupled = warnings.some((warning) => warning.code === "stage_status");
  return (
    `“${title}” — ${moved.join(", ")}. One commit.` +
    (coupled ? " The board’s `kanban.status` map decided the status." : "")
  );
}

/** The status a stage names on a kanban over `status`, or `null` for a file that lies. */
function asStatus(stage: string): DocStatus | null {
  return DOC_STATUSES.find((status) => status === stage) ?? null;
}

export interface KanbanDrag {
  /** True while a row is in flight — the board suppresses its own column drag. */
  readonly dragging: boolean;
  /** The class one column carries right now, or `null`. */
  readonly dropStateOf: (column: BoardColumn) => DropState | null;
  readonly onRowDragStart: (column: BoardColumn, row: DocRow) => void;
  readonly onRowDragEnd: () => void;
  readonly onColumnDragOver: (column: BoardColumn, event: DragEvent<HTMLElement>) => void;
  readonly onColumnDrop: (column: BoardColumn, event: DragEvent<HTMLElement>) => void;
}

export interface KanbanDragOptions {
  readonly board: Board | null;
  readonly notify: (notice: RowNotice) => void;
}

export function useKanbanDrag({ board, notify }: KanbanDragOptions): KanbanDrag {
  const updateDoc = useUpdateDocById();
  const setArchived = useSetDocArchived();
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** Read by the handlers, which must not be rebuilt per pointer move. */
  const dragRef = useRef<RowDrag | null>(null);
  dragRef.current = drag;
  const kanban = board?.kanban ?? null;

  const write = useCallback(
    async (row: DocRow, to: StageColumn) => {
      const before = { stage: row.stage, status: row.status };
      let landed: { doc: { frontmatter: DocFrontmatter }; warnings: readonly Warning[] };

      if (to.field === "stage") {
        // `stage` alone. The coupling is the server's one rule (SERVER-138), and
        // a client that also sent `status` would be a second copy of it.
        landed = await updateDoc.mutateAsync({ id: row.id, changes: { stage: to.stage } });
      } else {
        const status = asStatus(to.stage);
        if (status === null) {
          notify({
            tone: "error",
            message: `“${to.stage}” is not a status — this board’s \`kanban.stages\` names a value \`status\` cannot hold.`,
          });
          return;
        }
        /*
         * The archive door, exactly as UI-020 draws it: only `POST …/archive`
         * and `…/unarchive` move a skill's folder, and `PUT` with a non-archived
         * status on an archived document is refused outright (SERVER-039). So a
         * status kanban's `archived` column is entered and left through those
         * routes rather than through the field.
         *
         * Unarchiving lands on `resolved` (SPEC.md §5), so a graph whose edge
         * runs `archived → open` needs the second write. The linear funnel never
         * draws that edge; a hand-written `transitions` may.
         */
        if (status === "archived") {
          landed = await setArchived.mutateAsync({ id: row.id, archived: true });
        } else if (row.status === "archived") {
          landed = await setArchived.mutateAsync({ id: row.id, archived: false });
          if (landed.doc.frontmatter.status !== status) {
            landed = await updateDoc.mutateAsync({ id: row.id, changes: { status } });
          }
        } else {
          landed = await updateDoc.mutateAsync({ id: row.id, changes: { status } });
        }
      }

      notify({
        tone: "info",
        message: changedFieldsMessage(row.title, before, landed.doc.frontmatter, landed.warnings),
      });
    },
    [notify, setArchived, updateDoc],
  );

  const clear = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
    setOver(null);
  }, []);

  const onRowDragStart = useCallback((column: BoardColumn, row: DocRow) => {
    if (column.stage === null) return;
    const started = { row, from: column.stage };
    dragRef.current = started;
    setDrag(started);
    setOver(null);
  }, []);

  const onColumnDragOver = useCallback(
    (column: BoardColumn, event: DragEvent<HTMLElement>) => {
      const live = dragRef.current;
      if (live === null || column.stage === null || kanban === null) return;
      // Claimed even for a column that will refuse the drop: the refusal has to
      // be *said*, and a target that never preventDefaults gets no `drop` event
      // to say it in — the row would spring back with no account of why.
      event.preventDefault();
      event.dataTransfer.dropEffect = canMove(kanban, live.from.stage, column.stage.stage)
        ? "move"
        : "none";
      setOver((held) => (held === column.id ? held : column.id));
    },
    [kanban],
  );

  const onColumnDrop = useCallback(
    (column: BoardColumn, event: DragEvent<HTMLElement>) => {
      const live = dragRef.current;
      const target = column.stage;
      if (live === null || target === null || kanban === null) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
      const from = live.from.stage;
      const to = target.stage;
      // A drop on the column it came from is not a move and not a refusal.
      if (from === to) return;
      if (!canMove(kanban, from, to)) {
        notify({ tone: "error", message: refusalMessage(kanban, from, to) });
        return;
      }
      void (async () => {
        try {
          await write(live.row, target);
        } catch (cause) {
          notify({ tone: "error", message: `Move failed — ${(cause as Error).message}` });
        }
      })();
    },
    [clear, kanban, notify, write],
  );

  const dropStateOf = useCallback(
    (column: BoardColumn): DropState | null =>
      kanban === null || column.stage === null
        ? null
        : dropStateFor(kanban, drag, column.stage, over, column.id),
    [drag, kanban, over],
  );

  return {
    dragging: drag !== null,
    dropStateOf,
    onRowDragStart,
    onRowDragEnd: clear,
    onColumnDragOver,
    onColumnDrop,
  };
}
