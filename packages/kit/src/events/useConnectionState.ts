import { useSyncExternalStore } from "react";
import { useCorpusBridge } from "../client/context.js";
import type { ConnectionState } from "./sseBridge.js";

/**
 * The live-update connection's state, for the console strip and the shell
 * (SPEC.md §11). A UI that cannot say "reconnecting" silently serves stale data
 * and looks identical to one that is up to date — which is the failure mode
 * this hook exists to make impossible.
 */
export function useConnectionState(): ConnectionState {
  const bridge = useCorpusBridge();
  return useSyncExternalStore(
    (listener) => bridge.subscribe(listener),
    () => bridge.getState(),
    // The server-rendered value; there is no SSR today, and "connecting" is the
    // only honest answer before an effect has had a chance to open anything.
    () => "connecting" as const,
  );
}
