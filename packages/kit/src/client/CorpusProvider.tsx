import type { EventSourceFactory } from "@corpus/contract/client";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, type ReactElement, type ReactNode } from "react";
import { createSseBridge, type BridgeLogger } from "../events/sseBridge.js";
import { PendingTurnStore } from "../query/pendingTurns.js";
import { CorpusContext, type CorpusContextValue } from "./context.js";
import type { CorpusClient } from "./createCorpusClient.js";
import { createCorpusQueryClient } from "./queryClient.js";

/**
 * Mounts the kit's data layer: the client, the shared `QueryClient`, and the
 * one SSE connection.
 *
 * **Exactly one per application.** Each provider owns its own `EventSource`, so
 * two mounted providers are two connections and two caches — legitimate in a
 * test harness or a component gallery, a bug in the app. The constraint cannot
 * be enforced by construction without breaking the harness case, so a second
 * concurrent mount is reported through {@link CorpusProviderProps.logger}
 * (`console` by default). See `packages/kit/README.md`.
 */
export interface CorpusProviderProps {
  readonly client: CorpusClient;
  /** Defaults to a fresh client with the kit's SSE-appropriate query defaults. */
  readonly queryClient?: QueryClient;
  /**
   * Injectable `EventSource` constructor. Tests must pass one: Node gates
   * `EventSource` behind `--experimental-eventsource` and jsdom ships none, so
   * the global is absent everywhere the unit suite runs.
   */
  readonly eventSourceFactory?: EventSourceFactory;
  /** Tuning and logging seams for the reconnect/coalescing behaviour. */
  readonly batchWindowMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly random?: () => number;
  readonly logger?: BridgeLogger;
  readonly children?: ReactNode;
}

let mounted = 0;

/** How many `CorpusProvider`s are mounted right now. One, in an application. */
export function mountedCorpusProviders(): number {
  return mounted;
}

export function CorpusProvider(props: CorpusProviderProps): ReactElement {
  const { client, children } = props;
  const logger: BridgeLogger = props.logger ?? console;
  const queryClient = useMemo(
    () => props.queryClient ?? createCorpusQueryClient(),
    [props.queryClient],
  );

  const value = useMemo<CorpusContextValue>(() => {
    const bridge = createSseBridge({
      client,
      queryClient,
      ...(props.eventSourceFactory ? { eventSourceFactory: props.eventSourceFactory } : {}),
      ...(props.batchWindowMs === undefined ? {} : { batchWindowMs: props.batchWindowMs }),
      ...(props.baseDelayMs === undefined ? {} : { baseDelayMs: props.baseDelayMs }),
      ...(props.maxDelayMs === undefined ? {} : { maxDelayMs: props.maxDelayMs }),
      ...(props.random ? { random: props.random } : {}),
      ...(props.logger ? { logger: props.logger } : {}),
    });
    return { client, bridge, pendingTurns: new PendingTurnStore() };
    // The bridge is a connection, not a render value. It is rebuilt only when
    // the client or the cache it feeds changes; the tuning and logging props are
    // read once, at construction. Depending on them would mean an inline
    // `random={() => …}` reconnected the stream on every render.
  }, [client, queryClient]);

  useEffect(() => {
    mounted += 1;
    if (mounted > 1) {
      logger.warn(
        `[corpus] ${String(mounted)} CorpusProviders are mounted; each owns its own /events ` +
          "connection and cache. An application must mount exactly one.",
      );
    }
    value.bridge.start();
    return () => {
      mounted -= 1;
      value.bridge.stop();
    };
  }, [value, logger]);

  return (
    <QueryClientProvider client={queryClient}>
      <CorpusContext.Provider value={value}>{children}</CorpusContext.Provider>
    </QueryClientProvider>
  );
}
