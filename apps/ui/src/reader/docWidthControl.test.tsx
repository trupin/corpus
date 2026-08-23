/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavEntry } from "../board/useBoardLocalState";
import { memoryStorage } from "../testing/memoryStorage.js";
import {
  docFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import {
  DOC_MEASURE_PROPERTY,
  DOC_WIDTH_LABEL,
  DocWidthContext,
  DocWidthHandle,
} from "./DocWidthContext";
import {
  DOC_WIDTH_STATE_VERSION,
  DOC_WIDTH_STORAGE_KEY,
  DOC_WIDTH_STEP,
  MIN_DOC_WIDTH,
  readDocWidthState,
} from "./docWidth";
import { FocusMode } from "./FocusMode";
import { Reader } from "./Reader";
import { resetEscapeLayers } from "./useEscapeStack";
import { FOCUS_SURFACE, columnSurface } from "../thread/threadCollapse";

/**
 * The reader's width, after SPEC.md §10's rider of 2026-08-23: a column's body
 * fills the column and carries **no** control of its own, while full screen
 * keeps the one control, one sticky width for every document opened there.
 *
 * jsdom has no layout, so what is provable here is the **state**: that the
 * column reader offers no handle and sets no measure — not even out of an old
 * blob that still names its column — and that full screen's control exists, is
 * keyboard-operable, writes the one focus entry, prunes the dead column
 * entries, and survives navigation. What the geometry does with all of that —
 * the column's body actually being the column's width, and full screen's
 * default actually being wider than a default column — is `doc-width.spec.ts`
 * in a real browser, which is the only place that evidence is worth anything.
 */

const MORTGAGE = docFixture({
  frontmatter: { id: "doc_m", title: "Mortgage options" },
  body: "Compare against [[doc_r]].",
});

const RATES = docFixture({
  frontmatter: { id: "doc_r", title: "Rates" },
  body: "Back to [[doc_m]].",
  path: "data/docs/finance/rates.md",
});

function wire(): ReaderTransport {
  return readerTransport({
    docs: [MORTGAGE, RATES],
    threads: [threadFixture({ id: "th_rate", parent: "doc_m" })],
    rows: {
      [threadsSearch("doc_m")]: [
        threadRowFixture({ id: "th_rate", parent: "doc_m", anchorQuote: "6.1%" }),
      ],
    },
  });
}

function Column({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const [nav, setNav] = useState<readonly NavEntry[]>([{ docId: "doc_m", scrollY: 0 }]);
  return (
    <harness.Wrapper>
      <div className="col reading" data-col="doc_col">
        <Reader
          columnId="doc_col"
          columnTitle="Finance"
          nav={nav}
          setNav={setNav}
          selectTitle={false}
          isActive
          onFocusMode={() => undefined}
          onNotify={() => undefined}
        />
      </div>
    </harness.Wrapper>
  );
}

function Focus({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <FocusMode
        docId="doc_m"
        listTitle="Finance"
        onClose={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

function stored(surfaces: Readonly<Record<string, number>>): Record<string, string> {
  return {
    [DOC_WIDTH_STORAGE_KEY]: JSON.stringify({ version: DOC_WIDTH_STATE_VERSION, surfaces }),
  };
}

function measureOf(selector: string): string {
  const element = document.querySelector<HTMLElement>(selector);
  return element?.style.getPropertyValue(DOC_MEASURE_PROPERTY) ?? "";
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  vi.unstubAllGlobals();
  for (const layer of document.querySelectorAll("[data-reveal-flash]")) layer.remove();
});

describe("the column reader, whose body fills the column", () => {
  it("offers no width handle: the column's edge is the single gesture", async () => {
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    expect(screen.queryByRole("separator", { name: DOC_WIDTH_LABEL })).toBeNull();
  });

  /**
   * The acceptance criterion "per-column entries in `corpus.docWidth` are no
   * longer read", pinned at the surface: a blob from before the rider still
   * names this very column, and the reader sets no measure from it — the body
   * stays at the stylesheet's `100%` of the column.
   */
  it("sets no measure, even out of an old blob naming this column", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [columnSurface("doc_col")]: 780 })));
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    expect(measureOf(".reader")).toBe("");
    expect(measureOf(".col")).toBe("");
  });
});

