import { useEffect, useRef, useState, type DragEvent, type ReactElement } from "react";
import { useBoardSurface } from "../board/BoardsProvider";
import type { Board } from "../board/boardDoc";
import { BoardTabMenuItems } from "../menu/BoardTabMenuItems";
import { useContextMenu } from "../menu/ContextMenuHost";
import "./BoardBar.css";

/**
 * The board bar (SPEC.md §10, rider 2: "the board bar above the board lists the
 * boards in `order`; its tabs drag to reorder").
 *
 * **Chrome, not content.** Fixed height, `flex: none`, titles truncated in place
 * with the whole of each in its tooltip — a board named "Q3 mortgage
 * refinancing, options and dates" moves nothing on the screen below it (§10:
 * "nothing resizes because of what it holds").
 *
 * **Every act here is an edit to a document.** Creating a board writes a
 * `type: board` file, archiving one flips its status, reordering writes `order`
 * on every board that moved, and the default-open flag is one key the server
 * keeps unique. None of it is board layout state the app holds — which is why
 * the agent can do all of it too, with no API of its own.
 *
 * **What is deliberately not here yet**: the explorer toggle (`⌘B`, UI-150), the
 * paths pill and "close paths" (UI-149), and the Reflect control (UI-153). The
 * prototype draws them in this bar and they arrive with their own issues; a
 * button that did nothing would be a promise the product does not keep.
 */

/** What the bar says when a workspace holds no board documents at all. */
export const NO_BOARDS_LABEL = "No boards — run `corpus upgrade`";

const NO_BOARDS_TITLE =
  "This workspace holds no `type: board` document. `corpus upgrade` reports the migration that " +
  "creates them, as commands to run (SPEC.md §2.4).";

interface TabProps {
  readonly board: Board;
  readonly index: number;
  readonly count: number;
  readonly isCurrent: boolean;
  readonly isDragging: boolean;
  readonly isRenaming: boolean;
  readonly dropSide: "before" | "after" | null;
  readonly onShow: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  /** `null` cancels the rename without writing. */
  readonly onRename: (title: string | null) => void;
  readonly onArchive: () => void;
  readonly onMenu: (clientX: number, clientY: number, autoFocus: boolean) => void;
}

