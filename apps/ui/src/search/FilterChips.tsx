import type { FolderTree, SearchHit } from "@corpus/contract";
import { useState, type ReactElement } from "react";
import {
  AGENT_OPTIONS,
  cycle,
  documentChoices,
  DUE_OPTIONS,
  folderOptions,
  sinceInstant,
  sinceLabel,
  SINCE_WINDOWS,
  STATUS_OPTIONS,
  tagOptions,
  titleOf,
  TYPE_OPTIONS,
} from "./filters";
import type { SearchAgent, SearchQuery, SearchStatus } from "./searchQuery";

/**
 * The chip row (`design/index.html`'s `.search-filters`).
 *
 * Each chip owns one query parameter. Clicking one produces a new
 * {@link SearchQuery}, which produces one new request — the chips never touch
 * the result set, and there is no code path here that could.
 */

export interface FilterChipsProps {
  readonly query: SearchQuery;
  readonly onChange: (next: SearchQuery) => void;
  /** `GET /api/tree` — the folder chip's real options. */
  readonly tree: FolderTree | undefined;
  /** The current ranking: the two title pickers' candidates. */
  readonly hits: readonly SearchHit[];
}

interface ChipProps {
  readonly label: string;
  readonly active: boolean;
  readonly warn?: boolean;
  readonly onClick: () => void;
}

function Chip({ label, active, warn = false, onClick }: ChipProps): ReactElement {
  const className = ["chip", warn ? "warn" : "", active ? "on" : ""]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <button type="button" className={className} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
}

/** `key: value`, or `key: any` — the chip reads as the parameter it will send. */
function chipLabel(key: string, value: string | null): string {
  return `${key}: ${value ?? "any"}`;
}

export function FilterChips({ query, onChange, tree, hits }: FilterChipsProps): ReactElement {
  const [picker, setPicker] = useState<"references" | "parent" | null>(null);
  const candidates = documentChoices(hits);

  const set = (change: Partial<SearchQuery>): void => {
    onChange({ ...query, ...change });
  };

  const since = sinceLabel(query.since);

  return (
    <div className="search-filters">
      <Chip
        label={chipLabel("type", query.type)}
        active={query.type !== null}
        onClick={() => {
          set({ type: cycle(TYPE_OPTIONS, query.type) });
        }}
      />
      <Chip
        label={chipLabel("status", query.status)}
        active={query.status !== null}
        onClick={() => {
          set({ status: cycle(STATUS_OPTIONS, query.status) as SearchStatus | null });
        }}
      />
      <Chip
        label={chipLabel("folder", query.folder)}
        active={query.folder !== null}
        onClick={() => {
          set({ folder: cycle(folderOptions(tree), query.folder) });
        }}
      />
      <Chip
        label={chipLabel("tag", query.tag)}
        active={query.tag !== null}
        onClick={() => {
          set({ tag: cycle(tagOptions(), query.tag) });
        }}
      />
      <Chip
        label={chipLabel("due", query.due)}
        active={query.due !== null}
        onClick={() => {
          set({ due: cycle(DUE_OPTIONS, query.due) });
        }}
      />
      <Chip
        label={chipLabel("updated", since)}
        active={query.since !== null}
        onClick={() => {
          const next = cycle([null, ...SINCE_WINDOWS.map((window) => window.label)], since);
          set({ since: next === null ? null : sinceInstant(next) });
        }}
      />
      <Chip
        label="unread"
        active={query.unread}
        onClick={() => {
          set({ unread: !query.unread });
        }}
      />
      <Chip
        label="needs: form"
        active={query.needs === "form"}
        onClick={() => {
          set({ needs: query.needs === "form" ? null : "form" });
        }}
      />
      <Chip
        label={chipLabel("agent", query.agent)}
        active={query.agent !== null}
        onClick={() => {
          set({ agent: cycle(AGENT_OPTIONS, query.agent) as SearchAgent | null });
        }}
      />

      <DocumentChip
        field="references"
        value={titleOf(hits, query.references)}
        open={picker === "references"}
        candidates={candidates}
        onToggle={() => {
          setPicker(picker === "references" ? null : "references");
        }}
        onPick={(id) => {
          setPicker(null);
          set({ references: id });
        }}
      />
      <DocumentChip
        field="parent"
        value={titleOf(hits, query.parent)}
        open={picker === "parent"}
        candidates={candidates}
        onToggle={() => {
          setPicker(picker === "parent" ? null : "parent");
        }}
        onPick={(id) => {
          setPicker(null);
          set({ parent: id });
        }}
      />

      <Chip
        label="include archived"
        warn
        active={query.includeArchived}
        onClick={() => {
          set({ includeArchived: !query.includeArchived });
        }}
      />
    </div>
  );
}

/**
 * `references:` and `parent:` name a document, so they pick a title rather than
 * asking for an id (SPEC.md §11). The candidates are the rows already returned —
 * refining "what references this" from the search in progress — which is also
 * why the picker issues no request.
 */
function DocumentChip({
  field,
  value,
  open,
  candidates,
  onToggle,
  onPick,
}: {
  readonly field: "references" | "parent";
  readonly value: string | null;
  readonly open: boolean;
  readonly candidates: readonly { readonly id: string; readonly title: string }[];
  readonly onToggle: () => void;
  readonly onPick: (id: string | null) => void;
}): ReactElement {
  return (
    <span className="chip-holder">
      <Chip
        label={value === null ? `${field}: …` : `${field}: ${value}`}
        active={value !== null}
        onClick={onToggle}
      />
      {open ? (
        <div className="chip-menu" role="menu" aria-label={`Pick a document for ${field}`}>
          <button
            type="button"
            className="ac-item"
            role="menuitem"
            onClick={() => {
              onPick(null);
            }}
          >
            <span className="k">any document</span>
          </button>
          {candidates.length === 0 ? (
            <p className="ac-item-note">Search first — this picks from the results.</p>
          ) : (
            candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="ac-item"
                role="menuitem"
                data-pick={candidate.id}
                onClick={() => {
                  onPick(candidate.id);
                }}
              >
                <span className="k">{candidate.title}</span>
                <span className="d">{candidate.id}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </span>
  );
}
