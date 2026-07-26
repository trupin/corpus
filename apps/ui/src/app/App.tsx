import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "../shell/Shell";
import { appQueryClient } from "./queryClient";

export interface AppProps {
  /** Injectable so tests can run with their own retry/GC policy. */
  readonly client?: QueryClient;
}

/**
 * The router is mounted with a single route today so later issues can add
 * `/doc/:id`, `/thread/:id` and the search overlay without restructuring the
 * shell. The catch-all renders the board too: an unknown URL is a stale link,
 * and the board is where you go from there — never a blank page.
 */
export function App({ client }: AppProps = {}): ReactElement {
  return (
    <QueryClientProvider client={client ?? appQueryClient}>
      {/* Opt into the v7 behaviours now, while there is one route to migrate. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Shell />} />
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
