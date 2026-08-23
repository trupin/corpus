import type { Doc, SearchHit } from "@corpus/contract";
import { docKey, useCorpusClient, useTree } from "@corpus/kit";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { docSubject, useOpenInColumn, type OpenSubject } from "../board/openInColumn";
import { INBOX_TARGET, useCreateInColumn } from "../board/useCreateInColumn";
import { useSaveAsView } from "../board/useSaveAsView";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { useToast } from "../shell/Toasts";
import { FilterChips } from "./FilterChips";
import { SearchResults } from "./SearchResults";
import { cursorTargets, groupResults, moveCursor, shouldOfferCreate } from "./results";
import { degradedRankingNote } from "./searchApi";
import { EMPTY_SEARCH_QUERY, type SearchQuery } from "./searchQuery";
import { useSearch } from "./useSearch";
import "./search.css";

/**
 * The search overlay (SPEC.md §10, `design/index.html`'s `#search-overlay`): one
 * query input, a chip row, snippet-highlighted results grouped by type, and a
 * footer legend — over a blurred scrim.
 *
 * Three acts hang off it and all three write to the corpus rather than to the
 * browser: `↵` opens a result in its home column, `⇧↵` and the `save as view`
 * chip pin the current search as a new column (a document), and the create row
 * makes the query into a document in `inbox/`.
 *
 * **The keyboard is handled on the panel, not on the document.** While the
 * overlay is open it owns `↑`, `↓`, `↵`, `⇧↵` and `Escape`, and the board's own
 * shortcuts never see them — the board's `⇧←`/`⇧→` handler already ignores
 * events originating in an input, and everything else here is bound to the
 * panel. The only global listener the overlay needs is the one that *opens* it,
 * and that lives in the shell.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SearchOverlayProps {
  /** Closes the overlay and returns focus to whatever opened it. */
  readonly onClose: () => void;
}

