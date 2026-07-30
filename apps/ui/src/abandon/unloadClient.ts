import type { CorpusClient } from "@corpus/kit";
import { createUiClient } from "../app/apiClient";

/**
 * The client used when the page itself is going away.
 *
 * A `DELETE` issued from a `pagehide` handler on an ordinary client is racing
 * the browser's own teardown and is routinely cancelled — which would make
 * closing the tab the one exit route the abandon rule (SPEC.md §11) silently
 * failed on. `keepalive: true` is the platform's answer: the request outlives
 * the document that issued it.
 *
 * Built lazily so importing this module has no side effect, and replaceable so
 * a test can observe the request without a transport.
 */
let client: CorpusClient | null = null;

export function unloadClient(): CorpusClient {
  client ??= createUiClient({
    fetch: (input, init) => globalThis.fetch(input, { ...init, keepalive: true }),
  });
  return client;
}

/** Test seam: injects a stand-in, or (`null`) restores the real one. */
export function setUnloadClient(next: CorpusClient | null): void {
  client = next;
}
