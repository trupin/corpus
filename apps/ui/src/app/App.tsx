import { CorpusProvider, type CorpusClient, type EventSourceFactory } from "@corpus/kit";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { devRoutes } from "../dev/devRoutes";
import { Shell } from "../shell/Shell";
import { uiClient } from "./apiClient";
import { appQueryClient } from "./queryClient";

export interface AppProps {
  /** Injectable so tests can run with their own retry/GC policy. */
  readonly client?: QueryClient;
  /** Injectable so tests and harnesses can run against a stubbed transport. */
  readonly corpusClient?: CorpusClient;
  /**
   * Injectable `EventSource`. Absent, the kit uses the global — which exists in
   * a browser and in neither Node nor jsdom.
   */
  readonly eventSourceFactory?: EventSourceFactory;
}

/**
 * The application's **one** `CorpusProvider` (SPEC.md §11 — a single resilient
 * SSE connection). Every provider owns its own `EventSource` and its own cache,
 * so a second one would silently double both; the kit warns when it sees one,
 * and `main.tsx` renders this component exactly once.
 *
 * The router is mounted with a single board route today so later issues can add
 * `/doc/:id`, `/thread/:id` and the search overlay without restructuring the
 * shell. The catch-all renders the board too: an unknown URL is a stale link,
 * and the board is where you go from there — never a blank page.
 */
export function App({ client, corpusClient, eventSourceFactory }: AppProps = {}): ReactElement {
  return (
    <CorpusProvider
      client={corpusClient ?? uiClient}
      queryClient={client ?? appQueryClient}
      {...(eventSourceFactory ? { eventSourceFactory } : {})}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />} />
          {devRoutes()}
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </CorpusProvider>
  );
}
