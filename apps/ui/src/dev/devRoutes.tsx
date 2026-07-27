import type { ReactElement } from "react";
import { Route } from "react-router-dom";
import { DataProbe } from "./DataProbe";

/** Where the kit data probe lives. Double underscore: never a document route. */
export const DEV_PROBE_PATH = "/__probe";

/**
 * The diagnostics routes, mounted in development builds only.
 *
 * `import.meta.env.DEV` is a Vite compile-time constant, so a production bundle
 * drops both this branch and the probe it renders. The flag is a parameter so
 * both branches are testable — a dev-only surface that nobody can prove is
 * dev-only is just a surface.
 */
export function devRoutes(isDev: boolean = import.meta.env.DEV): ReactElement | null {
  if (!isDev) return null;
  return <Route key={DEV_PROBE_PATH} path={DEV_PROBE_PATH} element={<DataProbe />} />;
}
