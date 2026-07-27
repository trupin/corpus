// The in-process invalidation bus (SPEC.md §2.2 rule 3, §9.1).
//
// Every producer of staleness — the queue's transitions, the watcher's
// out-of-band catch-all, and the document/thread write paths as they land —
// publishes here, and the SSE hub is one subscriber among possible others.
// There is deliberately **one** emitter: a write path that broadcast on its own
// channel would be invisible to anything that later wants to observe
// invalidation (a debug endpoint, a test, a plugin), and the watcher would have
// to round-trip through the filesystem to reach the same clients.
//
// The bus carries keys and nothing else. Attaching data to an invalidation is
// not a payload extension, it is a design change (§2.2 rule 3).

import type { QueryKey } from "@corpus/contract";
import { silentLogger, type Logger } from "../logger.js";
import { dedupeKeys } from "./keys.js";

export type InvalidationListener = (keys: readonly QueryKey[]) => void;

export interface InvalidationBus {
  /** Subscribers currently attached. Exposed so a test can prove none leaked. */
  readonly size: number;
  /**
   * Announces that `keys` went stale. Duplicates within one call are collapsed;
   * an empty set is a no-op, because `InvalidatePayloadSchema` requires at least
   * one key and an empty frame tells a client nothing.
   */
  invalidate(keys: readonly QueryKey[]): void;
  /** Returns an unsubscribe function; calling it twice is harmless. */
  subscribe(listener: InvalidationListener): () => void;
}

export interface InvalidationBusOptions {
  readonly logger?: Logger | undefined;
}

export function createInvalidationBus(options: InvalidationBusOptions = {}): InvalidationBus {
  const logger = options.logger ?? silentLogger;
  const listeners = new Set<InvalidationListener>();

  return {
    get size() {
      return listeners.size;
    },
    invalidate(keys) {
      const unique = dedupeKeys(keys);
      if (unique.length === 0) return;
      // Snapshot: a listener may unsubscribe (or subscribe) while being
      // notified, and mutating the live set mid-iteration would skip a peer.
      for (const listener of [...listeners]) {
        try {
          listener(unique);
        } catch (error) {
          // One broken subscriber must not cost the others their frame. A
          // subscriber that *writes* to a dead socket handles that itself (the
          // SSE hub prunes); reaching here means a genuine bug in a listener.
          logger.error("invalidation listener failed", { error: String(error) });
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