export function SearchOverlay({ onClose }: SearchOverlayProps): ReactElement {
  const [query, setQuery] = useState<SearchQuery>(EMPTY_SEARCH_QUERY);
  const [cursor, setCursor] = useState(-1);

  const results = useSearch(query);
  const tree = useTree();
  const saveAsView = useSaveAsView();
  const createInColumn = useCreateInColumn();
  const board = useOpenInColumn();
  const toast = useToast();
  const client = useCorpusClient();
  const queries = useQueryClient();

  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  /**
   * The overlay takes its place in the one escape chain (UI-005's layers, above
   * focus mode and the readers) so a press that lands *outside* the input still
   * closes search rather than popping a reader behind the scrim. The panel's own
   * handler below is what serves the common case, because the chain deliberately
   * ignores keys aimed at a writing surface and the caret starts in the input.
   */
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Overlay, onEscape: onClose });

  const offersCreate = shouldOfferCreate(results.hits, query.text);
  const targets = cursorTargets(groupResults(results.hits), offersCreate);
  const note = degradedRankingNote(results.semanticIndex);

  // A shrinking result set must not leave the cursor pointing past the end.
  useEffect(() => {
    setCursor((current) => (current >= targets.length ? targets.length - 1 : current));
  }, [targets.length]);

  /**
   * `↵` opens the hit **in its list** — the footer legend's promise, and
   * SPEC.md §10's "clicking a row opens the document _in that column_".
   *
   * Working out which column that is needs the document's folder, type and
   * status (`resolveColumn`), and a ranked hit carries none of the three: it is
   * an address and a line of context, never a row. So the document is read
   * first — through the very cache entry the reader about to open it will use,
   * `["docs", id]`, which makes this the reader's own request moved a moment
   * earlier rather than an extra one. A refused read still opens the document,
   * in the first column, because "nothing happened" is the worst possible answer
   * to `↵`.
   */
  const openRow = useCallback(
    (hit: SearchHit) => {
      onClose();
      void (async () => {
        let subject: OpenSubject | null;
        try {
          const doc = await queries.fetchQuery<Doc>({
            queryKey: docKey(hit.id),
            queryFn: () => client.getDoc(hit.id),
          });
          subject = docSubject({
            path: doc.path,
            type: doc.frontmatter.type,
            status: doc.frontmatter.status,
          });
        } catch {
          subject = null;
        }
        board.open({ docId: hit.id, subject });
      })();
    },
    [board, client, onClose, queries],
  );

  const createFromQuery = useCallback(() => {
    const title = query.text.trim();
    onClose();
    void (async () => {
      try {
        const doc = await createInColumn.createDocument(INBOX_TARGET, title);
        board.open({
          docId: doc.frontmatter.id,
          subject: docSubject({
            path: doc.path,
            type: doc.frontmatter.type,
            status: doc.frontmatter.status,
          }),
          selectTitle: true,
        });
        toast({
          tone: "info",
          message: `Created “${title}” — committed in inbox/; the title is selected.`,
        });
      } catch (cause) {
        toast({ tone: "error", message: `Create failed — ${(cause as Error).message}` });
      }
    })();
  }, [board, createInColumn, onClose, query.text, toast]);

  /**
   * The chip and `⇧↵` are the same call, deliberately: the keyboard shortcut is
   * not allowed to build a different request body from the button.
   */
  const saveView = useCallback(() => {
    void (async () => {
      try {
        const { docId, duplicate } = await saveAsView.save(query);
        onClose();
        board.revealColumn(docId);
        toast({
          tone: "info",
          message: duplicate
            ? "Added — a column on this board already queries exactly this; the new view document was created anyway."
            : "Added — a view document was created for this search and listed last on this board.",
        });
      } catch (cause) {
        // The overlay stays open: there is no column, so there is nothing to
        // return to, and the query the user refined is still worth keeping.
        toast({ tone: "error", message: `Save as view failed — ${(cause as Error).message}` });
      }
    })();
  }, [board, onClose, query, saveAsView, toast]);

  const activate = useCallback(() => {
    const target = targets[cursor < 0 ? 0 : cursor];
    if (target === undefined) return;
    if (target === "create") {
      createFromQuery();
      return;
    }
    const hit = results.hits.find((item) => item.id === target);
    if (hit !== undefined) openRow(hit);
  }, [createFromQuery, cursor, openRow, results.hits, targets]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) =>
        moveCursor(current, event.key === "ArrowDown" ? 1 : -1, targets.length),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) saveView();
      else activate();
      return;
    }
    if (event.key === "Tab") trapFocus(event, panel.current);
  };

  return (
    <div
      className="overlay open"
      onMouseDown={(event) => {
        // The scrim, and only the scrim: a click that began inside the panel and
        // ended on it (a drag-select over the input) must not close anything.
        if (event.target !== event.currentTarget) return;
        // The scrim is not a focus target. Without this the browser's default
        // mousedown handling runs *after* the handler and blurs whatever the
        // close just restored focus to — so `esc` would return focus to the
        // search bar and a scrim click would not, for no reason a user could
        // see.
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <div className="search-input-row">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            aria-label="Search query"
            placeholder="Search corpus — documents, threads, skills…"
            value={query.text}
            onChange={(event) => {
              setCursor(-1);
              setQuery((current) => ({ ...current, text: event.target.value }));
            }}
          />
          <button type="button" className="chip ghost" data-save-view="" onClick={saveView}>
            save as view
          </button>
        </div>

        <FilterChips
          query={query}
          tree={tree.data}
          hits={results.hits}
          onChange={(next) => {
            setCursor(-1);
            setQuery(next);
          }}
        />

        {/*
         * The honest-degrade line (SPEC.md §9.1: "search stays honest meanwhile
         * … a search response says when semantic ranking is not yet caught up").
         * One quiet sentence above the list, present only when the envelope
         * flags a state other than `current` — never a banner, never a spinner,
         * and absent entirely when the server makes no claim.
         */}
        {note === null ? null : (
          <p className="search-note" data-degraded={results.semanticIndex}>
            {note}
          </p>
        )}

        <SearchResults
          hits={results.hits}
          query={query.text}
          offersCreate={offersCreate}
          cursor={cursor}
          isPending={results.isPending || results.isDebouncing}
          isIdle={results.isIdle}
          error={results.error}
          onOpen={openRow}
          onCreate={createFromQuery}
        />

        <div className="search-foot">
          <span className="hint">
            <b>↑↓</b> navigate
          </span>
          <span className="hint">
            <b>↵</b> open in its list
          </span>
          <span className="hint">
            <b>⇧↵</b> new list from search
          </span>
          <span className="right hint">
            <b>@</b> agents · <b>/</b> skills · <b>[[</b> refs
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Tab never leaves the panel: the overlay is `aria-modal`, and a Tab that landed
 * on the board behind a blurred scrim would be focus the user cannot see.
 */
function trapFocus(event: ReactKeyboardEvent, panel: HTMLElement | null): void {
  if (panel === null) return;
  const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
