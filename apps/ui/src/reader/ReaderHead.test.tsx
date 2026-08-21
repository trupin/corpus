/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import {
  backLabel,
  backTitle,
  readerIdText,
  ReaderHead,
  showsBack,
  type ReaderHeadProps,
} from "./ReaderHead";
import type { NavEntry } from "./useNavStack";

/**
 * The shared head, at the one place its two hosts genuinely differ: the back
 * button (UI-022). Everything else about the head is asserted where it is used
 * — `Reader.test.tsx` for the column, `FocusMode.test.tsx` for the overlay.
 */

afterEach(cleanup);

const PREVIOUS = docFixture({ frontmatter: { id: "doc_m", title: "Mortgage options" } });

function wire(): ReaderTransport {
  return readerTransport({ docs: [PREVIOUS] });
}

type HostProps = Partial<ReaderHeadProps> & { readonly transport?: ReaderTransport };

function Host({ transport, ...overrides }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: (transport ?? wire()).fetch }));
  return (
    <harness.Wrapper>
      <ReaderHead
        docId="doc_r"
        doc={undefined}
        threads={[]}
        threadStatus={null}
        previous={null}
        listTitle="Finance"
        onBack={() => undefined}
        tab="document"
        onTab={() => undefined}
        onGone={() => undefined}
        onNotify={() => undefined}
        {...overrides}
      />
    </harness.Wrapper>
  );
}

/** The back button, never the ✕ Close that shares its class in focus mode. */
function backButton(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".back:not([data-close-focus])");
}

const CLOSE = (
  <button type="button" className="back" data-close-focus>
    ✕ Close
  </button>
);

const DEPTH: NavEntry = { docId: "doc_m", scrollY: 0 };

describe("showsBack", () => {
  it.each([
    ["column", null, true],
    ["column", DEPTH, true],
    ["focus", null, false],
    ["focus", DEPTH, true],
    [undefined, null, true],
  ] as const)("%s variant with previous %j → %s", (variant, previous, expected) => {
    expect(showsBack(variant, previous)).toBe(expected);
  });
});

describe("backLabel", () => {
  it("names the list when there is no depth, and the previous document when there is", () => {
    expect(backLabel(null, null, "Finance")).toBe("‹ Finance");
    expect(backLabel(DEPTH, "Mortgage options", "Finance")).toBe("‹ Mortgage options");
    // A document whose title is blank is still identifiable by its id.
    expect(backLabel(DEPTH, "   ", "Finance")).toBe("‹ doc_m");
  });
});

describe("ReaderHead's back button", () => {
  it("is dropped in focus mode at the bottom of the stack: ✕ Close is the way out", () => {
    const { container } = render(<Host variant="focus" leading={CLOSE} hint="esc closes" />);
    expect(container.querySelector("[data-close-focus]")?.textContent).toBe("✕ Close");
    expect(backButton(container)).toBeNull();
  });

  it("returns in focus mode with depth, named after the previous document", async () => {
    const onBack = vi.fn();
    const { container } = render(
      <Host variant="focus" leading={CLOSE} previous={DEPTH} onBack={onBack} />,
    );
    await waitFor(() => {
      expect(backButton(container)?.textContent).toBe("‹ Mortgage options");
    });

    fireEvent.click(backButton(container) as HTMLElement);
    // Back within the excursion, not out of it — that is what ✕ Close does.
    expect(onBack).toHaveBeenCalledWith(false);
    expect(container.querySelector("[data-close-focus]")).not.toBeNull();
  });

  it("is always there in a column, where it is the only way back to the list", () => {
    const { container } = render(<Host />);
    expect(backButton(container)?.textContent).toBe("‹ Finance");
    // The whole label leads, because the button truncates it (UI-135); the hint
    // that used to be the entire tooltip follows.
    expect(backButton(container)?.getAttribute("title")).toBe("‹ Finance — Back to list");
    expect(container.querySelector("[data-close-focus]")).toBeNull();
  });

  it("still empties the column's stack on a shift-click", () => {
    const onBack = vi.fn();
    const { container } = render(<Host onBack={onBack} />);
    fireEvent.click(backButton(container) as HTMLElement, { shiftKey: true });
    expect(onBack).toHaveBeenCalledWith(true);
  });
});

/**
 * The head is a fixed box holding text of unknown length (UI-135, SPEC.md §11).
 * The geometry that makes that work is asserted in a real browser
 * (`e2e/reader-head-geometry.spec.ts`); what this file owes it is the pair of
 * `title`s, because a truncation with nothing behind it is a value quietly cut.
 */
describe("what a truncated head reveals (SHARED-057 clause 2)", () => {
  it("puts the whole back label ahead of the hint on the tooltip", () => {
    expect(backTitle("‹ Finance", null)).toBe("‹ Finance — Back to list");
    expect(backTitle("‹ Mortgage options", DEPTH)).toBe(
      "‹ Mortgage options — Back (shift-click, or ⇧esc: straight to list)",
    );
  });

  it("carries the label in an element that can hold an ellipsis", async () => {
    const { container } = render(<Host previous={DEPTH} />);
    await waitFor(() => {
      expect(backButton(container)?.querySelector(".back-label")?.textContent).toBe(
        "‹ Mortgage options",
      );
    });
    // The button is a flex row, where `text-overflow` reaches nothing.
    expect(backButton(container)?.textContent).toBe("‹ Mortgage options");
  });

  it("reveals the whole document id, which the head also truncates", () => {
    expect(readerIdText("doc_r")).toBe("doc_r · git ✓");
    const { container } = render(<Host docId="doc_a_very_long_identifier" />);
    const id = container.querySelector(".reader-id");
    expect(id?.textContent).toBe("doc_a_very_long_identifier · git ✓");
    expect(id?.getAttribute("title")).toBe("doc_a_very_long_identifier · git ✓");
  });
});
