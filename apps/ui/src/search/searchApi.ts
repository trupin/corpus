import type { SearchParams } from "@corpus/kit";
import type { SearchQuery } from "./searchQuery";

/**
 * The overlay's **second** serializer: one {@link SearchQuery} to
 * `GET /api/search`'s narrower grammar (SPEC.md §9.2, §11).
 *
 * **This module exists so `searchQuery.ts` does not have to change.** That file
 * documents `toApiParams` and `toViewFrontmatter` as *the same map* — the view
 * frontmatter is the wire form of a `GET /api/docs` request, stringified — which
 * is what makes "save as view" literally "write the current search to a
 * document" and what lets `viewDoc.ts` compile a stored query straight back into
 * a column's filter. Repointing that shared function at `/api/search` would
 * silently corrupt every saved view, because ranked retrieval deliberately omits
 * `sort`, `offset` and `pinned` (sprint-022 C11).
 *
 * So the paths **fork here** and only here:
 *
 * - the overlay's interactive, ranked result list → {@link toSearchParams} →
 *   `GET /api/search`;
 * - "save as view", and every column compiled from what it wrote →
 *   `toApiParams` / `toViewFrontmatter` → `GET /api/docs`, byte-identical to
 *   before.
 *
 * That fork is the signed rule, not an implementation detail (SPEC.md §11:
 * "saved views and board columns remain filtered lists served by
 * `GET /api/docs` — relevance ranking is a property of interactive search, not
 * of persisted views").
 *
 * The type system enforces half of it. {@link SearchParams} is built from the
 * contract's `/api/search` parameter type, so `sort`, `offset` and `pinned` are
 * absent **by construction**: a copy-paste from `toApiParams` that kept
 * `sort: "relevance"` is a type error here rather than a parameter the server
 * silently drops.
 */

/**
 * The request the overlay issues, or `undefined` when there is nothing to rank.
 *
 * **`q` is required and an empty one is a `400`** (`SearchQuerySchema`), so a
 * chip set with no text produces no request at all rather than a refused one.
 * That is the honest reading of the endpoint: a ranked list with nothing to rank
 * is not a degraded answer, it is a different endpoint. Filter-only browsing is
 * what a board column is for, and a column is a `GET /api/docs` list.
 *
 * Every other chip is carried through unchanged, which is what makes SPEC.md
 * §11's "same filter chips and archived semantics" true: the filters are spread
 * from the contract's single `docFilterShape` on both endpoints, so `folder`,
 * `needs`, `unread`, `references` and the rest mean exactly what they meant on
 * `GET /api/docs`.
 *
 * **The archived default is still expressed by omission** (sprint-010 Open
 * Conflict 3): no `status` is sent unless the status chip sets one, and the
 * "include archived" chip lifts the server's default exclusion with
 * `includeArchived=true` rather than by naming a status — which would narrow to
 * archived-only, the opposite of what the chip promises.
 */
export function toSearchParams(query: SearchQuery): SearchParams | undefined {
  const q = query.text.trim();
  if (q === "") return undefined;
  return {
    q,
    ...(query.type === null ? {} : { type: query.type }),
    ...(query.tag === null ? {} : { tag: query.tag }),
    ...(query.status === null ? {} : { status: query.status }),
    ...(query.folder === null ? {} : { folder: query.folder }),
    ...(query.since === null ? {} : { since: query.since }),
    ...(query.due === null ? {} : { due: query.due }),
    ...(query.unread ? { unread: true } : {}),
    ...(query.references === null ? {} : { references: query.references }),
    ...(query.agent === null ? {} : { agent: query.agent }),
    ...(query.needs === null ? {} : { needs: query.needs }),
    ...(query.parent === null ? {} : { parent: query.parent }),
    ...(query.includeArchived ? { includeArchived: true } : {}),
  };
}

/**
 * Why ranking is degraded, in the overlay's own words — one short clause per
 * state, sharing one sentence.
 *
 * Deliberately **not** an exhaustive match. The contract's rule is that a
 * consumer tests `!== "current"` and never switches: the individual values exist
 * to let a surface say *why*, and a value this build has never heard of must
 * still read as "degraded" rather than falling through to silence. Hence the
 * lookup with a general clause behind it.
 *
 * An **absent** field is silence, not a note: it means the server makes no
 * claim, which is Retrieval Phase A's normal answer.
 *
 * The wording is the overlay's, not the CLI's. `corpus search` writes a
 * `#`-prefixed line naming the raw state for an agent parsing a transcript; a
 * person reading a search panel wants the consequence first ("you are seeing
 * text ranking") and the cause second, in a sentence with no enum value in it.
 */
export function degradedRankingNote(state: string | undefined): string | null {
  if (state === undefined || state === "current") return null;
  const reason = DEGRADED_REASONS[state] ?? "semantic ranking is unavailable right now";
  return `Ranked on text alone — ${reason}.`;
}

const DEGRADED_REASONS: Readonly<Record<string, string>> = {
  indexing: "the semantic index is still being built",
  stale: "some documents are not in the semantic index yet",
  disabled: "no semantic index is configured for this workspace",
};
