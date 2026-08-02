import type { SearchHit } from "@corpus/contract";
import { useEffect, useRef, type ReactElement } from "react";
import { CreateRow } from "./CreateRow";
import { groupResults, resultKind, type ResultGroup } from "./results";
import { Snippet } from "./Snippet";

/**
 * The result list: `.sr-group` headers over `.sr` rows, exactly one of which
 * carries the keyboard cursor.
 *
 * It renders `hits` and nothing else — no sort, no filter, no second query. The
 * groups are a partition of the array it was handed, so what is on screen is
 * what `GET /api/search` ranked, in the order the server ranked it.
 *
 * A row is the hit: its title, its one-line snippet, and — on the prototype's
 * mono `.sr-path` line — the **heading path** of the passage that matched. That
 * subtitle is the point of the endpoint change: a result now says *where inside*
 * the document the match sits ("Mortgage options › Rate assumptions"), which is
 * the address an agent or a reader jumps to, rather than where the file lives.
 * The contract guarantees it is never empty — "a passage with no heading above
 * it reports the document's title, so a hit always has an address".
 */

export interface SearchResultsProps {
  readonly hits: readonly SearchHit[];
  /** The create row's label, and the terms the snippets highlight. */
  readonly query: string;
  readonly offersCreate: boolean;
  /** Index into the cursor targets (create row first when offered), or -1. */
  readonly cursor: number;
  readonly isPending: boolean;
  /** True when nothing has been typed: `q` is required, so nothing was asked. */
  readonly isIdle: boolean;
  readonly error: Error | null;
  readonly onOpen: (hit: SearchHit) => void;
  readonly onCreate: () => void;
}

function ResultRow({
  hit,
  query,
  isCursor,
  onOpen,
}: {
  readonly hit: SearchHit;
  readonly query: string;
  readonly isCursor: boolean;
  readonly onOpen: (hit: SearchHit) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={isCursor ? "sr kbd" : "sr"}
      data-sr={hit.id}
      onClick={() => {
        onOpen(hit);
      }}
    >
      <div className="sr-title">
        {/*
         * The prototype's glyph says what kind of thing the row is. A hit knows
         * only what its id says (see `resultKind`), so it says that — `doc` or
         * `thread` — rather than the document type `GET /api/docs` used to
         * carry.
         */}
        <span className="type-glyph">{resultKind(hit)}</span>
        {hit.title}
      </div>
      <Snippet snippet={hit.snippet} query={query} />
      <div className="sr-path">{hit.headingPath}</div>
    </button>
  );
}

export function SearchResults({
  hits,
  query,
  offersCreate,
  cursor,
  isPending,
  isIdle,
  error,
  onOpen,
  onCreate,
}: SearchResultsProps): ReactElement {
  const groups: readonly ResultGroup[] = groupResults(hits);
  const list = useRef<HTMLDivElement>(null);

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
          {group.rows.map((hit) => {
            index += 1;
            return (
              <ResultRow
                key={hit.id}
                hit={hit}
                query={query}
                isCursor={cursor === index}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      ))}

      {error === null && groups.length === 0 && !offersCreate ? (
        <p className="sr-empty">{emptyMessage(isIdle, isPending)}</p>
      ) : null}
    </div>
  );
}

/**
 * Three empty states, and they say different things.
 *
 * An idle overlay has asked nothing: `q` is required by `GET /api/search`, so a
 * panel with chips set but no text has issued no request, and "nothing matches"
 * would be a claim about a search that never ran.
 */
function emptyMessage(isIdle: boolean, isPending: boolean): string {
  if (isIdle) return "Type to search — documents, threads and turns, ranked.";
  return isPending ? "Searching…" : "Nothing matches this search yet.";
}
