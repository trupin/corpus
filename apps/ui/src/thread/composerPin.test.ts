/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { holdComposerDuringPress, releaseComposerAfterPress } from "./composerPin";

/**
 * The guards, and only the guards.
 *
 * What this pair is *for* — a composer that does not lift between `mousedown`
 * and `mouseup` — is a layout claim, and jsdom implements neither layout nor
 * sticky positioning, so it is made in `apps/ui/e2e/composer-press.spec.ts`
 * against a real browser. What is testable here is **which** composers the flag
 * is put on and that it is never left behind: a flag that outlived its press
 * would leave a composer permanently unable to pin, which is UI-110 silently
 * switched off.
 */

interface Fixture {
  readonly box: HTMLElement;
  readonly control: HTMLElement;
}

function composer(options: { readonly pinned?: boolean } = {}): Fixture {
  const box = document.createElement("div");
  box.className = "composer";
  /* jsdom reports inline styles through `getComputedStyle`, which is all the
     guard reads. The stylesheet that really sets this is `thread.css`. */
  if (options.pinned === true) box.style.position = "sticky";
  const control = document.createElement("button");
  box.appendChild(control);
  document.body.appendChild(box);
  return { box, control };
}

/**
 * Dispatches the press rather than calling the handler with a hand-made event,
 * because `Event.target` is null until an event is dispatched — and `target` is
 * the only thing the handler reads.
 */
function press(element: Element): void {
  element.addEventListener("pointerdown", holdComposerDuringPress, { once: true });
  element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

afterEach(() => {
  releaseComposerAfterPress();
  document.body.innerHTML = "";
});

describe("holdComposerDuringPress", () => {
  it("marks the composer a press began in", () => {
    const { box, control } = composer();
    press(control);

    expect(box.dataset["composerPressing"]).toBe("");
  });

  it("leaves an already-pinned composer alone — suppressing its pin would move it", () => {
    const { box, control } = composer({ pinned: true });
    press(control);

    expect(box.dataset["composerPressing"]).toBeUndefined();
  });

  it("ignores a press that began outside every composer", () => {
    const { box } = composer();
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    press(elsewhere);

    expect(box.dataset["composerPressing"]).toBeUndefined();
  });

  it("clears the flag when the press ends", () => {
    const { box, control } = composer();
    press(control);
    releaseComposerAfterPress();

    expect(box.dataset["composerPressing"]).toBeUndefined();
  });

  /**
   * A `pointerup` that never arrives — a press interrupted by a dragged-away
   * pointer, a context menu, a window losing the capture — must not leave a
   * composer that can never pin again. The next press is what clears it.
   */
  it("never leaves a flag behind when a press reports no release", () => {
    const first = composer();
    press(first.control);
    expect(first.box.dataset["composerPressing"]).toBe("");

    const second = composer();
    press(second.control);

    expect(first.box.dataset["composerPressing"]).toBeUndefined();
    expect(second.box.dataset["composerPressing"]).toBe("");
  });

  it("releasing twice is harmless", () => {
    const { box, control } = composer();
    press(control);
    releaseComposerAfterPress();
    releaseComposerAfterPress();

    expect(box.dataset["composerPressing"]).toBeUndefined();
  });
});
