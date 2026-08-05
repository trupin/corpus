/** @vitest-environment jsdom */
import type { Doc, DocRow, ResolvedAnchor } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { NavEntry } from "../board/useBoardLocalState.js";
import { Reader } from "../reader/Reader.js";
import { resetEscapeLayers } from "../reader/useEscapeStack.js";
import {
  docFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture.js";
import { resetTraceCache } from "./traceCache.js";

/**
 * Anchors in a real reader, against the real transport: the server's ranges
 * arrive as JSON, the editor renders them as decorations, and the chips are
 * widgets between the blocks they belong to.
 *
 * jsdom has no layout, so what is *not* here is anything that needs
 * `coordsAtPos` — the selection toolbar and the popover's placement are
 * verified in the browser (the issue's E2E log) and in
 * `CommentPopover.test.tsx`.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
  resetTraceCache();
});

const BODY = "The rate assumption is 6.1% today.\n\nThe second paragraph mentions Friday.\n";

function anchorAt(quote: string, overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor {
  const start = BODY.indexOf(quote);
  return {
    anchorId: "anc_1",
    threadId: "th_1",
    threadStatus: "open",
    selector: { exact: quote, prefix: "", suffix: "" },
    range: { start, end: start + quote.length },
    orphaned: false,
    ...overrides,
  };
}

function docWith(anchors: readonly ResolvedAnchor[]): Doc {
  return docFixture({
    frontmatter: { id: "doc_m", title: "Mortgage options" },
    body: BODY,
    anchors: [...anchors],
  });
}

function row(overrides: Partial<DocRow> = {}): DocRow {
  return threadRowFixture({
    id: "th_1",
    parent: "doc_m",
    anchorQuote: "6.1%",
    turnCount: 3,
    lastAuthor: "agent",
    ...overrides,
  });
}

interface HostProps {
  readonly wire: ReaderTransport;
}

function Host({ wire }: HostProps): ReactElement {
  const [nav, setNav] = useState<readonly NavEntry[]>([{ docId: "doc_m", scrollY: 0 }]);
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  return (
    <harness.Wrapper>
      <div className="col reading">
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

function mount(doc: Doc, rows: readonly DocRow[]): ReaderTransport {
  const wire = readerTransport({
    docs: [doc],
    threads: [
      threadFixture({
        id: "th_1",
        parent: "doc_m",
        anchor: "anc_1",
        turns: [{ author: "user", ts: "2026-07-02T09:00:00.000Z", body: "Where is this from?" }],
      }),
    ],
    rows: { [threadsSearch("doc_m")]: rows },
  });
  render(<Host wire={wire} />);
  return wire;
}

function highlights(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".anchor-hl")];
}

describe("a resolved anchor", () => {
  it("renders as a highlight over the words the server named", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    await waitFor(() => {
      expect(highlights()).toHaveLength(1);
    });
    const highlight = highlights()[0];
    expect(highlight?.textContent).toContain("6.1%");
    expect(highlight?.getAttribute("data-thread")).toBe("th_1");
    expect(highlight?.getAttribute("data-anchor")).toBe("anc_1");
    // Drawn *over* the editable body, not beside it.
    expect(highlight?.closest(".doc-body")).not.toBeNull();
  });

  it("carries a pip showing the thread's turn count", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    await waitFor(() => {
      expect(document.querySelector(".anchor-pip")).not.toBeNull();
    });
    expect(document.querySelector(".anchor-pip")?.textContent).toBe("3");
  });

  it("reads as resolved when its thread is", async () => {
    mount(docWith([anchorAt("6.1%", { threadStatus: "resolved" })]), [row({ status: "resolved" })]);
    await waitFor(() => {
      expect(document.querySelector(".anchor-hl.resolved")).not.toBeNull();
    });
    expect(document.querySelector(".anchor-pip.resolved")).not.toBeNull();
  });

  it("leaves nothing in the document the editor would save", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    await waitFor(() => {
      expect(highlights()).toHaveLength(1);
    });
    const body = document.querySelector<HTMLElement>(".doc-body")?.cloneNode(true) as HTMLElement;
    // Strip the two things that are decorations rather than text — the pip and
    // the chip's host — and what is left is the document, unchanged. Nothing
    // the highlight added is inside a text node.
    for (const widget of body.querySelectorAll(".anchor-pip, .anchor-slot")) widget.remove();
    expect(body.textContent).toBe(
      "The rate assumption is 6.1% today.The second paragraph mentions Friday.",
    );
    expect(body.querySelector("[data-corpus-raw]")).toBeNull();
  });
});

describe("the chip at the anchor", () => {
  it("renders in the body, between the blocks its anchor sits in", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    const chip = await screen.findByRole("button", { name: /💬 3 · agent/u });
    expect(chip.className).toBe("t-chip");
    const slot = chip.closest(".anchor-slot");
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute("data-anchor-slot")).toBe("th_1");
    expect(slot?.closest(".doc-body")).not.toBeNull();
  });

  it("labels a resolved thread as resolved", async () => {
    mount(docWith([anchorAt("6.1%", { threadStatus: "resolved" })]), [row({ status: "resolved" })]);
    const chip = await screen.findByRole("button", { name: /💬 3 · agent · resolved/u });
    expect(chip.className).toBe("t-chip resolved-chip");
  });

  it("expands in place, and marks the thread seen exactly once", async () => {
    const wire = mount(docWith([anchorAt("6.1%")]), [row()]);
    const chip = await screen.findByRole("button", { name: /💬 3 · agent/u });
    expect(wire.of("POST", "/api/threads/th_1/seen")).toHaveLength(0);

    fireEvent.click(chip);
    await waitFor(() => {
      expect(document.querySelector(".thread-slot.expanded")).not.toBeNull();
    });
    await waitFor(() => {
      expect(wire.of("POST", "/api/threads/th_1/seen")).toHaveLength(1);
    });

    // And the `–` control folds it back into the chip.
    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));
    await waitFor(() => {
      expect(document.querySelector(".thread-slot.expanded")).toBeNull();
    });
    expect(wire.of("POST", "/api/threads/th_1/seen")).toHaveLength(1);
  });

  it("opens from a click on the highlight itself", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    await waitFor(() => {
      expect(highlights()).toHaveLength(1);
    });
    const highlight = highlights()[0];
    // ProseMirror resolves the click position from layout, which jsdom does not
    // have; the plugin's handler is what the browser calls, and it is unit
    // tested. Here the chip is what the reader clicks.
    expect(highlight?.getAttribute("data-thread")).toBe("th_1");
  });
});

describe("threads with no anchor", () => {
  it("lists a whole-document thread below the body", async () => {
    mount(docWith([]), [row({ anchorQuote: null })]);
    const section = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-thread-section="whole-document"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(section?.textContent).toContain("Whole-document threads");
    expect(highlights()).toHaveLength(0);
  });

  it("lists an orphaned thread as detached, with no highlight left behind", async () => {
    mount(docWith([anchorAt("6.1%", { orphaned: true, range: null })]), [row()]);
    await waitFor(() => {
      expect(document.querySelector('[data-thread-section="detached"]')).not.toBeNull();
    });
    expect(highlights()).toHaveLength(0);
    // Still fully usable: the chip is there, and its quote survived.
    expect(screen.getByRole("button", { name: /💬 3 · agent/u })).toBeTruthy();
  });

  it("shows no section at all when there are none", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    await waitFor(() => {
      expect(highlights()).toHaveLength(1);
    });
    expect(document.querySelector("[data-thread-section]")).toBeNull();
  });

  /**
   * UI-062. A live anchor the view cannot point at is listed below the body,
   * like the ones that hang off no text — and specifically **not** drawn at the
   * top of the document, which is where a margin card with no highlight to
   * measure used to land.
   */
  it("lists an anchor it cannot point at, apart from the detached ones", async () => {
    mount(docWith([anchorAt("6.1%", { range: { start: 900, end: 910 } })]), [row()]);
    const section = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-thread-section="unplaced"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(section?.textContent).toContain("Threads without a place in this view");
    expect(highlights()).toHaveLength(0);
    // Not reported as a loss the server has not reported.
    expect(document.querySelector('[data-thread-section="detached"]')).toBeNull();
  });

  /**
   * UI-062's other half: the file carries the blank line every editor leaves
   * after the frontmatter fence, so every offset in it is one past where the
   * editor's own text would put it. The highlight still lands on the quote.
   */
  it("still highlights a document the editor would print differently", async () => {
    const body = `\n${BODY}`;
    const start = body.indexOf("6.1%");
    mount(
      docFixture({
        frontmatter: { id: "doc_m", title: "Mortgage options" },
        body,
        anchors: [anchorAt("6.1%", { range: { start, end: start + 4 } })],
      }),
      [row()],
    );
    await waitFor(() => {
      expect(highlights()).toHaveLength(1);
    });
    expect(highlights()[0]?.textContent).toBe("6.1%");
    expect(document.querySelector("[data-thread-section]")).toBeNull();
  });
});

describe("the layout", () => {
  it("adds no margin gutter to a document with no anchors", async () => {
    mount(docWith([]), []);
    await waitFor(() => {
      expect(document.querySelector(".doc-body")).not.toBeNull();
    });
    expect(document.querySelector(".with-margin")).toBeNull();
    expect(document.querySelector(".focus-margin")).toBeNull();
  });

  it("keeps a narrow column in chip mode", async () => {
    mount(docWith([anchorAt("6.1%")]), [row()]);
    await screen.findByRole("button", { name: /💬 3 · agent/u });
    // jsdom reports every element as zero-width, which is narrower than the
    // 1100px threshold — the case a column reader is in.
    expect(document.querySelector(".with-margin")).toBeNull();
  });
});
