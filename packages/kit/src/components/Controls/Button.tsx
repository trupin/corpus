import type { ComponentPropsWithRef, ReactElement } from "react";

/**
 * The one button (UI-191).
 *
 * The three named variants are the mockup's three button roles, transcribed in
 * `controls.css`: `primary` is the accent-filled act (`Ask`, `Compose`),
 * `outline` the outlined secondary (`Capture`), `quiet` the surface-2 utility
 * (`queue`). `bare` — the default — renders the reset alone and leaves the
 * look to the surface's own stylesheet, which is what makes migrating a
 * bespoke control (a job row, a board tab, a toolbar toggle) a mechanical
 * substitution rather than a restyle: the surface keeps its mockup-derived
 * CSS, and the element goes through the primitive, where the lint gate and
 * any future language change can reach it.
 *
 * Radius: 8px, per the recorded P4 ruling in `design/index.html` — the 99px
 * pill is the {@link Chip}/{@link Select} family, never this.
 *
 * `type` defaults to `"button"`, because a bare `<button>` inside a form
 * submits it — the footgun every migrated call site was already dodging by
 * hand.
 */
export type ButtonVariant = "primary" | "outline" | "quiet" | "bare";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** The mockup role this button plays. `bare` (default) adds no kit look. */
  readonly variant?: ButtonVariant;
}

/** The `className` a variant contributes, merged before the caller's own. */
export function buttonClassName(
  variant: ButtonVariant | undefined,
  className: string | undefined,
): string | undefined {
  const base = variant === undefined || variant === "bare" ? undefined : `btn btn-${variant}`;
  if (base === undefined) return className;
  return className === undefined ? base : `${base} ${className}`;
}

export function Button({ variant, className, type, ...rest }: ButtonProps): ReactElement {
  return (
    <button type={type ?? "button"} className={buttonClassName(variant, className)} {...rest} />
  );
}
