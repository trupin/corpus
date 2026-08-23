import { describe, expect, it } from "vitest";
import { viewRow } from "../testing/boardFixture";
import { columnTabs, tabKeys } from "./columnTabs";
import { EMPTY_BOARD_STRIP, type BoardStrip, type StripItem } from "./strip";
import { toBoardColumn, type BoardColumn } from "./viewDoc";

/**
 * UI-151 — SPEC.md §10, rider 4: the strip is derived from the board's own
 * strip, so what it lists and how it groups are the board's answers, not a
 * second opinion.
 */

const inbox = toBoardColumn(
  "doc_view_inbox",
  viewRow({ id: "doc_view_inbox", title: "Inbox", query: { folder: "inbox" } }),
);
const threads = toBoardColumn(
  "doc_view_threads",
  viewRow({ id: "doc_view_threads", title: "Open threads", query: { type: "thread" } }),
);
const COLUMNS: readonly BoardColumn[] = [inbox, threads];

function stripOf(items: readonly StripItem[]): BoardStrip {
  return { seq: 9, strip: items };
}

const queryItem = (view: string, nav: readonly { docId: string; scrollY: number }[] = []) =>
  ({ kind: "query", view, scroll: 0, nav }) as const;

describe("columnTabs", () => {
  it("gives one tab per query column, in strip order, with the view's kind and title", () => {
    const entries = columnTabs(
      stripOf([queryItem("doc_view_threads"), queryItem("doc_view_inbox")]),
      COLUMNS,
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["query", "query"]);
    expect(tabKeys(entries)).toEqual(["doc_view_threads", "doc_view_inbox"]);
    expect(entries[0]).toMatchObject({
      kind: "query",
      tab: { key: "doc_view_threads", docId: null, badge: "view", title: "Open threads" },
    });
    // Rider 4: only a path tab closes from the strip.
    expect(entries.every((entry) => entry.kind === "query" && !entry.tab.closable)).toBe(true);
  });

  it("names the open document when a query column is showing its in-place reader", () => {
    const entries = columnTabs(
      stripOf([queryItem("doc_view_inbox", [{ docId: "doc_alpha", scrollY: 0 }])]),
      COLUMNS,
    );

    expect(entries[0]).toMatchObject({ kind: "query", tab: { docId: "doc_alpha" } });
    // The view's own name is what the tab says until the document arrives —
    // it moves no text into a box that is not the column it stands for.
    expect(entries[0]).toMatchObject({ kind: "query", tab: { title: "Inbox", badge: "folder" } });
  });

  it("groups a path's columns into one band labelled with its origin", () => {
    const entries = columnTabs(
      stripOf([
        queryItem("doc_view_inbox"),
        {
          kind: "path",
          id: 3,
          origin: { view: "doc_view_inbox", doc: "doc_alpha" },
          cols: [
            { stack: [{ docId: "doc_alpha", scrollY: 0 }] },
            { stack: [{ docId: "doc_beta", scrollY: 0 }] },
          ],
        },
        queryItem("doc_view_threads"),
      ]),
      COLUMNS,
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["query", "path", "query"]);
    expect(entries[1]).toMatchObject({ pathId: 3, loose: false, originTitle: "Inbox" });
    expect(tabKeys(entries)).toEqual([
      "doc_view_inbox",
      "path:3:0",
      "path:3:1",
      "doc_view_threads",
    ]);
    const path = entries[1];
    expect(path?.kind === "path" && path.tabs.map((tab) => tab.docId)).toEqual([
      "doc_alpha",
      "doc_beta",
    ]);
    expect(path?.kind === "path" && path.tabs.every((tab) => tab.closable)).toBe(true);
  });

  it("draws a path with no origin row as loose, with no origin title", () => {
    const entries = columnTabs(
      stripOf([
        { kind: "path", id: 1, origin: null, cols: [{ stack: [{ docId: "doc_x", scrollY: 0 }] }] },
        queryItem("doc_view_inbox"),
      ]),
      COLUMNS,
    );

    expect(entries[0]).toMatchObject({ kind: "path", loose: true, originTitle: null });
  });

  it("keeps a path dashed when its origin column is gone but the origin is not", () => {
    const entries = columnTabs(
      stripOf([
        {
          kind: "path",
          id: 2,
          origin: { view: "doc_view_archived", doc: "doc_alpha" },
          cols: [{ stack: [{ docId: "doc_alpha", scrollY: 0 }] }],
        },
      ]),
      COLUMNS,
    );

    expect(entries[0]).toMatchObject({ kind: "path", loose: false, originTitle: null });
  });

  it("skips a query item no rendered column answers for, exactly as the board does", () => {
    const entries = columnTabs(
      stripOf([queryItem("doc_view_gone"), queryItem("doc_view_inbox")]),
      COLUMNS,
    );

    expect(tabKeys(entries)).toEqual(["doc_view_inbox"]);
  });

  it("is empty for an empty board", () => {
    expect(columnTabs(EMPTY_BOARD_STRIP, COLUMNS)).toEqual([]);
    expect(tabKeys([])).toEqual([]);
  });
});
