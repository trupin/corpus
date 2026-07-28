import { QueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { CorpusProvider } from "../client/CorpusProvider.js";
import { createCorpusClient, type CorpusClient } from "../client/createCorpusClient.js";
import type { BridgeLogger } from "../events/sseBridge.js";
import { fakeEventSourceFactory, type RecordingEventSourceFactory } from "./fakeEventSource.js";

/**
 * A mounted kit data layer with no real network and no real `EventSource` —
 * what a plugin (or `apps/ui`) needs to render a kit hook in a test.
 *
 * The `QueryClient` deliberately does **not** use the kit's production defaults:
 * `retry: 1` with a 500 ms delay turns every error-path assertion into a
 * timeout, and the defaults are asserted directly elsewhere.
 */
export interface CorpusTestHarnessOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly queryClient?: QueryClient;
  readonly baseUrl?: string;
  readonly token?: string;
  readonly logger?: BridgeLogger;
  readonly batchWindowMs?: number;
}

export interface CorpusTestHarness {
  readonly client: CorpusClient;
  readonly queryClient: QueryClient;
  /** Records every `EventSource` the provider opened; `latest()` is the live one. */
  readonly eventSource: RecordingEventSourceFactory;
  readonly Wrapper: (props: { readonly children?: ReactNode }) => ReactElement;
}

export function createCorpusTestHarness(options: CorpusTestHarnessOptions = {}): CorpusTestHarness {
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client = createCorpusClient({
    baseUrl: options.baseUrl ?? "http://127.0.0.1:8905",
    token: options.token ?? "test-token",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const eventSource = fakeEventSourceFactory();

  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <CorpusProvider
        client={client}
        queryClient={queryClient}
        eventSourceFactory={eventSource}
        {...(options.logger ? { logger: options.logger } : {})}
        {...(options.batchWindowMs === undefined ? {} : { batchWindowMs: options.batchWindowMs })}
      >
        {children}
      </CorpusProvider>
    );
  }

  return { client, queryClient, eventSource, Wrapper };
}
