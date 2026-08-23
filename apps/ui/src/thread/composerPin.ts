import { useEffect } from "react";

/**
 * **A composer does not re-position itself inside the press that reaches it**
 * (UI-157; SPEC.md §10, and the rule SHARED-061 states for size, stated here for
 * position).
 *
 * ## What went wrong
 *
 * `thread.css` pins a composer that is in use — `.composer:focus-within {
 * position: sticky; bottom: -1px }` — so the box you are typing in stays visible
 * while you scroll the conversation above it (UI-110). The trigger is focus, and
 * **the browser gives focus on `mousedown`**: inside the click, before the
 * `mouseup` that completes it. So when a composer's foot sits below the fold of
 * its reading surface, pressing any control in it does this:
 *
 * 1. `mousedown` lands on the control and focus moves there.
 * 2. `:focus-within` matches, the composer pins, and the whole box jumps up to
 *    the bottom of the reading surface.
 * 3. `mouseup` fires at the old coordinates, which are now over something else,
 *    so no `click` is dispatched at all and the press is discarded.
 *
 * Measured in Chromium at 1280×720, a reply composer with its address line 4px
 * clear of the reading surface's bottom edge:
 *
 *     column   the composer jumped   the popover opened
 *     336px    43px                  no
 *     440px    16px                  no
 *     560px    16px                  no
 *
 * With the same setup at 440px, `◉ ask agent` took focus, moved 19px, and stayed
 * `aria-pressed="true"` — the toggle did not toggle. The attach button and the
 * reply field were measured moving the same way under the same press (17px and
 * 45px); what that costs them was not observed, because a file dialog and a
 * caret cannot be read from a spec. The **second** press always works, because by then the composer is pinned and
 * steady, which is why this never showed up as a failing test: every spec that
 * presses one of these controls presses it where it is fully in view.
 *
 * UI-157 filed it as geometry at a path column's 440px, because that is the
 * width its reporter was porting suites to. **It is not about width.** Width
 * only decides how far the box jumps — a narrower column wraps the foot onto two
 * or three rows, so there is more of the composer below the fold to lift.
 *
 * ## What this does
 *
 * A composer that was not pinned when a press began stays unpinned until that
 * press is over. The pointer goes down, nothing moves, the pointer comes up on
 * the control it went down on, the click is dispatched — and only then does the
 * pin arrive and bring the composer fully into view.
 *
 * ## What it deliberately does not do
 *
 * It does not remove the arrival. Once the press is over the composer still
 * lifts to the bottom of the reading surface, because that is UI-110 working and
 * it is the same arrival a press on the reply field has always produced. Two
 * other repairs were considered and rejected — the first was built and measured,
 * the second reasoned out from what the first measured:
 *
 * - **Scrolling the reading surface by the shortfall as the pin lands.** It does
 *   keep the pin from lifting the box a second time, but the box has already
 *   arrived at the pin line — measured at 336px, the address line still moved
 *   639px → 596px. The pin's whole job is to bring the composer to that line, so
 *   nothing that pins can also leave the box where it was.
 * - **Holding the composer unpinned until the reader is next scrolled.** That
 *   removes the arrival entirely, and with it UI-110 for the one path it was
 *   filed about: click into a composer at the fold, scroll up to re-read what
 *   you are answering, and the composer you are typing in scrolls away.
 *
 * So the arrival stays and its timing moves: after the press instead of inside
 * it. Nothing moves under a pointer that is pressing.
 *
 * ## Why a document listener rather than a prop on each composer
 *
 * Three components render `.composer` (`ThreadComposer`, `NewChildThread`,
 * `NewCommentComposer`) and `CommentPopover` hosts a fourth. The invariant is
 * about the class and the stylesheet, not about any one of them, so a composer
 * added later inherits it rather than having to remember it. It also has to run
 * **before** focus moves, which is inside the browser's own `mousedown` default
 * action — a React state update scheduled from a component's handler is not a
 * guarantee of that, and a `data-` attribute set here is not something React
 * will overwrite on its next render.
 */

/** Marks a composer that must not pin until the current press is over. */
const PRESSING = "composerPressing";

/** The one composer currently under a press, so the flag cannot be orphaned. */
let pressed: HTMLElement | null = null;

function release(): void {
  if (pressed === null) return;
  delete pressed.dataset[PRESSING];
  pressed = null;
}

/**
 * Takes `Event` rather than `PointerEvent`, and is exported, so the guards below
 * can be driven from a unit test. Only `target` is read, and the layout question
 * this pair is really about is a browser one — `composer-press.spec.ts` makes
 * that claim; `composerPin.test.ts` makes only these.
 */
export function holdComposerDuringPress(event: Event): void {
  /* A press that never reported its release must not outlive the next one. */
  release();
  const target = event.target;
  if (!(target instanceof Element)) return;
  const composer = target.closest(".composer");
  if (!(composer instanceof HTMLElement)) return;
  /*
   * Already pinned — by a draft in it (`.in-use`) or by focus it already had.
   * This press will not move it, and suppressing the pin *would*.
   */
  if (getComputedStyle(composer).position === "sticky") return;
  composer.dataset[PRESSING] = "";
  pressed = composer;
}

/** Exported alongside {@link holdComposerDuringPress}, for the same reason. */
export function releaseComposerAfterPress(): void {
  release();
}

/**
 * Installs the pair for the life of the shell.
 *
 * Capture phase, so it runs before any component's own pointer handling and
 * cannot be pre-empted by one that stops propagation. The release listens on
 * `window` rather than the composer: a press that ends outside the box it began
 * in still ends.
 */
export function useSteadyComposerPin(): void {
  useEffect(() => {
    window.addEventListener("pointerdown", holdComposerDuringPress, true);
    window.addEventListener("pointerup", releaseComposerAfterPress, true);
    window.addEventListener("pointercancel", releaseComposerAfterPress, true);
    return () => {
      window.removeEventListener("pointerdown", holdComposerDuringPress, true);
      window.removeEventListener("pointerup", releaseComposerAfterPress, true);
      window.removeEventListener("pointercancel", releaseComposerAfterPress, true);
      release();
    };
  }, []);
}
