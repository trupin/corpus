import type { ComponentPropsWithRef, ReactElement } from "react";

/**
 * An icon-only button (UI-191).
 *
 * The guarantee is the accessible name: `label` is required, so an unlabelled
 * icon button does not compile into the product. It lands as `aria-label`,
 * and as `title` too unless the caller supplies a richer one — an icon with
 * no hover text is a control a pointer user has to press to identify.
 *
 * Like {@link Button}'s `bare` variant it adds no kit look of its own: every
 * icon button in the product is drawn by its surface's mockup-derived CSS
 * (`.fmt-bar button`, `.icon-btn`, `.expand`, …), and what the primitive adds
 * is the name contract and the one place the lint gate points at.
 */
export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "aria-label"> {
  /** The accessible name. Required — there is no unlabelled icon button. */
  readonly label: string;
}

export function IconButton({ label, title, type, ...rest }: IconButtonProps): ReactElement {
  return <button type={type ?? "button"} aria-label={label} title={title ?? label} {...rest} />;
}
