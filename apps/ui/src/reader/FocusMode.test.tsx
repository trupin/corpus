/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { RevealTarget } from "@corpus/kit/plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavEntry } from "../board/useBoardLocalState";
import {
  docFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { FocusMode, FOCUS_HINT } from "./FocusMode";
import { Reader } from "./Reader";
import { resetEscapeLayers } from "./useEscapeStack";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  for (const layer of document.querySelectorAll("[data-reveal-flash]")) layer.remove();
});

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

function Solo({
  transport,
  reveal,
  onClose,
}: {
  readonly transport: ReaderTransport;
  readonly reveal?: RevealTarget;
  readonly onClose?: () => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <FocusMode
        docId="doc_m"
        listTitle="Finance"
        reveal={reveal}
        onClose={onClose ?? (() => undefined)}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

/** An already-open overlay the board points somewhere else, without unmounting it. */
function Rewired({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const [target, setTarget] = useState<{ docId: string; reveal?: RevealTarget }>({
    docId: "doc_m",
  });
  return (
    <harness.Wrapper>
      <button
        type="button"
        data-retarget
        onClick={() => {
          setTarget({ docId: "doc_r", reveal: { kind: "item", exact: "Back to" } });
        }}
      >
        retarget
      </button>
      <FocusMode
        docId={target.docId}
        listTitle="Finance"
        reveal={target.reveal}
        onClose={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

/** Focus mode over a live column reader — the arrangement TEST-34/35 describe. */
function Stacked({
  transport,
  onCloseFocus,
}: {
  readonly transport: ReaderTransport;
  readonly onCloseFocus?: () => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const [nav, setNav] = useState<readonly NavEntry[]>([{ docId: "doc_m", scrollY: 0 }]);
  const [focus, setFocus] = useState<string | null>(null);
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
          onFocusMode={setFocus}
          onNotify={() => undefined}
        />
      </div>
      <output data-depth>{nav.map((entry) => entry.docId).join(">")}</output>
      {focus === null ? null : (
        <FocusMode
          docId={focus}
          listTitle="Finance"
          onClose={() => {
            setFocus(null);
            onCloseFocus?.();
          }}
          onNotify={() => undefined}
        />
      )}
    </harness.Wrapper>
  );
}

function titleOf(root: ParentNode): string {
  return root.querySelector<HTMLInputElement>(".focus .doc-title")?.value ?? "";
}

describe("FocusMode", () => {
  it("is a full-viewport dialog with the prototype's chrome", async () => {
    render(<Solo transport={wire()} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    const overlay = document.querySelector(".focus");
    expect(overlay?.className).toBe("focus open");
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.querySelector(".focus-inner")).not.toBeNull();
    expect(overlay?.querySelector("[data-close-focus]")?.textContent).toBe("✕ Close");
    expect(overlay?.querySelector(".focus-hint")?.textContent).toBe(FOCUS_HINT);
    expect(overlay?.querySelector(".reader-id")?.textContent).toBe("doc_m · git ✓");
    expect(overlay?.querySelector(".save-chip")).not.toBeNull();
    expect(overlay?.querySelector("[data-doc-menu]")).not.toBeNull();
    // Already full screen: there is nothing for ⤢ to do.
    expect(overlay?.querySelector("[data-expand]")).toBeNull();
  });

  /**
   * UI-037. The reveal lives on the *shared* surface, so focus mode gets it for
   * the same reason it gets scroll restoration and the 💬 jump: one mechanism,
   * two hosts. A second implementation is how the two would drift.
   */
  it("honours a reveal on arrival, in the full-screen host too", async () => {
    render(<Solo transport={wire()} reveal={{ kind: "item", exact: "Compare against" }} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-reveal-flash]")).toHaveLength(1);
    });
  });

  it("honours a thread reveal by expanding and flashing the thread", async () => {
    render(<Solo transport={wire()} reveal={{ kind: "thread", threadId: "th_rate" }} />);
    await waitFor(() => {
      expect(document.querySelector(".focus .thread-slot.expanded")).not.toBeNull();
    });
    expect(document.querySelector(".focus .thread-card.flash")).not.toBeNull();
  });

  it("opens at the top when no reveal is given — the ordinary case, unchanged", async () => {
    render(<Solo transport={wire()} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });
    expect(document.querySelectorAll("[data-reveal-flash]")).toHaveLength(0);
    expect(document.querySelector(".focus .thread-slot.expanded")).toBeNull();
  });

  /**
   * PR #19 review. `docId` and `reveal` seeded the stack in a `useState`
   * initializer and were never read again, so a board that re-pointed an open
   * overlay changed nothing on screen — the seam was there and the props were
   * dropped.
   */
  it("follows its props when the board re-points an overlay that is already open", async () => {
    render(<Rewired transport={wire()} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    fireEvent.click(document.querySelector("[data-retarget]") as HTMLElement);

    await waitFor(() => {
      expect(titleOf(document)).toBe("Rates");
    });
    // The new instruction's reveal is honoured too, not just its document.
    await waitFor(() => {
      expect(document.querySelectorAll("[data-reveal-flash]")).toHaveLength(1);
    });
    // A new excursion, not a push onto the old one: Back goes to the list.
    expect(document.querySelector(".focus .back:not([data-close-focus])")).toBeNull();
  });

  it("names the hint after what it can actually do", () => {
    // The prototype's second clause became true with UI-006: the body below is
    // a live editor and clicking anywhere in it does place a caret.
    expect(FOCUS_HINT).toBe("esc closes · click anywhere to edit");
  });

  it("keeps its own stack: navigating in focus leaves the column's history alone", async () => {
    render(<Stacked transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector("[data-depth]")?.textContent).toBe("doc_m");
    });

    fireEvent.click(document.querySelector("[data-expand]:not([data-doc-menu])") as HTMLElement);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    const refs = [...document.querySelectorAll(".focus .ref")] as HTMLElement[];
    fireEvent.click(refs[0] as HTMLElement);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Rates");
    });

    // The column behind it never moved.
    expect(document.querySelector("[data-depth]")?.textContent).toBe("doc_m");
    expect(document.querySelector(".col.reading .doc-title")).not.toBeNull();
  });

  /**
   * UI-022: at the bottom of the excursion a back button would just close the
   * overlay — the same act as the ✕ Close beside it. The prototype hides
   * `#focus-back` until the stack has depth, and so does this head.
   */
  it("carries ✕ Close alone at the bottom of its own stack", async () => {
    const onClose = vi.fn();
    render(<Solo transport={wire()} onClose={onClose} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    expect(document.querySelector(".focus [data-close-focus]")).not.toBeNull();
    expect(document.querySelector(".focus .back:not([data-close-focus])")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows Back once the excursion has depth, and it navigates rather than closes", async () => {
    const onClose = vi.fn();
    render(<Solo transport={wire()} onClose={onClose} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    fireEvent.click(document.querySelector(".focus .ref") as HTMLElement);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Rates");
    });

    const back = await waitFor(() => {
      const button = document.querySelector<HTMLElement>(".focus .back:not([data-close-focus])");
      expect(button?.textContent).toBe("‹ Mortgage options");
      return button as HTMLElement;
    });

    fireEvent.click(back);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });
    // Back within the excursion: the overlay is still open, and with the stack
    // back at its bottom the button is gone again.
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".focus .back:not([data-close-focus])")).toBeNull();
  });

  it("closes on ✕", async () => {
    const onClose = vi.fn();
    render(<Solo transport={wire()} onClose={onClose} />);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });
    fireEvent.click(document.querySelector("[data-close-focus]") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** SPEC.md §11: overlays and focus mode take precedence, then the column reader. */
  it("Escape closes the menu, then focus, then the column reader", async () => {
    const { container } = render(<Stacked transport={wire()} />);
    await waitFor(() => {
      expect(container.querySelector(".col.reading .doc-title")).not.toBeNull();
    });

    fireEvent.click(document.querySelector("[data-expand]:not([data-doc-menu])") as HTMLElement);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    fireEvent.click(document.querySelector(".focus [data-doc-menu]") as HTMLElement);
    expect(document.querySelector("[data-dm-pop]")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-dm-pop]")).toBeNull();
    expect(document.querySelector(".focus")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(document.querySelector(".focus")).toBeNull();
    });
    expect(container.querySelector(".reader")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(container.querySelector(".reader")).toBeNull();
    });
  });

  it("renders the same document view as the column reader", async () => {
    render(<Stacked transport={wire()} />);
    await waitFor(() => {
      expect(document.querySelector(".col.reading .doc-title")).not.toBeNull();
    });
    fireEvent.click(document.querySelector("[data-expand]:not([data-doc-menu])") as HTMLElement);
    await waitFor(() => {
      expect(titleOf(document)).toBe("Mortgage options");
    });

    // Same anatomy in both hosts: chips, title, body, thread slots, menu.
    for (const selector of [".fm-chips", ".doc-title", ".doc-body", ".thread-slot"]) {
      expect(document.querySelector(`.focus ${selector}`)).not.toBeNull();
      expect(document.querySelector(`.col.reading ${selector}`)).not.toBeNull();
    }
    expect(screen.getAllByLabelText("Document actions")).toHaveLength(2);
  });
});
