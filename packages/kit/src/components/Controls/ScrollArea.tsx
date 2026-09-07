import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ReactElement } from "react";

/**
 * A scroll region that cannot honestly render unusable (UI-191/UI-193).
 *
 * - **Its floor is `min(content, --min-usable-height)`** (`tokens.css`, ported
 *   from `design/index.html`): where content outruns the token, the visible
 *   region never renders below the token; where content is *shorter* than the
 *   token, the region takes its content's own height and no more. The second
 *   half is UI-192's phase-60 lesson (the evaluation's FAIL-1): a region that
 *   spent the full token on a three-lane roster handed a 229px card to a 192px
 *   panel, and what fell past the clip was the card's only weight editor. The
 *   token is a guarantee about *usable scrolling*, not a tax on short content.
 * - The floor is **measured** here (an inline `min-height`), because CSS cannot
 *   express `min(content, token)`; the stylesheet's token clamp stands as the
 *   fallback wherever there is no layout to measure (jsdom, a server render).
 *   It is a layout effect so a consumer's own layout effect — which React runs
 *   *after* its children's — reads settled geometry, never the CSS fallback's.
 * - In development it **throws** when a surface squeezes the region under that
 *   floor — the message names the token and the measured heights, so the
 *   defect is the surface's to fix rather than this region's to hide.
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

  constructor(measured: number, content: number) {
    super(
      `ScrollArea rendered ${String(Math.round(measured))}px tall against ` +
        `${String(Math.round(content))}px of content — below its floor of ` +
        `min(content, ${MIN_USABLE_HEIGHT_TOKEN} = ${String(MIN_USABLE_HEIGHT_PX)}px). ` +
        `The surface holding it must yield room; in production this region clamps to that floor.`,
    );
  }
}

export function ScrollArea({ className, children, ...rest }: ScrollAreaProps): ReactElement {
  const region = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = region.current;
    if (element === null) return;
    const measure = (): void => {
      // The content's own height, read with every floor collapsed: a box a
      // floor (or a stretching flex parent) has grown past its content reports
      // `scrollHeight === clientHeight`, which is exactly the reading that
      // made a short roster cost the full token (UI-192, phase-60 FAIL-1).
      element.style.minHeight = "0px";
      const content = element.scrollHeight;
      if (content <= 0) {
        // No layout to ask (jsdom, display:none) — unmeasurable is not too
        // short. The stylesheet's token clamp is left standing.
        element.style.removeProperty("min-height");
        element.setAttribute("data-overflowing", "false");
        return;
      }
      // `+ 1` where content outruns the token: the overflow affordance border
      // is sized into the box (`box-sizing: border-box`), so the usable inside
      // costs the token plus the border's pixel (UI-192, found by the battery).
      const floor = content > MIN_USABLE_HEIGHT_PX ? MIN_USABLE_HEIGHT_PX + 1 : content;
      element.style.minHeight = `${String(floor)}px`;
      const height = element.getBoundingClientRect().height;
      if (
        height > 0 &&
        height + 1 < Math.min(content, MIN_USABLE_HEIGHT_PX) &&
        process.env.NODE_ENV !== "production"
      ) {
        throw new ScrollAreaTooShortError(height, content);
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