function BoardTab({
  board,
  index,
  count,
  isCurrent,
  isDragging,
  isRenaming,
  dropSide,
  onShow,
  onDragStart,
  onDragEnd,
  onRename,
  onArchive,
  onMenu,
}: TabProps): ReactElement {
  const [draft, setDraft] = useState(board.title);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenaming) return;
    setDraft(board.title);
    field.current?.focus();
    field.current?.select();
  }, [board.title, isRenaming]);

  if (isRenaming) {
    return (
      <input
        ref={field}
        className="board-tab-input"
        aria-label={`Rename ${board.title}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          onRename(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onRename(draft);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onRename(null);
          }
        }}
      />
    );
  }

  const className = [
    "board-tab",
    isCurrent ? "on" : "",
    isDragging ? "dragging" : "",
    dropSide === null ? "" : `drop-${dropSide}`,
  ]
    .filter((part) => part !== "")
    .join(" ");

  /*
   * A `div` carrying two sibling buttons, rather than one button with the `×`
   * inside it. Nesting an interactive element inside a `<button>` is invalid
   * HTML, and the accessible name of the outer control then swallows the inner
   * one's — "Files Archive Files" — so neither could be addressed by name.
   * `draggable` sits on the wrapper, which is also what makes the drag start
   * reliably in Chromium: a drag from a `<button>` does not.
   */
  return (
    <div
      className={className}
      data-board={board.id}
      draggable
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.effectAllowed = "move";
        // Chromium refuses to start a drag with an empty data transfer.
        event.dataTransfer.setData("text/plain", board.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY, false);
      }}
    >
      <button
        type="button"
        className="board-tab-open"
        aria-current={isCurrent ? "true" : undefined}
        // The whole title, for a tab that truncated it (SPEC.md §10's reveal
        // rule), plus the key that reaches it and the fact that it drags.
        title={`${board.title} · ⌘${String(index + 1)} · drag to reorder`}
        onClick={onShow}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left + 8, rect.bottom, true);
        }}
      >
        <span className="board-tab-title">{board.title}</span>
        {board.kanban === null ? null : <span className="tag">kanban</span>}
        {board.defaultOpen ? (
          <span className="tag" title="Receives every open that names no board">
            default
          </span>
        ) : null}
      </button>
      {/*
       * `×` is present only while more than one board shows (SPEC.md §10: "one
       * board is always showing"). The menu keeps Archive at all times, disabled
       * with its reason — an affordance may vanish, an answer may not.
       */}
      {count > 1 ? (
        <button
          type="button"
          className="board-tab-close"
          aria-label={`Archive ${board.title}`}
          title="Archive this board"
          onClick={onArchive}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function BoardBar(): ReactElement {
  const surface = useBoardSurface();
  const menu = useContextMenu();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; side: "before" | "after" } | null>(null);
  /**
   * Which tab is showing its rename field. Held here rather than in the tab,
   * because the menu that starts a rename closes before the field appears.
   */
  const [renaming, setRenaming] = useState<string | null>(null);
  const { boards, current } = surface;

  const openTabMenu = (
    board: Board,
    index: number,
    clientX: number,
    clientY: number,
    autoFocus: boolean,
  ): void => {
    menu.open({
      label: `Board options for ${board.title}`,
      clientX,
      clientY,
      autoFocus,
      items: (close) => (
        <BoardTabMenuItems
          board={board}
          index={index}
          count={boards.length}
          close={close}
          onRename={() => {
            setRenaming(board.id);
          }}
          onMove={(delta) => {
            void surface.moveBoard(index, index + delta);
          }}
          onSetDefault={() => {
            void surface.setDefaultBoard(board);
          }}
          onArchive={() => {
            void surface.archiveBoard(board);
          }}
          onDelete={() => {
            void surface.deleteBoard(board);
          }}
        />
      ),
    });
  };

  const finishDrag = (): void => {
    const moved = dragId;
    const target = dropAt;
    setDragId(null);
    setDropAt(null);
    if (moved === null || target === null) return;
    const from = boards.findIndex((board) => board.id === moved);
    if (from < 0) return;
    /*
     * The index the moved tab lands on, computed against the list **with it
     * removed** — the same arithmetic `reinsert` performs, so "drop after the
     * last tab" is an ordinary position rather than a special case.
     */
    const without = boards.filter((board) => board.id !== moved);
    const at = without.findIndex((board) => board.id === target.id);
    if (at < 0) return;
    const to = target.side === "before" ? at : at + 1;
    void surface.moveBoard(from, Math.min(to, without.length));
  };

  return (
    <nav className="boardbar" aria-label="Boards">
      <div
        className="board-tabs"
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          if (dragId === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const tab = (event.target as HTMLElement).closest<HTMLElement>(".board-tab[data-board]");
          const overId = tab?.dataset["board"];
          if (tab === null || tab === undefined || overId === undefined || overId === dragId) {
            return;
          }
          const rect = tab.getBoundingClientRect();
          const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
          setDropAt((held) =>
            held?.id === overId && held.side === side ? held : { id: overId, side },
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          finishDrag();
        }}
      >
        {boards.map((board, index) => (
          <BoardTab
            key={board.id}
            board={board}
            index={index}
            count={boards.length}
            isCurrent={board.id === current?.id}
            isDragging={dragId === board.id}
            isRenaming={renaming === board.id}
            dropSide={dropAt?.id === board.id ? dropAt.side : null}
            onShow={() => {
              surface.showBoard(board.id);
            }}
            onDragStart={() => {
              setDragId(board.id);
            }}
            onDragEnd={finishDrag}
            onRename={(title) => {
              setRenaming(null);
              if (title !== null) void surface.renameBoard(board, title);
            }}
            onArchive={() => {
              void surface.archiveBoard(board);
            }}
            onMenu={(clientX, clientY, autoFocus) => {
              openTabMenu(board, index, clientX, clientY, autoFocus);
            }}
          />
        ))}

        {boards.length === 0 && !surface.isPending && surface.error === null ? (
          <button type="button" className="board-tab" disabled title={NO_BOARDS_TITLE}>
            <span className="board-tab-title">{NO_BOARDS_LABEL}</span>
          </button>
        ) : null}

        {surface.error === null ? null : (
          <button type="button" className="board-tab" disabled title={surface.error.message}>
            <span className="board-tab-title">Boards could not be loaded</span>
          </button>
        )}
      </div>

      <button
        type="button"
        className="board-add"
        aria-label="New board"
        title="New board — a document the agent can write too"
        onClick={() => {
          void surface.createBoard();
        }}
      >
        ＋
      </button>
      <span className="boardbar-spacer" />
    </nav>
  );
}
