import { MAX_PAGE_LIMIT, type DocRow, type FolderTree } from "@corpus/contract";
import { useDocs, useTree } from "@corpus/kit";
import { useMemo } from "react";
import { folderChoices } from "../newList";
import { CORE_TYPE_VALUES } from "./grammar";

/**
 * The values the query editor can honestly offer, read off the projection
 * through the endpoints that already exist (SPEC.md §9.2). No route is added
 * here: `GET /api/docs` returns rows carrying `type`, `tags`, `id` and `title`,
 * and `GET /api/tree` returns the folder hierarchy — between them that is every
 * enumerable value the grammar has, and the rest (a search phrase, an instant,
 * a number) has no vocabulary to enumerate.
 *
 * **Types and tags are what the workspace actually contains**, counted rather
 * than guessed, which is the point: a `type=` menu that lists `todo` because
 * documents of that type are on disk teaches the real corpus, while a hardcoded
 * list teaches the one somebody imagined. The core types are appended after the ones
 * in use, marked as such, so an empty workspace is still learnable.
 *
 * **The sample is bounded and says so.** One `GET /api/docs` at the endpoint's
 * maximum page, most-recently-updated first, archived included. A workspace
 * larger than that gets a vocabulary drawn from its live end rather than a
 * second request per keystroke; `CONTRACT-026` (a tag/type aggregate) is the
 * fix that would make it exhaustive, and until it lands this is the honest
 * approximation rather than a fabricated list.
 */

/** One offerable value and the reason it is offered. */
export interface ValueOption {
  readonly value: string;
  /** The dim `.d` column: a count, a title, or where the value came from. */
  readonly detail: string;
}

/** How many rows the vocabulary is drawn from. */
export const VOCABULARY_SAMPLE = MAX_PAGE_LIMIT;

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Most-used first, then alphabetical, so the common answer is the first one. */
function byUseThenName(counts: ReadonlyMap<string, number>, noun: string): readonly ValueOption[] {
  return [...counts.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      leftCount === rightCount ? (leftName < rightName ? -1 : 1) : rightCount - leftCount,
    )
    .map(([value, count]) => ({ value, detail: plural(count, noun) }));
}

/**
 * Document types in use, then the core types that are not.
 *
 * `type` is an open string in the contract precisely so a workspace may hold a
 * type this build does not define (SPEC.md §5), so "in use" is the only source
 * that can know about `todo` — and the core tail is what keeps `template`
 * offerable in a workspace that has never made one.
 */
export function docTypeOptions(rows: readonly DocRow[]): readonly ValueOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  const inUse = byUseThenName(counts, "document");
  const unused = CORE_TYPE_VALUES.filter((type) => !counts.has(type)).map((value) => ({
    value,
    detail: "core type",
  }));
  return [...inUse, ...unused];
}

/** Tags in use. Empty when the workspace has none — there is nothing to invent. */
export function tagOptions(rows: readonly DocRow[]): readonly ValueOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return byUseThenName(counts, "document");
}

/**
 * Folders from `GET /api/tree`, via the new-list picker's own walk — the picker
 * and this menu must offer the same hierarchy, and two walks would be two
 * chances to disagree about which folders exist.
 */
export function folderOptions(tree: FolderTree | undefined): readonly ValueOption[] {
  return folderChoices(tree)
    .map((choice) => ({ value: choice.query["folder"] ?? "", detail: choice.detail }))
    .filter((option) => option.value !== "");
}

/** Documents by title, for `parent=` and `references=`, which take an id (§5). */
export function docIdOptions(rows: readonly DocRow[]): readonly ValueOption[] {
  return rows.map((row) => ({ value: row.id, detail: row.title }));
}

export interface QueryVocabulary {
  readonly docType: readonly ValueOption[];
  readonly tag: readonly ValueOption[];
  readonly folder: readonly ValueOption[];
  readonly docId: readonly ValueOption[];
}

/**
 * The vocabulary, live. Both reads are ordinary cached queries the SSE bridge
 * already invalidates, so a document created a moment ago is completable on the
 * next keystroke — and every open query editor shares the one request, because
 * the filter canonicalises to one cache key.
 */
export function useQueryVocabulary(): QueryVocabulary {
  const docs = useDocs({ limit: VOCABULARY_SAMPLE, includeArchived: true });
  const tree = useTree();
  const rows = docs.data?.items;
  const folders = tree.data;

  return useMemo(() => {
    const items = rows ?? [];
    return {
      docType: docTypeOptions(items),
      tag: tagOptions(items),
      folder: folderOptions(folders),
      docId: docIdOptions(items),
    };
  }, [rows, folders]);
}
