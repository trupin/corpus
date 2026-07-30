import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { pluginKey } from "./keys.js";

/**
 * A plugin route read with SSE invalidation included (SPEC.md §10,
 * PLUGINS-001).
 *
 * The cache key is `pluginKey(plugin, ...pathSegments)` — byte-identical to
 * what the plugin's server routes broadcast through `broadcastInvalidate`, so
 * when the server announces `["x", "<plugin>", "<path>", …]` on the core SSE
 * stream, this query refetches through the same bridge every core hook uses.
 * No extra machinery: that round trip is the whole live-update contract for
 * plugin columns.
 *
 * The payload is `unknown` on purpose: plugin routes live outside the
 * generated contract, so the plugin owns its wire shape and validates it here
 * with its own schema (Zod at the boundary), exactly as core hooks trust the
 * contract's.
 */
export function usePluginQuery(
  plugin: string,
  path: string,
  options?: { readonly enabled?: boolean },
): UseQueryResult<unknown, Error> {
  const client = useCorpusClient();
  const segments = path.split("/").filter((segment) => segment !== "");
  return useQuery({
    queryKey: pluginKey(plugin, ...segments),
    queryFn: ({ signal }) => client.pluginRequest(plugin, path, { signal }),
    ...(options?.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}
