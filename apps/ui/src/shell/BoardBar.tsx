import { ChangedMark } from "@corpus/kit";
import { useEffect, useRef, useState, type DragEvent, type ReactElement } from "react";
import { useBoardSurface } from "../board/BoardsProvider";
import type { Board } from "../board/boardDoc";
import { FUNNEL_HINT, GRAPH_HINT } from "../board/kanban";
import { KanbanDialog } from "../board/KanbanDialog";
import { useStrayStages } from "../board/useStrayStages";
import { MenuItems } from "../menu/MenuItems";
import { pathColumnCount, pathsOf } from "../board/strip";
import { useExplorer } from "../explorer/ExplorerProvider";
import { useBoardCommands } from "../keyboard/boardCommands";
import { BoardTabMenuItems } from "../menu/BoardTabMenuItems";
import { useContextMenu } from "../menu/ContextMenuHost";
import { ReflectControl } from "../reflect/ReflectControl";
import { useChangedBoards } from "../reflect/useChangedBoards";
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
 * **The right of the bar is the corpus**, not this board: the Reflect control
 * (UI-153) asks for a reflection over everything and carries the corpus count of
 * what is unreflected, while each tab carries a dot for what *it* holds
 * (SPEC.md §7's rider 9). It sits after `.boardbar-spacer`, so a label growing
 * from `Reflect` to `Reflect · 12 changes since 3h` eats slack and moves no tab.
 *
 * **The showing board's paths** (UI-149, rider 3) sit left of the spacer: the
 * count pill and "close paths", reading the same browser-local strip the board
 * renders.
 *
 * **The explorer toggle** (`⌘B`, UI-150) sits left of the tabs, where
 * `design/navigation.html` draws it: the panel it opens is column zero, a
 * sibling of the board, so its switch belongs on the board's own bar rather
 * than in the top bar with the corpus-wide controls.
 */

/** The full sentence behind the hint, including the way out of the graph. */
const KANBAN_HINT_TITLE = (field: string): string =>
  `This board's columns are its stages. A drag follows a transition and nothing else; ` +
  `anything else is done by setting ${field} in the document, from the reader or the CLI.`;

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
  /**
   * This board holds at least one document changed since the agent last looked
   * (SPEC.md §7's rider 9). Derived from rows already loaded — see
   * {@link useChangedBoards} — so `false` means "nothing known", never "nothing
   * there".
   */
  readonly isChanged: boolean;
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
  isChanged,
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
        {/*
         * §7's mark: this board holds something the agent has not looked at.
         * A dot and no number — the number is the corpus's, and it is one
         * control away on the same bar.
         *
         * **The slot is reserved on every tab, and painted only when there is
         * something to say** — the same arrangement `.row::before` uses for the
         * staleness rail. Rendering the mark conditionally into the flow made
         * the tab 14px wider while it was there, so a reflection landing shifted
         * every tab after it: §10's "nothing resizes because of what it holds",
         * measured (`reflect.spec.ts`).
         */}
        <span className="board-tab-mark">{isChanged ? <ChangedMark /> : null}</span>
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
  /** The kanban creation form, open only after `＋ → Kanban…` was chosen. */
  const [newKanban, setNewKanban] = useState(false);
  const { boards, current } = surface;
  /*
   * The pill reads the same strip the board renders, through the bound slice;
   * the close act goes through the board's command surface so the button and
   * `⇧esc` are one implementation (rider 3's "one act").
   */
  const commands = useBoardCommands();
  const explorer = useExplorer();
  const pathCount = pathsOf(surface.local.strip).length;
  const colCount = pathColumnCount(surface.local.strip);
  const changed = useChangedBoards(boards);
  /** Documents in the showing kanban's scope that none of its columns show. */
  const strays = useStrayStages(current);

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

  /**
   * `＋` (SPEC.md §10, rider 6): the two kinds of board there are.
   *
   * An **empty board** is created straight away and named in place, exactly as
   * it was before this menu — it has one decision (its title) and the tab is
   * where a title is typed. A **kanban** has four, and none of them has a
   * sensible default that a person could discover afterwards from the bar, so it
   * asks in a form before the document exists.
   */
  const openAddMenu = (clientX: number, clientY: number, autoFocus: boolean): void => {
    menu.open({
      label: "New board",
      clientX,
      clientY,
      autoFocus,
      items: (close) => (
        <MenuItems
          actions={[
            {
              id: "empty-board",
              label: "Empty board",
              meta: "a document you add view columns to",
              run: () => {
                void surface.createBoard();
              },
            },
            {
              id: "kanban-board",
              label: "Kanban…",
              meta: "columns are stages; a drag follows the board’s graph",
              run: () => {
                setNewKanban(true);
              },
            },
          ]}
          onDone={close}
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
      {/*
       * Column zero's switch (SPEC.md §10, rider 1), left of the tabs exactly
       * as `design/navigation.html` draws it. The panel it opens is a sibling
       * of the board, so this is a layout control rather than an overlay
       * trigger — which is why it reports its state with `aria-pressed` rather
       * than `aria-expanded`.
       */}
      <button
        type="button"
        className={`icon-btn explorer-toggle${explorer.open ? " on" : ""}`}
        aria-label="Toggle explorer"
        aria-pressed={explorer.open}
        title="Explorer (⌘B)"
        onClick={explorer.toggle}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M9 4v16" />
        </svg>
      </button>
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
            isChanged={changed.has(board.id)}
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
        aria-haspopup="menu"
        title="New board — a document the agent can write too"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openAddMenu(rect.left, rect.bottom + 4, false);
        }}
      >
        ＋
      </button>
      {/*
       * What a drag on this board does (SPEC.md §10, rider 6). It is the
       * prototype's status line, moved here rather than given a strip of its
       * own: it is one clause about the showing board, and the only board that
       * has anything to say is a kanban.
       */}
      {current?.kanban == null ? null : (
        <span className="board-hint" title={KANBAN_HINT_TITLE(current.kanban.field)}>
          {`kanban over ${current.kanban.field} · ${
            current.kanban.transitions === undefined ? FUNNEL_HINT : GRAPH_HINT
          }${
            strays === null || strays === 0
              ? ""
              : ` · ${String(strays)} document${strays === 1 ? "" : "s"} in scope with a ${
                  current.kanban.field
                } this board does not list`
          }`}
        </span>
      )}
      {/*
       * The showing board's paths (SPEC.md §10, rider 3): the count pill and
       * "close paths", left of the spacer. Browser-local state, so the pill is
       * this browser's account of this board and nothing the corpus records.
       */}
      <span className="paths-pill" data-paths={String(pathCount)}>
        {pathCount === 0 ? (
          "no paths"
        ) : (
          <>
            <b>{pathCount}</b>
            {` path${pathCount === 1 ? "" : "s"} · ${String(colCount)} column${
              colCount === 1 ? "" : "s"
            }`}
          </>
        )}
      </span>
      <button
        type="button"
        className="btn-ghost close-paths"
        title="Close every path on this board (⇧esc)"
        disabled={pathCount === 0}
        onClick={() => {
          commands.closeAllPaths();
        }}
      >
        close paths <kbd>⇧esc</kbd>
      </button>
      <span className="boardbar-spacer" />
      {/* The right of the bar is the corpus, not this board (SPEC.md §7). */}
      <ReflectControl />

      {!newKanban ? null : (
        <KanbanDialog
          mode="create"
          kanban={null}
          onSubmit={(result) => {
            setNewKanban(false);
            void surface.createKanban(result);
          }}
          onClose={() => {
            setNewKanban(false);
          }}
        />
      )}
    </nav>
  );
}
