import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { UpgradePanel } from "./UpgradePanel";

/**
 * Who may open the updates panel, and who needs to know one is running.
 *
 * Two components care and they are nowhere near each other: the console strip's
 * version label opens the panel, and the same label has to stop saying "server
 * unreachable" while the server is deliberately away. A context is what carries
 * the second fact past the shell without the strip having to own the panel.
 */

interface UpgradeSurface {
  readonly open: () => void;
  /** True between the `202` and the server answering again (SPEC.md §2.4). */
  readonly inFlight: boolean;
}

const UpgradeContext = createContext<UpgradeSurface>({
  open: () => undefined,
  inFlight: false,
});

export function useUpgradeSurface(): UpgradeSurface {
  return useContext(UpgradeContext);
}

export function UpgradeProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  const [inFlight, setInFlight] = useState(false);

  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const value = useMemo<UpgradeSurface>(() => ({ open: show, inFlight }), [inFlight, show]);

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      {open ? <UpgradePanel onClose={close} onInFlight={setInFlight} /> : null}
    </UpgradeContext.Provider>
  );
}
