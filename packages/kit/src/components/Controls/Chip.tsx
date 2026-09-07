import type { ComponentPropsWithRef, ReactElement } from "react";

/**
 * The chip pill as a control (UI-191) — `design/index.html`'s `.chip` family,
 * ported, on a real `<button>`.
 *
 * Variants are semantic roles, never colour names (the tokens rule):
 * - `default` — the quiet `--surface-2` pill;
 * - `on`      — the stateful/tinted variant (`--accent-wash`);
 * - `warn`    — the staleness axis (`--sepia-wash-2`);
 * - `good`    — success/resolved (`--good-wash`);
 * - `ghost`   — the DASHED border, which is the empty/placeholder state
 *               (`due: —`), per the user's transcription.
 *
 * A *passive* chip — a fact, not a control — stays a plain `<span
 * class="chip">` in its surface's markup: only interactive elements go
 * through the primitives, and a span that pretended to be pressable would be
 * the dishonest half.
 */
export type ChipVariant = "default" | "on" | "warn" | "good" | "ghost";

export interface ChipProps extends ComponentPropsWithRef<"button"> {
  readonly variant?: ChipVariant;
}

/** The mockup's class pair for a variant, merged before the caller's own. */
export function chipClassName(
  variant: ChipVariant | undefined,
  className: string | undefined,
): string {
  const base = variant === undefined || variant === "default" ? "chip" : `chip ${variant}`;
  return className === undefined ? base : `${base} ${className}`;
}

export function Chip({ variant, className, type, ...rest }: ChipProps): ReactElement {
  return (
    <button
      type={type ?? "button"}
      className={chipClassName(variant, className)}
      data-chip-variant={variant ?? "default"}
      {...rest}
    />
  );
}
