import type { ReactElement } from "react";
import { themeGlyph, themeToggleLabel } from "./theme";
import { useTheme } from "./useTheme";

export function ThemeToggle(): ReactElement {
  const { mode, cycle } = useTheme();
  return (
    <button type="button" className="btn-theme" aria-label={themeToggleLabel(mode)} onClick={cycle}>
      <span aria-hidden="true">{themeGlyph(mode)}</span>
    </button>
  );
}
