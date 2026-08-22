/** @vitest-environment jsdom */
import type { RevealTarget } from "@corpus/kit";
import { cleanup, render, waitFor } from "@testing-library/react";
import { type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../shell/Toasts";
import { docFixture, threadRowFixture } from "../testing/readerFixture";
import { REVEAL_SETTLED_ATTRIBUTE } from "./reveal";
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

function readerDoc(docId: string, body: string, threads?: ThreadState): ReaderDoc {
  return {
    docId,
    doc: docFixture({ frontmatter: { id: docId, title: docId }, body }),
    isPending: false,
    isMissing: false,
    error: null,
    isArchived: false,
    isThread: false,
    thread: undefined,
    threadPending: false,
    threadsSettled: threads?.settled ?? true,
    threads: (threads?.ids ?? []).map((id) => threadRowFixture({ id })),
    backlinks: [],
    related: [],
  };
}

/** The conversation list as the reader sees it: in flight, or answered. */
interface ThreadState {
  readonly settled: boolean;
  readonly ids?: readonly string[];
}

interface SurfaceProps {
  readonly docId: string;
  readonly text: string;
  readonly reveal?: RevealTarget | undefined;
  /** Spending the navigation instruction, observed. */
  readonly onRevealed?: (() => void) | undefined;
  readonly threads?: ThreadState | undefined;
  /**
   * Whether the surface says it has finished arriving — `DocView`'s body, which
   * carries the marker, against its `Loading…`, which deliberately does not.
   * The ordinary case is a rendered body, so that is the default.
   */
  readonly arrived?: boolean | undefined;
}

/** The surface with a body the reveal can actually find its words in. */
function Surface({
  docId,
  text,
  reveal,
  onRevealed,
  threads,
  arrived = true,
}: SurfaceProps): ReactElement {
  const surface = useReaderSurface({
    reader: readerDoc(docId, text, threads),
    restoreY: 0,
    // What both hosts pass: one value per navigation entry.
    navToken: `${docId}#0`,
    onScroll: () => undefined,
    reveal,
    onRevealed: onRevealed ?? (() => undefined),
  });
  return (
    <div ref={surface.scrollRef} className="reader-scroll">
      <p {...(arrived ? { [REVEAL_SETTLED_ATTRIBUTE]: "" } : {})}>{text}</p>
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

/**
 * UI-140. The reveal used to retry five times, 80 ms apart, and then spend the
 * navigation instruction whether or not anything had been drawn — so a cold
 * open whose body took longer than ~320 ms to render opened the document at the
 * top, drew no flash and forgot what it was for. Measured at **2.5% of opens**
 * (9 of 360) at eight Playwright workers, and ~19% with four cores busy.
 *
 * The reader shows `Loading…` and no body at all while plugin discovery is
 * pending, so those 320 ms were spent searching a placeholder. That is the
 * shape the tests below reproduce: a surface that says nothing, then says
 * something.
 */
describe("a reveal whose body has not arrived yet", () => {
  /** Long enough to have exhausted the ladder this replaces, twice over. */
  const PAST_THE_OLD_BUDGET_MS = 700;

  function rest(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it("does not give up on a surface that has told it nothing", async () => {
    const revealed = vi.fn();
    render(
      <Surface docId="doc_a" text="Loading…" reveal={BUY} onRevealed={revealed} arrived={false} />,
    );

    await rest(PAST_THE_OLD_BUDGET_MS);

    // Nothing drawn, because there is nothing to draw on — and, crucially, the
    // instruction is still in hand. "Not there yet" is not "not there".
    expect(flashes()).toBe(0);
    expect(revealed).not.toHaveBeenCalled();
  });

  it("draws the flash when the body arrives long after that budget", async () => {
    const revealed = vi.fn();
    const view = render(
      <Surface docId="doc_a" text="Loading…" reveal={BUY} onRevealed={revealed} arrived={false} />,
    );
    await rest(PAST_THE_OLD_BUDGET_MS);
    expect(flashes()).toBe(0);

    // Discovery settles and the document renders. The same instruction, still
    // pending — this is a re-render, not a navigation, so the effect does not
    // re-run and the search that is already climbing is the one that finds it.
    view.rerender(<Surface docId="doc_a" text="Buy milk" reveal={BUY} onRevealed={revealed} />);

    await waitFor(() => {
      expect(flashes()).toBe(1);
    });
    expect(revealed).toHaveBeenCalledTimes(1);
  });

  it("gives up once the surface has arrived without the words, and says which", async () => {
    const revealed = vi.fn();
    const view = render(
      <ToastProvider>
        <Surface docId="doc_a" text="Loading…" reveal={BUY} onRevealed={revealed} arrived={false} />
      </ToastProvider>,
    );
    // The body arrives, and the quote is not in it: edited away between the
    // click and the open. This is the case that must still terminate.
    view.rerender(
      <ToastProvider>
        <Surface docId="doc_a" text="Sell bread" reveal={BUY} onRevealed={revealed} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(revealed).toHaveBeenCalledTimes(1);
    });
    expect(flashes()).toBe(0);
    // …and the reader is told, rather than left at the top of a document with
    // no account of why.
    const toast = document.querySelector(".toast .msg");
    expect(toast?.textContent).toContain("Buy milk");
    expect(toast?.textContent).toContain("no longer on this document");
  });
});

/**
 * The other half of the same distinction, found in review of UI-140 (PR #54).
 *
 * A **warm** open renders the body in the same commit that gives the reader
 * content — a document already in the query cache, with plugin discovery long
 * since settled — so the reveal's first look is at a finished surface that never
 * changes again. Arrival inferred from movement alone is unobtainable there, so
 * a quote edited away could not be called absent: the reveal ran the full
 * `REVEAL_WAIT_MS` and then blamed the loading of a document that had loaded
 * perfectly, in the tone that marks the console with an unread error.
 *
 * It always terminated. What was wrong was the account it gave.
 */
describe("a reveal into a body that was already on screen", () => {
  it("calls a quote that was edited away absent, not a document that failed to load", async () => {
    const revealed = vi.fn();
    // One render, one commit: no placeholder before it and no change after it.
    render(
      <ToastProvider>
        <Surface docId="doc_a" text="Sell bread" reveal={BUY} onRevealed={revealed} />
      </ToastProvider>,
    );

    // Inside `waitFor`'s own second, which is a quarter of the ceiling: the
    // verdict is reached by watching the surface, not by outlasting it.
    await waitFor(() => {
      expect(revealed).toHaveBeenCalledTimes(1);
    });
    expect(flashes()).toBe(0);
    const toast = document.querySelector(".toast");
    expect(toast?.getAttribute("data-tone")).toBe("info");
    expect(toast?.querySelector(".msg")?.textContent).toContain("no longer on this document");
    expect(toast?.querySelector(".msg")?.textContent).not.toContain("did not finish loading");
  });

  it("still draws the flash when the words are on that body", async () => {
    const revealed = vi.fn();
    render(
      <ToastProvider>
        <Surface docId="doc_a" text="Buy milk" reveal={BUY} onRevealed={revealed} />
      </ToastProvider>,
    );

    expect(flashes()).toBe(1);
    await waitFor(() => {
      expect(revealed).toHaveBeenCalledTimes(1);
    });
    expect(document.querySelector(".toast")).toBeNull();
  });
});

/**
 * The same defect one request over (UI-140).
 *
 * A thread reveal used to fire the instant the *document* had content and spend
 * the instruction there and then — but `reader.threads` is a second request, and
 * an empty list reads the same whether the document has no conversations or the
 * list has not landed. So a cold open silently expanded nothing, measured at 1
 * open in 80 under eight Playwright workers.
 */
describe("a reveal that names a conversation the list has not answered for yet", () => {
  const THREAD: RevealTarget = { kind: "thread", threadId: "th_1" };

  it("waits for the list rather than spending the instruction on an empty one", async () => {
    const revealed = vi.fn();
    const view = render(
      <Surface
        docId="doc_a"
        text="Buy milk"
        reveal={THREAD}
        onRevealed={revealed}
        threads={{ settled: false }}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(revealed).not.toHaveBeenCalled();

    view.rerender(
      <Surface
        docId="doc_a"
        text="Buy milk"
        reveal={THREAD}
        onRevealed={revealed}
        threads={{ settled: true, ids: ["th_1"] }}
      />,
    );

    await waitFor(() => {
      expect(revealed).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The list answering "no conversations at all" is a real answer, and it looks
   * exactly like a list in flight from the array alone — which is why the
   * settled flag is part of what the reveal reads, not something beside it.
   */
  it("gives up, and says so, once the list has answered without it", async () => {
    const revealed = vi.fn();
    const view = render(
      <ToastProvider>
        <Surface
          docId="doc_a"
          text="Buy milk"
          reveal={THREAD}
          onRevealed={revealed}
          threads={{ settled: false }}
        />
      </ToastProvider>,
    );
    view.rerender(
      <ToastProvider>
        <Surface
          docId="doc_a"
          text="Buy milk"
          reveal={THREAD}
          onRevealed={revealed}
          threads={{ settled: true }}
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(revealed).toHaveBeenCalledTimes(1);
    });
    expect(document.querySelector(".toast .msg")?.textContent).toContain("That conversation");
  });
});
