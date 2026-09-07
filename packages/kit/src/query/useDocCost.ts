import type { DocumentCost } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { docCostKey } from "./keys.js";

/**
 * `GET /api/docs/{id}/cost` — one document's cost over time beside its current
 * size (SPEC.md §9.4), the read behind the reader's measurements panel.
 *
 * Caches under {@link docCostKey}, i.e. `["docs", id, "cost"]`, under the
 * `["docs"]` prefix the server emits on every document and thread mutation. The
 * key's own docblock carries the reason and the consequence: telemetry
 * announces nothing of its own (sprint-025 R8), so this entry refreshes on
 * frames that already exist and **the panel is not live to the ledger**.
 *
 * `id` is optional, and an absent one disables the query rather than requesting
 * `""` — the shape {@link useDoc} and {@link useRelatedDocs} already use, so a
 * host with no open document makes no request.
 *
 * **Nothing is derived here, and one thing in particular is not.** The response
 * is returned exactly as the contract types it, `truncated` and `measuringSince`
 * included, because both are claims the server is entitled to make and a
 * consumer is not. A panel that computed `truncated` from `total >
 * buckets.length` would agree with the server today and quietly disagree the
 * day the bound moves, and a panel that inferred *never measured* from an empty
 * `buckets` array would confuse "this document has cost nothing" with "this
 * workspace has measured nothing" — which are different sentences, and the
 * whole reason `measuringSince` is on the wire.
 *
 * No `limit` is passed. The server's default is six months of daily buckets and
 * retention prunes below that, so a caller naming a smaller window would cut a
 * series that was not going to be long, and would then have to say it was
 * truncated when nothing older existed to cut.
 */
export function useDocCost(id: string | undefined): UseQueryResult<DocumentCost, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: docCostKey(id ?? ""),
    queryFn: ({ signal }) => client.docCost(id ?? "", undefined, { signal }),
    enabled: id !== undefined && id !== "",
  });
}
