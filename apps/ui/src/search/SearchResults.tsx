import type { DocRow } from "@corpus/contract";
import { useEffect, useRef, type ReactElement } from "react";
import { CreateRow } from "./CreateRow";
import { groupResults, resultPath, type ResultGroup } from "./results";
import { primarySnippet, Snippet } from "./Snippet";

/**
 * The result list: `.sr-group` headers over `.sr` rows, exactly one of which
 * carries the keyboard cursor.
 *
 * It renders `items` and nothing else — no sort, no filter, no second query.
 * The groups are a partition of the array it was handed, so what is on screen is
 * what `GET /api/docs` returned, in the order the server chose.
 */

export interface SearchResultsProps {
  readonly items: readonly DocRow[];
  /** The create row's label; rendered only when `offersCreate` is true. */
  readonly query: string;
  readonly offersCreate: boolean;
  /** Index into the cursor targets (create row first when offered), or -1. */
  readonly cursor: number;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onOpen: (row: DocRow) => void;
  readonly onCreate: () => void;
}

function ResultRow({
  row,
  isCursor,
  onOpen,
}: {
  readonly row: DocRow;
  readonly isCursor: boolean;
  readonly onOpen: (row: DocRow) => void;
}): ReactElement {
  const snippet = primarySnippet(row.snippets);
  return (
    <button
      type="button"
      className={isCursor ? "sr kbd" : "sr"}
      data-sr={row.id}
      onClick={() => {
        onOpen(row);
      }}
    >
      <div className="sr-title">
        <span className="type-glyph">{row.type}</span>
        {row.title}
      </div>
      {snippet === null ? null : <Snippet snippet={snippet} />}
      <div className="sr-path">{resultPath(row)}</div>
    </button>
  );
}

export function SearchResults({
  items,
  query,
  offersCreate,
  cursor,
  isPending,
  error,
  onOpen,
  onCreate,
}: SearchResultsProps): ReactElement {
  const groups: readonly ResultGroup[] = groupResults(items);
  const list = useRef<HTMLDivElement>(null);

  // The cursor is followed, not scrolled to imperatively on every render: only
  // a change of position moves the list, so hovering or re-rendering never
  // yanks it. jsdom implements no layout and therefore no `scrollIntoView`.
  useEffect(() => {
    if (cursor < 0) return;
    const element = list.current?.querySelector<HTMLElement>(".sr.kbd");
    if (element?.scrollIntoView !== undefined) element.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  let index = offersCreate ? 0 : -1;

  return (
    <div className="search-results" ref={list} role="listbox" aria-label="Search results">
      {offersCreate ? (
        <CreateRow query={query.trim()} isCursor={cursor === 0} onActivate={onCreate} />
      ) : null}

      {error !== null ? (
        <p className="sr-empty" role="alert">
          The search could not be run — {error.message}
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group.key}>
          <div className="sr-group">{group.heading}</div>
          {group.rows.map((row) => {
            index += 1;
            return <ResultRow key={row.id} row={row} isCursor={cursor === index} onOpen={onOpen} />;
          })}
        </div>
      ))}

      {error === null && groups.length === 0 && !offersCreate ? (
        <p className="sr-empty">{isPending ? "Searching…" : "Nothing matches this search yet."}</p>
      ) : null}
    </div>
  );
}
