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
  surfaceWidth,
} from "./docWidth";
import { FocusMode } from "./FocusMode";
import { Reader } from "./Reader";
import { resetEscapeLayers } from "./useEscapeStack";
import { FOCUS_SURFACE, columnSurface } from "../thread/threadCollapse";

/**
 * The reader's width control, in both hosts (SPEC.md §11's rider of
 * 2026-08-04, UI-066).
 *
 * jsdom has no layout, so what is provable here is the **state**: that a
 * control exists on both surfaces, that it is keyed per surface exactly as
 * UI-077's folds are, that a key press moves it, and that the chosen width
 * reaches the host element as a custom property and survives navigation. What
 * the geometry does with that property — the body actually getting wider, and
 * an anchored margin card staying beside its highlight — is `doc-width.spec.ts`
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

describe("the document width control", () => {
  it("is offered in the column reader", async () => {
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    const handle = screen.getByRole("separator", { name: DOC_WIDTH_LABEL });
    expect(handle.closest(".reader")).not.toBeNull();
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    // Reachable without a pointer — §11 adds no exclusive-pointer capability.
    expect(handle.getAttribute("tabindex")).toBe("0");
  });

  it("is offered in full screen too", async () => {
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .doc-main")).not.toBeNull();
    });
    expect(
      screen.getByRole("separator", { name: DOC_WIDTH_LABEL }).closest(".focus"),
    ).not.toBeNull();
  });

  /**
   * The default is the stylesheet's `62ch` / `66ch`, and it stays that way for
   * a surface nobody has dragged: *"a default is preserved for documents never
   * adjusted — nobody is forced to set a width to read comfortably"*.
   */
  it("sets no measure at all until somebody chooses one", async () => {
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    expect(measureOf(".reader")).toBe("");
  });

  it("puts a stored width on the host, where every measured element inherits it", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [columnSurface("doc_col")]: 780 })));
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe("780px");
    });
  });

  it("reads focus mode's own width, not the column's", async () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage(stored({ [columnSurface("doc_col")]: 780, [FOCUS_SURFACE]: 1040 })),
    );
    render(<Focus transport={wire()} />);
    await waitFor(() => {
      expect(measureOf(".focus")).toBe("1040px");
    });
  });

  it("moves by one step per arrow key, and writes the surface's own entry", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [columnSurface("doc_col")]: 700 })));
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe("700px");
    });

    const handle = screen.getByRole("separator", { name: DOC_WIDTH_LABEL });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe(`${String(700 + DOC_WIDTH_STEP)}px`);
    });
    expect(surfaceWidth(readDocWidthState(), columnSurface("doc_col"))).toBe(700 + DOC_WIDTH_STEP);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe("700px");
    });
    expect(surfaceWidth(readDocWidthState(), columnSurface("doc_col"))).toBe(700);
  });

  it("ignores a key that is not a width key", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [columnSurface("doc_col")]: 700 })));
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe("700px");
    });
    fireEvent.keyDown(screen.getByRole("separator", { name: DOC_WIDTH_LABEL }), { key: "a" });
    expect(measureOf(".reader")).toBe("700px");
  });

  it("holds the floor rather than letting the body be dragged away to nothing", async () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage(stored({ [columnSurface("doc_col")]: MIN_DOC_WIDTH })),
    );
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe(`${String(MIN_DOC_WIDTH)}px`);
    });
    fireEvent.keyDown(screen.getByRole("separator", { name: DOC_WIDTH_LABEL }), {
      key: "ArrowLeft",
    });
    expect(measureOf(".reader")).toBe(`${String(MIN_DOC_WIDTH)}px`);
  });

  /**
   * §11 asks for a width that persists **across navigation**, and navigation is
   * exactly what changes the document — which is why the width belongs to the
   * reader and not to what it happens to be showing.
   */
  it("keeps the width when the reader follows a ref to another document", async () => {
    vi.stubGlobal("localStorage", memoryStorage(stored({ [columnSurface("doc_col")]: 820 })));
    render(<Column transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".reader .doc-main")).not.toBeNull();
    });
    await waitFor(() => {
      expect(measureOf(".reader")).toBe("820px");
    });

    fireEvent.click(await screen.findByText("Rates"));
    await waitFor(() => {
      expect(document.querySelector(".reader")?.getAttribute("data-reader-doc")).toBe("doc_r");
    });
    expect(measureOf(".reader")).toBe("820px");
  });

  /** No provider, no control: a `DocView` outside a reader lays out unchanged. */
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
   * commit the reveal arms in — repeated every frame while the column's width
   * transition ran.
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
