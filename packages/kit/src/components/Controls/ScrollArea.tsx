import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactElement } from "react";

/**
 * A scroll region that cannot honestly render unusable (UI-191/UI-193).
 *
 * - Its visible region never renders below `--min-usable-height`
 *   (`tokens.css`, ported from `design/index.html`): the stylesheet clamps
 *   it (`min-height`), which is the production behaviour.
 * - In development it **throws** instead when a surface would have squeezed
 *   it under the minimum — the message names the token and the measured
 *   height, so the defect is the surface's to fix rather than this region's
 *   to hide.
 * - Overflow is visible: `data-overflowing` flips when content outruns the
 *   region, and the stylesheet draws the affordance off it.
 */
export type ScrollAreaProps = ComponentPropsWithoutRef<"div">;

/**
 * `tokens.css`'s `--min-usable-height`, as a number.
 *
 * A constant beside the token rather than a computed-style read, because the
 * check must also hold where no stylesheet is loaded (jsdom); the tokens
 * test pins the two to each other.
 */
export const MIN_USABLE_HEIGHT_PX = 120;

/** The token the minimum comes from — named in the dev throw. */
export const MIN_USABLE_HEIGHT_TOKEN = "--min-usable-height";

export class ScrollAreaTooShortError extends Error {
  override readonly name = "ScrollAreaTooShortError";

  constructor(measured: number) {
    super(
      `ScrollArea rendered ${String(Math.round(measured))}px tall — below ` +
        `${MIN_USABLE_HEIGHT_TOKEN} (${String(MIN_USABLE_HEIGHT_PX)}px). The surface ` +
        `holding it must yield room; in production this region clamps to the minimum.`,
    );
  }
}

export function ScrollArea({ className, children, ...rest }: ScrollAreaProps): ReactElement {
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = region.current;
    if (element === null) return;
    const measure = (): void => {
      const height = element.getBoundingClientRect().height;
      // Zero means "no layout here" (jsdom, display:none) — unmeasurable is
      // not too short, and a throw on it would fail every unit render.
      if (height > 0 && height < MIN_USABLE_HEIGHT_PX && process.env.NODE_ENV !== "production") {
        throw new ScrollAreaTooShortError(height);
      }
      const overflowing = element.scrollHeight > element.clientHeight;
      element.setAttribute("data-overflowing", overflowing ? "true" : "false");
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children]);

  return (
    <div
      ref={region}
      className={className === undefined ? "scroll-region" : `scroll-region ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
