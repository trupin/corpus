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
  tagChipState,
  tagOptions,
  titleOf,
  TYPE_OPTIONS,
  type TagChipState,
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
  /** A chip with nothing to offer is disabled and says why — never inert. */
  readonly disabled?: boolean;
  /** Hover/`title` explanation; required reading whenever `disabled`. */
  readonly title?: string;
  readonly onClick: () => void;
}

function Chip({
  label,
  active,
  warn = false,
  disabled = false,
  title,
  onClick,
}: ChipProps): ReactElement {
  const className = ["chip", warn ? "warn" : "", active ? "on" : ""]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <button
      type="button"
      className={className}
      aria-pressed={active}
      disabled={disabled}
      // A disabled button is out of the tab order, so the tooltip alone would
      // never reach a screen reader; the reason travels in the accessible name.
      {...(title === undefined ? {} : { title, "aria-label": `${label} — ${title}` })}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** `key: value`, or `key: any` — the chip reads as the parameter it will send. */
function chipLabel(key: string, value: string | null): string {
  return `${key}: ${value ?? "any"}`;
}

/**
 * What the `tag:` chip tells the user about itself, in the two states where it
 * cannot behave like the rest of the row (see {@link tagChipState}).
 *
 * The wording states the consequence, not the cause: nobody outside this repo
 * knows what a `SearchHit` is, and "the vocabulary is a contract question" is a
 * sentence for an issue tracker. `clears` carries a warning as well as an
 * instruction, because a tag dropped here cannot currently be put back.
 */
const TAG_CHIP_TITLES: Record<Exclude<TagChipState, "cycles">, string> = {
  unavailable: "Search results do not carry tags yet, so there is nothing to filter by.",
  clears: "Clears the tag — it cannot be applied again here yet.",
};

export function FilterChips({ query, onChange, tree, hits }: FilterChipsProps): ReactElement {
  const [picker, setPicker] = useState<"references" | "parent" | null>(null);
  const candidates = documentChoices(hits);
  const tag = tagChipState(query.tag);

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
        disabled={tag === "unavailable"}
        {...(tag === "cycles" ? {} : { title: TAG_CHIP_TITLES[tag] })}
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
 * asking for an id (SPEC.md §10). The candidates are the rows already returned —
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
