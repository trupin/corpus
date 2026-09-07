import { IconButton } from "@corpus/kit";
import type { ReactElement } from "react";
import { themeGlyph, themeToggleLabel } from "./theme";
import { useTheme } from "./useTheme";

export function ThemeToggle(): ReactElement {
  const { mode, cycle } = useTheme();
  return (
    <IconButton className="btn-theme" label={themeToggleLabel(mode)} onClick={cycle}>
      <span aria-hidden="true">{themeGlyph(mode)}</span>
    </IconButton>
  );
}
