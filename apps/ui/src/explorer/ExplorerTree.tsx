import { useEffect, useRef, useState, type ReactElement } from "react";
import { boundLabel, type TreeRow } from "./treeRows";

/**
 * The tree's rows and its keyboard (SPEC.md §10, rider 1).
 *
 * **One flat list, keyed, updated in place.** A row that survives a re-render
 * keeps its DOM node, which is what stops Chrome dropping a `dblclick` when the
 * `click` before it changed what the row says — the prototype found that, and
 * this issue's Key Implementation Detail names it. React gives it for free as
 * long as the keys are stable, so the keys are derived from the *thing*
 * (`d:<id>`, `f:<path>`) and never from a position.
 *
 * **The board's keys are off inside the tree.** `data-shortcuts="off"` is what
 * `useShortcuts` reads to mean "this surface owns its keyboard", and the tree
 * does: `↑`/`↓` here move the tree's cursor and must not also move a row cursor
 * in a column nobody is looking at. ⌘K and ⌘B survive, because both are declared
 * `allowInInput` — they are chrome, not text.
 */

/** Rows a cursor can land on: the two that represent something. */
function isFocusable(row: TreeRow): boolean {
  return row.kind === "folder" || row.kind === "doc";
}

export interface TreeRowActs {
  /** Plain click, or `↵`. */
  readonly activate: (row: TreeRow) => void;
  /** Double click, or `⌥↵` — "open and keep". */
  readonly keep: (row: TreeRow) => void;
  readonly toggleFolder: (path: string) => void;
  readonly menu: (row: TreeRow, clientX: number, clientY: number, autoFocus: boolean) => void;
}

export interface ExplorerTreeProps {
  readonly rows: readonly TreeRow[];
  readonly acts: TreeRowActs;
  /** The folder whose row is showing its rename field, or `null`. */
  readonly renaming: string | null;
  /** `null` cancels the rename without writing. */
  readonly onRename: (path: string, next: string | null) => void;
}

