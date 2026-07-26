import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  nextThemeMode,
  readStoredTheme,
  writeStoredTheme,
  type ThemeMode,
} from "./theme";

export interface ThemeController {
  readonly mode: ThemeMode;
  /** Advances `system → light → dark → system`. */
  readonly cycle: () => void;
}

export function useTheme(): ThemeController {
  // Seeded from storage rather than from the DOM: `index.html` has already
  // applied `light`/`dark` before paint, but `system` leaves no trace there.
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(document.documentElement, mode);
    writeStoredTheme(mode);
  }, [mode]);

  const cycle = useCallback(() => {
    setMode(nextThemeMode);
  }, []);

  return { mode, cycle };
}
