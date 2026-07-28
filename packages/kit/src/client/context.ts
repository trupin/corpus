import { createContext, useContext } from "react";
import type { SseBridge } from "../events/sseBridge.js";
import { PendingTurnStore } from "../query/pendingTurns.js";
import type { CorpusClient } from "./createCorpusClient.js";

/**
 * What every kit hook reads. Held on context rather than in a module singleton
 * so a test harness — or a plugin rendered in isolation — can mount its own,
 * and so two providers can never silently share one connection.
 */
export interface CorpusContextValue {
  readonly client: CorpusClient;
  readonly bridge: SseBridge;
  readonly pendingTurns: PendingTurnStore;
}

export const CorpusContext = createContext<CorpusContextValue | undefined>(undefined);

function useCorpusContext(hook: string): CorpusContextValue {
  const value = useContext(CorpusContext);
  if (value === undefined) {
    throw new Error(`${hook} must be rendered inside a <CorpusProvider>.`);
  }
  return value;
}

/** The configured client. Exported so a plugin can issue a read the hooks don't cover. */
export function useCorpusClient(): CorpusClient {
  return useCorpusContext("useCorpusClient").client;
}

export function useCorpusBridge(): SseBridge {
  return useCorpusContext("useCorpusBridge").bridge;
}

export function usePendingTurnStore(): PendingTurnStore {
  return useCorpusContext("usePendingTurnStore").pendingTurns;
}
