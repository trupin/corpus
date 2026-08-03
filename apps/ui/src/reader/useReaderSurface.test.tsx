/** @vitest-environment jsdom */
import type { RevealTarget } from "@corpus/kit/plugin";
import { cleanup, render } from "@testing-library/react";
import { type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docFixture } from "../testing/readerFixture";
import type { ReaderDoc } from "./useReaderDoc";
import { useReaderSurface } from "./useReaderSurface";

/**
 * The reading surface's own lifecycle, at the seam UI-037 added to it.
 *
 * A reveal is the only thing this hook starts that **outlives the render that
 * started it**: the flash is drawn into a body-level layer and kept on its line
 * by an animation-frame loop that re-finds the text every frame. Unmounting
 * already put it out (commit `1514f09`); navigating within the 1.2 s it stays
 * lit did not, and that is the ordinary case — a reader can follow a ref in half
 * that time, and the loop was left hunting for the previous document's words in
 * the newly opened one (PR #19 review).
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const layer of document.querySelectorAll("[data-reveal-flash]")) layer.remove();
});

function readerDoc(docId: string, body: string): ReaderDoc {
  return {
    docId,
    doc: docFixture({ frontmatter: { id: docId, title: docId }, body }),
    isPending: false,
    isMissing: false,
    error: null,
    isArchived: false,
    isThread: false,
    thread: undefined,
    threads: [],
    backlinks: [],
    related: [],
    lock: null,
  };
}

interface SurfaceProps {
  readonly docId: string;
  readonly text: string;
  readonly reveal?: RevealTarget | undefined;
}

/** The surface with a body the reveal can actually find its words in. */
function Surface({ docId, text, reveal }: SurfaceProps): ReactElement {
  const surface = useReaderSurface({
    reader: readerDoc(docId, text),
    restoreY: 0,
    // What both hosts pass: one value per navigation entry.
    navToken: `${docId}#0`,
    onScroll: () => undefined,
    reveal,
    onRevealed: () => undefined,
  });
  return (
    <div ref={surface.scrollRef} className="reader-scroll">
      <p>{text}</p>
    </div>
  );
}

function flashes(): number {
  return document.querySelectorAll("[data-reveal-flash]").length;
}

const BUY: RevealTarget = { kind: "item", exact: "Buy milk" };
const SELL: RevealTarget = { kind: "item", exact: "Sell bread" };

describe("a reveal flash and the navigation that lit it", () => {
  it("is put out when the reader navigates while it is still lit", () => {
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const view = render(<Surface docId="doc_a" text="Buy milk" reveal={BUY} />);
    expect(flashes()).toBe(1);

    // Following a ref: another document, and no instruction about where to land.
    view.rerender(<Surface docId="doc_b" text="Sell bread" />);

    expect(flashes()).toBe(0);
    // Not merely hidden: the frame loop that was re-searching for "Buy milk" —
    // in a body that now holds something else entirely — is cancelled.
    expect(cancel).toHaveBeenCalled();
  });

  it("leaves exactly one flash behind when the next document has one of its own", () => {
    const view = render(<Surface docId="doc_a" text="Buy milk" reveal={BUY} />);
    expect(flashes()).toBe(1);

    view.rerender(<Surface docId="doc_b" text="Sell bread" reveal={SELL} />);

    expect(flashes()).toBe(1);
  });

  /**
   * The guard is "is this still that navigation", not "did an effect re-run" —
   * which is what keeps StrictMode's replayed effects (and every ordinary
   * re-render) from putting out a flash that has only just been lit.
   */
  it("survives a re-render that is not a navigation", () => {
    const view = render(<Surface docId="doc_a" text="Buy milk" reveal={BUY} />);
    expect(flashes()).toBe(1);

    view.rerender(<Surface docId="doc_a" text="Buy milk" reveal={BUY} />);

    expect(flashes()).toBe(1);
  });

  it("takes the flash away on unmount, as it always did", () => {
    const view = render(<Surface docId="doc_a" text="Buy milk" reveal={BUY} />);
    expect(flashes()).toBe(1);

    view.unmount();

    expect(flashes()).toBe(0);
  });
});
