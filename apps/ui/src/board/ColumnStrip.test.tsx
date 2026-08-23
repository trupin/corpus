/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactElement, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTransport, viewRow } from "../testing/boardFixture";
import { ColumnStrip } from "./ColumnStrip";
import { type BoardStrip, type StripItem } from "./strip";
import { toBoardColumn, type BoardColumn } from "./viewDoc";

/**
 * UI-151 — the strip, drawn (SPEC.md §10, rider 4;
 * `design/navigation.html`'s `renderColbar`).
 */

afterEach(cleanup);

const inbox = toBoardColumn(
  "doc_view_inbox",
  viewRow({ id: "doc_view_inbox", title: "Inbox", query: { folder: "inbox" } }),
);
const threads = toBoardColumn(
  "doc_view_threads",
  viewRow({ id: "doc_view_threads", title: "Open threads", query: { type: "thread" } }),
);
const COLUMNS: readonly BoardColumn[] = [inbox, threads];

const PATH: StripItem = {
  kind: "path",
  id: 4,
  origin: { view: "doc_view_inbox", doc: "doc_alpha" },
  cols: [
    { stack: [{ docId: "doc_alpha", scrollY: 0 }] },
    { stack: [{ docId: "doc_beta", scrollY: 0 }] },
  ],
};

const FULL: BoardStrip = {
  seq: 5,
  strip: [
    { kind: "query", view: "doc_view_inbox", scroll: 0, nav: [] },
    PATH,
    { kind: "query", view: "doc_view_threads", scroll: 0, nav: [] },
  ],
};

function renderStrip(overrides: Partial<Parameters<typeof ColumnStrip>[0]> = {}): {
  readonly container: HTMLElement;
  readonly onGo: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
} {
  const onGo = vi.fn();
  const onClose = vi.fn();
  const boardRef: RefObject<HTMLElement | null> = createRef<HTMLElement>();
  const harness = createCorpusTestHarness({ fetch: boardTransport().fetch });
  function Tree(): ReactElement {
    return (
      <harness.Wrapper>
        <ColumnStrip
          strip={FULL}
          columns={COLUMNS}
          boardRef={boardRef}
          activeKey={null}
          onGo={onGo}
          onClose={onClose}
          {...overrides}
        />
      </harness.Wrapper>
    );
  }
  const { container } = render(<Tree />);
  return { container, onGo, onClose };
}

const tabKeysIn = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(".colbar .ctab")].map(
    (tab) => tab.dataset["col"] ?? "",
  );

describe("ColumnStrip", () => {
  it("lists one tab per column in board order, path tabs inside their band", () => {
    const { container } = renderStrip();

    expect(tabKeysIn(container)).toEqual([
      "doc_view_inbox",
      "path:4:0",
      "path:4:1",
      "doc_view_threads",
    ]);
    // The band is the group, exactly as the board groups the same columns.
    const group = container.querySelector(".colbar .cgroup");
    expect(group?.className).toBe("cgroup");
    expect(group?.querySelectorAll(".ctab")).toHaveLength(2);
    expect(group?.querySelector(".cfrom")?.textContent).toContain("Inbox");
  });

  it("draws a query tab in the sans face and a path tab in the serif one", () => {
    const { container } = renderStrip();

    expect(container.querySelector('.ctab[data-col="doc_view_inbox"]')?.className).toContain("q");
    expect(container.querySelector('.ctab[data-col="path:4:0"]')?.className).toContain("p");
  });

  it("names a query column with its view's kind and title", () => {
    const { container } = renderStrip();
    const tab = container.querySelector('.ctab[data-col="doc_view_inbox"]');

    // `folder:` scopes this one, which is the kind its own header shows.
    expect(tab?.querySelector(".ck")?.textContent).toBe("folder");
    expect(tab?.querySelector(".ct")?.textContent).toBe("Inbox");
    expect(container.querySelector('.ctab[data-col="doc_view_threads"] .ck')?.textContent).toBe(
      "view",
    );
  });

  it("names a path column with the document's type and title once it arrives", async () => {
    const { container } = renderStrip();

    await waitFor(() => {
      expect(container.querySelector('.ctab[data-col="path:4:0"] .ct')?.textContent).toBe(
        "Fixture document",
      );
    });
    expect(container.querySelector('.ctab[data-col="path:4:0"] .ck')?.textContent).toBe("note");
  });

  it("scrolls to a column when its tab is clicked", () => {
    const { container, onGo } = renderStrip();

    fireEvent.click(container.querySelector('.ctab[data-col="path:4:1"] .ctab-go') as HTMLElement);

    expect(onGo).toHaveBeenCalledWith("path:4:1");
  });

  it("outlines the active tab and nothing else", () => {
    const { container } = renderStrip({ activeKey: "path:4:1" });

    expect(
      [...container.querySelectorAll<HTMLElement>(".ctab.on")].map((tab) => tab.dataset["col"]),
    ).toEqual(["path:4:1"]);
    expect(
      container.querySelector('.ctab[data-col="path:4:1"] .ctab-go')?.getAttribute("aria-current"),
    ).toBe("true");
  });

  it("closes a path column and everything after it from its ✕, and offers none on a query tab", () => {
    const { container, onClose } = renderStrip();

    expect(container.querySelectorAll('.ctab[data-col="doc_view_inbox"] .cx')).toHaveLength(0);
    fireEvent.click(container.querySelector('.ctab[data-col="path:4:0"] .cx') as HTMLElement);

    expect(onClose).toHaveBeenCalledWith(4, 0);
  });

  it("shows a loose path's band with no origin", () => {
    const { container } = renderStrip({
      strip: {
        seq: 2,
        strip: [
          { kind: "path", id: 1, origin: null, cols: [{ stack: [{ docId: "d", scrollY: 0 }] }] },
        ],
      },
    });

    const group = container.querySelector(".cgroup");
    expect(group?.className).toContain("loose");
    expect(group?.getAttribute("aria-label")).toBe("Loose path");
    expect(group?.querySelector(".cfrom")?.textContent).toContain("path");
  });

  it("renders an empty strip for a board with no columns, so the CSS can hide it", () => {
    const { container } = renderStrip({ strip: { seq: 1, strip: [] } });

    expect(screen.getByLabelText("Columns").childElementCount).toBe(0);
    expect(container.querySelectorAll(".ctab")).toHaveLength(0);
  });
});
