import type { WorkspaceVocabulary } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { VOCABULARY_KEY } from "./keys.js";

/**
 * `GET /api/vocabulary` — the tags and invented frontmatter keys this workspace
 * actually uses (SPEC.md §5's **Structured fields**, §9.2).
 *
 * **It is a hint, never a gate.** Nothing the query language accepts depends on
 * a name appearing here: a person may type `extra.customer=acme` for a field no
 * document carries yet, and the column will simply be empty. So a failed read is
 * silence — the menu offers its static entries and the editor works exactly as
 * it did — rather than an error a person has to dismiss before they can finish a
 * query. `retry: false` for the same reason: there is nothing here worth a
 * second request, and a hint that arrives late is a hint that arrives after the
 * person has typed the name themselves.
 *
 * Cached under {@link VOCABULARY_KEY}, a child of the documents key, so the
 * frames the server already sends for `["docs"]` refetch it by prefix and the
 * menu cannot go stale while the corpus moves under it.
 */
export function useVocabulary(): UseQueryResult<WorkspaceVocabulary, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: VOCABULARY_KEY,
    queryFn: ({ signal }) => client.getVocabulary({ signal }),
    retry: false,
  });
}