describe("full screen's width control", () => {
  it("is offered, and is reachable without a pointer", async () => {
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
    });
    const handle = screen.getByRole("separator", { name: DOC_WIDTH_LABEL });
    expect(handle.closest(".focus")).not.toBeNull();
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    // §10 adds no exclusive-pointer capability.
    expect(handle.getAttribute("tabindex")).toBe("0");
  });

  /**
   * The default is the stylesheet's `66ch`, and it stays that way until
   * somebody chooses: nobody is forced to set a width to read comfortably.
   */
  it("sets no measure at all until somebody chooses one", async () => {
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
    });
    expect(measureOf(".focus")).toBe("");
  });

  it("puts the stored width on the host, where every measured element inherits it", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [FOCUS_SURFACE]: 1040 })));
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(measureOf(".focus")).toBe("1040px");
    });
  });

  /**
   * The independence criterion, read direction: a blob holding a column entry
   * beside the focus entry answers with the focus entry alone — full screen's
   * width was never the column's, and the column's is not consulted.
   */
  it("reads its own width out of a mixed legacy blob, never a column's", async () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage(stored({ [columnSurface("doc_col")]: 780, [FOCUS_SURFACE]: 1040 })),
    );
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(measureOf(".focus")).toBe("1040px");
    });
  });

  it("moves by one step per arrow key, and writes the one focus entry", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [FOCUS_SURFACE]: 700 })));
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
      expect(measureOf(".focus")).toBe("700px");
    });

    const handle = screen.getByRole("separator", { name: DOC_WIDTH_LABEL });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    await waitFor(() => {
      expect(measureOf(".focus")).toBe(`${String(700 + DOC_WIDTH_STEP)}px`);
    });
    expect(readDocWidthState().focus).toBe(700 + DOC_WIDTH_STEP);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(measureOf(".focus")).toBe("700px");
    });
    expect(readDocWidthState().focus).toBe(700);
  });

  /**
   * The independence criterion, write direction — and the pruning: a choice
   * made in full screen leaves no column entry behind, and puts nothing on any
   * column on screen.
   */
  it("writes without touching a column, and prunes the dead column entries", async () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage(stored({ [columnSurface("doc_col")]: 780, [FOCUS_SURFACE]: 700 })),
    );
    render(
      <>
        <Column transport={wire()} />
        <Focus transport={wire()} />
      </>,
    );
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
      expect(measureOf(".focus")).toBe("700px");
    });

    fireEvent.keyDown(screen.getByRole("separator", { name: DOC_WIDTH_LABEL }), {
      key: "ArrowRight",
    });
    await waitFor(() => {
      expect(measureOf(".focus")).toBe(`${String(700 + DOC_WIDTH_STEP)}px`);
    });

    // The column on screen took nothing…
    expect(measureOf(".reader")).toBe("");
    // …and the blob now holds exactly the focus entry: the column keys are gone.
    const raw: unknown = JSON.parse(localStorage.getItem(DOC_WIDTH_STORAGE_KEY) ?? "null");
    expect(raw).toEqual({
      version: DOC_WIDTH_STATE_VERSION,
      surfaces: { [FOCUS_SURFACE]: 700 + DOC_WIDTH_STEP },
    });
  });

  it("ignores a key that is not a width key", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [FOCUS_SURFACE]: 700 })));
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
      expect(measureOf(".focus")).toBe("700px");
    });
    fireEvent.keyDown(screen.getByRole("separator", { name: DOC_WIDTH_LABEL }), { key: "a" });
    expect(measureOf(".focus")).toBe("700px");
  });

  it("holds the floor rather than letting the body be dragged away to nothing", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [FOCUS_SURFACE]: MIN_DOC_WIDTH })));
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
      expect(measureOf(".focus")).toBe(`${String(MIN_DOC_WIDTH)}px`);
    });
    fireEvent.keyDown(screen.getByRole("separator", { name: DOC_WIDTH_LABEL }), {
      key: "ArrowLeft",
    });
    expect(measureOf(".focus")).toBe(`${String(MIN_DOC_WIDTH)}px`);
  });

  /**
   * One sticky value, shared by every document opened there: navigation is
   * exactly what changes the document, so the width belongs to the surface.
   */
  it("keeps the width when full screen follows a ref to another document", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [FOCUS_SURFACE]: 820 })));
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(measureOf(".focus")).toBe("820px");
    });

    fireEvent.click(await screen.findByText("Rates"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Rates")).not.toBeNull();
    });
    expect(measureOf(".focus")).toBe("820px");
  });

  /** No provider, no control: a `DocView` outside full screen lays out unchanged. */
  it("draws nothing where no reader owns a measure", () => {
    render(<DocWidthHandle />);
    expect(screen.queryByRole("separator", { name: DOC_WIDTH_LABEL })).toBeNull();
  });

  it("draws nothing when the context is explicitly empty", () => {
    render(
      <DocWidthContext.Provider value={null}>
        <DocWidthHandle />
      </DocWidthContext.Provider>,
    );
    expect(screen.queryByRole("separator", { name: DOC_WIDTH_LABEL })).toBeNull();
  });

  /**
   * The rule the first version of this control broke, pinned where it can be
   * stated exactly (UI-066).
   *
   * A `ResizeObserver` on the rail feeding a `setState` from a **layout** effect
   * measured the width correctly and stopped the reader scrolling: a reveal
   * found its line, flashed it, and left `scrollTop` at 0 with the line 584px
   * below the fold, 20 runs out of 20 (`reveal.spec.ts`, the todo-item seam).
   * The mechanism was an update scheduled inside the mount commit — the same
   * commit the reveal arms in — repeated every frame while a width transition
   * ran.
   *
   * So the rule is: **this control watches nothing.** It reads the body's width
   * at the three moments the number is used, and never between them. Asserting
   * the absence of an observer is asserting the rule itself, which is why it is
   * worth a test that looks like a white-box one.
   */
  it("observes nothing — the reader's scroll is not this control's to disturb", () => {
    const observed = vi.fn();
    class CountingObserver {
      constructor(_callback: ResizeObserverCallback) {
        observed();
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", CountingObserver);

    render(
      <DocWidthContext.Provider value={{ width: 700, choose: () => undefined }}>
        <DocWidthHandle />
      </DocWidthContext.Provider>,
    );

    expect(screen.getByRole("separator", { name: DOC_WIDTH_LABEL })).not.toBeNull();
    expect(observed).not.toHaveBeenCalled();
  });
});
