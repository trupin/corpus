import type { FolderTree, SearchHit } from "@corpus/contract";
import { folderChoices } from "../board/newList";
import { resultKind } from "./results";
import type { SearchQuery } from "./searchQuery";

/**
 * The chip row's vocabulary and its arithmetic, apart from its rendering.
 *
 * Every chip is one of the fourteen structured filters `GET /api/search` and
 * `GET /api/docs` share (SPEC.md §9.2 — they are spread from the contract's
 * single `docFilterShape`, which is what makes "the same set, with the same
 * semantics" true by construction). Every click sets exactly one: there is no
 * chip whose effect is applied client-side, and no chip that means two
 * parameters. Cycling rather than popping a menu open is the prototype's shape:
 * the chip *is* the current value, and clicking it moves to the next one, so the
 * row reads as the query it will send.
 */

/** A chip whose click walks a fixed list of values, `null` meaning "any". */
export interface CycleChip {
  /** The `SearchQuery` field this chip owns — also its React key. */
  readonly field: "type" | "status" | "folder" | "tag" | "due" | "since" | "agent";
  /** The prototype's `key: value` prefix. */
  readonly label: string;
  /** `null` first: "any" is where every chip starts and returns to. */
  readonly options: readonly (string | null)[];
  /** How a value reads on the chip; the raw value by default. */
  readonly display?: (value: string) => string;
}

/**
 * `since` is an ISO instant on the wire, so the chip offers windows and computes
 * the instant against the browser's clock at click time. Storing the window
 * rather than the instant would make a saved view mean "since the day I saved
 * it", which is not what "updated this week" says.
 */
export const SINCE_WINDOWS: readonly { readonly label: string; readonly days: number }[] = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

export const TYPE_OPTIONS: readonly (string | null)[] = [
  null,
  "note",
  "thread",
  "view",
  "skill",
  "template",
];
export const STATUS_OPTIONS: readonly (string | null)[] = [null, "open", "resolved", "archived"];
export const DUE_OPTIONS: readonly (string | null)[] = [null, "overdue", "today", "week"];
export const AGENT_OPTIONS: readonly (string | null)[] = [null, "requested", "engaged", "none"];

/** The next value in a cycle; an unknown current value restarts at "any". */
export function cycle(options: readonly (string | null)[], current: string | null): string | null {
  const index = options.indexOf(current);
  if (index === -1) return options[0] ?? null;
  return options[(index + 1) % options.length] ?? null;
}

/** `since` for a window label, as the instant the wire wants. */
export function sinceInstant(label: string, now: Date = new Date()): string | null {
  const window = SINCE_WINDOWS.find((entry) => entry.label === label);
  if (window === undefined) return null;
  return new Date(now.getTime() - window.days * 24 * 60 * 60 * 1000).toISOString();
}

/** Which window an already-set `since` came from, for the chip's label. */
export function sinceLabel(iso: string | null, now: Date = new Date()): string | null {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const days = (now.getTime() - parsed) / (24 * 60 * 60 * 1000);
  let closest = SINCE_WINDOWS[0];
  for (const window of SINCE_WINDOWS) {
    if (closest === undefined || Math.abs(window.days - days) < Math.abs(closest.days - days)) {
      closest = window;
    }
  }
  return closest?.label ?? null;
}

/**
 * Folder options, from `GET /api/tree` — the workspace's real hierarchy.
 *
 * Reuses UI-003's `folderChoices` rather than walking the tree again: the new-list
 * picker and this chip must offer the same folders, and two walks would be two
 * chances to disagree about which ones exist.
 */
export function folderOptions(tree: FolderTree | undefined): readonly (string | null)[] {
  return [null, ...folderChoices(tree).map((choice) => choice.query["folder"] ?? "")].filter(
    (option) => option !== "",
  );
}

/**
 * Tag options, and why there are none to offer any more.
 *
 * They used to be read off the rows on screen: `GET /api/docs` returns document
 * rows, and a row carries its `tags`. `GET /api/search` returns **hits** — id,
 * title, heading path, snippet — and that frugality is the endpoint's whole
 * reason to exist, so there is no tag anywhere in the response to collect.
 *
 * The three alternatives were all worse than an honest gap. A tag-collection
 * route does not exist in the §9.2 grammar and inventing one for a chip is a
 * contract change. Keeping a second `GET /api/docs` request alive purely to
 * stock a dropdown reintroduces exactly the per-query second request the
 * overlay's data path is built to prevent. Guessing a vocabulary is a lie.
 *
 * So the `tag:` chip stays in the row — it still displays a tag set from a
 * restored query, and still clears it — but it can no longer *offer* one. A
 * source for the workspace's tag vocabulary is a contract question, escalated
 * rather than improvised (sprint-022 TEST-1027).
 */
export function tagOptions(): readonly (string | null)[] {
  return [null];
}

/** A document the `references:` / `parent:` pickers can point at. */
export interface DocumentChoice {
  readonly id: string;
  readonly title: string;
}

/**
 * The pickers' candidates: the documents this search already returned.
 *
 * SPEC.md §11 asks for a title picker rather than a typed id, and the honest
 * source for one is the result set the user is looking at — "show me what
 * references *that*" is a refinement of the search in progress. It also means
 * neither picker issues a request of its own, so the overlay's request count
 * stays one per query.
 *
 * Threads are excluded, as before — a thread is not something you reference by
 * id here — using the id-prefix discriminant a hit does carry (`resultKind`).
 */
export function documentChoices(hits: readonly SearchHit[]): readonly DocumentChoice[] {
  return hits
    .filter((hit) => resultKind(hit) === "doc")
    .map((hit) => ({ id: hit.id, title: hit.title }));
}

/** Titles for an id already on screen, so a set chip names a document. */
export function titleOf(hits: readonly SearchHit[], id: string | null): string | null {
  if (id === null) return null;
  return hits.find((hit) => hit.id === id)?.title ?? id;
}

/** Count of chips currently narrowing the search — the "clear" affordance's cue. */
export function activeChipCount(query: SearchQuery): number {
  const fields: readonly (keyof SearchQuery)[] = [
    "type",
    "tag",
    "status",
    "folder",
    "since",
    "due",
    "references",
    "agent",
    "needs",
    "parent",
  ];
  const set = fields.filter((field) => query[field] !== null).length;
  return set + (query.unread ? 1 : 0) + (query.includeArchived ? 1 : 0);
}