export function ExplorerTree({ rows, acts, renaming, onRename }: ExplorerTreeProps): ReactElement {
  /** Which row the keyboard is on, by key — never by index, which rows change. */
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  /** Set when a key moved the cursor, so focus follows only a keyboard move. */
  const pendingFocus = useRef<string | null>(null);

  const focusable = rows.filter(isFocusable);
  const activeKey =
    cursor !== null && focusable.some((row) => row.key === cursor)
      ? cursor
      : (focusable[0]?.key ?? null);

  /**
   * Finds a row by its key without a selector.
   *
   * A key is `d:<id>` or `f:<folder/path>`, and a folder path is user data: a
   * quote or a bracket in one would break an attribute selector, and `CSS.escape`
   * is not everywhere (jsdom has no `CSS` at all). Scanning the rows costs
   * nothing at this size and cannot be broken by a folder name.
   */
  const rowElement = (key: string): HTMLElement | null => {
    const nodes = list.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [];
    for (const node of nodes) if (node.dataset["treeRow"] === key) return node;
    return null;
  };

  useEffect(() => {
    const wanted = pendingFocus.current;
    if (wanted === null) return;
    pendingFocus.current = null;
    rowElement(wanted)?.focus();
  });

  const moveTo = (key: string | undefined): void => {
    if (key === undefined) return;
    pendingFocus.current = key;
    setCursor(key);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const at = focusable.findIndex((row) => row.key === activeKey);
    const row = focusable[at];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(focusable[Math.min(at + 1, focusable.length - 1)]?.key);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(focusable[Math.max(at - 1, 0)]?.key);
      return;
    }
    if (row === undefined) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      // A collapsed folder opens; anything else steps into what is already
      // drawn, which for an open folder is its first child.
      if (row.kind === "folder" && row.collapsed) acts.toggleFolder(row.path);
      else moveTo(focusable[Math.min(at + 1, focusable.length - 1)]?.key);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.kind === "folder" && !row.collapsed) {
        acts.toggleFolder(row.path);
        return;
      }
      // Otherwise climb: the nearest folder row above this one that is shallower.
      for (let index = at - 1; index >= 0; index -= 1) {
        const candidate = focusable[index];
        if (candidate !== undefined && candidate.depth < row.depth) {
          moveTo(candidate.key);
          return;
        }
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.altKey) acts.keep(row);
      else acts.activate(row);
      return;
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = rowElement(row.key)?.getBoundingClientRect();
      acts.menu(row, (rect?.left ?? 0) + 8, rect?.bottom ?? 0, true);
    }
  };

  return (
    <div
      ref={list}
      className="tree"
      role="tree"
      aria-label="Corpus"
      // The tree owns its arrows and its `↵`; the board's bindings are not live
      // in here. See the module note.
      data-shortcuts="off"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        if (row.kind === "bound") {
          return (
            <p
              key={row.key}
              className="tree-note tree-bound"
              data-tree-bound={row.folder}
              style={{ "--d": row.depth } as React.CSSProperties}
            >
              {boundLabel(row.shown, row.total)}
            </p>
          );
        }
        if (row.kind === "pending") {
          return (
            <p
              key={row.key}
              className={`tree-note${row.error === null ? "" : " tree-error"}`}
              data-tree-pending={row.folder}
              style={{ "--d": row.depth } as React.CSSProperties}
              role={row.error === null ? undefined : "alert"}
            >
              {row.error ?? "loading…"}
            </p>
          );
        }
        if (row.kind === "folder" && renaming === row.path) {
          return (
            <FolderRename
              key={row.key}
              name={row.name}
              depth={row.depth}
              onDone={(next) => {
                onRename(row.path, next);
              }}
            />
          );
        }
        /*
         * No `key` here. React reads it off a spread but warns that it must be
         * passed directly, and the warning is right: a key is an instruction to
         * the reconciler rather than a prop, and it is what keeps a row's DOM
         * node alive across a re-render (see the docblock above).
         */
        const common = {
          type: "button" as const,
          role: "treeitem",
          "data-tree-row": row.key,
          "aria-level": row.depth + 1,
          tabIndex: row.key === activeKey ? 0 : -1,
          style: { "--d": row.depth } as React.CSSProperties,
          onFocus: () => {
            setCursor(row.key);
          },
          onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            setCursor(row.key);
            acts.menu(row, event.clientX, event.clientY, false);
          },
        };

        if (row.kind === "folder") {
          return (
            <button
              key={row.key}
              {...common}
              className="tr folder"
              data-tree-folder={row.path}
              aria-expanded={!row.collapsed}
              title={`${row.path}/ — ${String(row.count)} document${row.count === 1 ? "" : "s"}`}
              onClick={() => {
                acts.toggleFolder(row.path);
              }}
            >
              <span className="caret" aria-hidden="true">
                {row.collapsed ? "›" : "⌄"}
              </span>
              <span className="name">{row.name}</span>
              <span className="n">{row.count}</span>
            </button>
          );
        }

        const marks = [
          row.archived ? "archived" : null,
          row.isOrigin ? "the explorer’s open path hangs off it" : null,
          row.isOpen ? "open on this board" : null,
        ].filter((part): part is string => part !== null);

        return (
          <button
            key={row.key}
            {...common}
            className={[
              "tr doc",
              row.isOrigin ? "origin" : "",
              row.archived ? "archived" : "",
              row.isCurrentBoard ? "current" : "",
            ]
              .filter((part) => part !== "")
              .join(" ")}
            data-tree-doc={row.id}
            data-tree-type={row.type}
            // The whole title for a row that truncated it (§10's reveal rule),
            // and every mark spelled out — a dot is not a word.
            title={row.title + (marks.length === 0 ? "" : ` — ${marks.join(" · ")}`)}
            onClick={() => {
              acts.activate(row);
            }}
            onDoubleClick={() => {
              acts.keep(row);
            }}
          >
            <span className="caret" aria-hidden="true" />
            <span className="glyph">{row.type}</span>
            <span className="name">{row.title}</span>
            {row.archived ? <span className="tag">archived</span> : null}
            {row.isOpen ? <span className="open-dot" data-open-dot={row.id} /> : null}
          </button>
        );
      })}
    </div>
  );
}

interface FolderRenameProps {
  readonly name: string;
  readonly depth: number;
  readonly onDone: (next: string | null) => void;
}

/**
 * The rename field, on the row itself — the shape the board bar's tab rename
 * already has. A menu cannot hold a text field: it closes on the first click
 * inside it.
 *
 * **The last segment only.** `POST /api/folders/rename` takes two whole paths,
 * and the parent is not the user's to retype: editing `finance/mortgage` here
 * edits `mortgage`, and the caller rebuilds the path. Moving a folder somewhere
 * else entirely is a different act, and it is not offered.
 */
function FolderRename({ name, depth, onDone }: FolderRenameProps): ReactElement {
  const [draft, setDraft] = useState(name);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  return (
    <input
      ref={field}
      className="tree-rename"
      aria-label={`Rename ${name}`}
      style={{ "--d": depth } as React.CSSProperties}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        onDone(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onDone(draft);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone(null);
        }
      }}
    />
  );
}
