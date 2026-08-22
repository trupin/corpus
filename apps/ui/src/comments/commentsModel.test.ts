import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import {
  ALL_COMMENTS,
  anchorReason,
  commentRowLabel,
  commentRows,
  countComments,
  emptyCommentsNotice,
  filterComments,
  threadMeta,
  threadQuote,
  type CommentFilters,
  type CommentRow,
} from "./commentsModel";

/**
 * The comments list's two axes (SPEC.md §10's rider, signed 2026-08-04).
 *
 * The case that matters most is the **orphan**, because it is the one a
 * plausible implementation gets wrong: `DocRow.anchorQuote` survives an anchor
 * going orphaned, so a list keyed on the quote reports every detached
 * conversation as anchored — and the open, unanchored comment is the row the
 * rider was written to surface.
 */

function threadRow(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    id: "th_1",
    type: "thread",
    title: "A conversation",
    path: "data/docs/threads/th_1.md",
    parent: "doc_m",
    turnCount: 2,
    lastAuthor: "agent",
    ...overrides,
  });
}

/** The one row a fixture built, without a cast: an empty list here is a broken test. */
function only(rows: readonly CommentRow[]): CommentRow {
  const entry = rows[0];
  if (entry === undefined) throw new Error("the fixture produced no rows");
  return entry;
}

function anchor(overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor {
  return {
    anchorId: "anc_1",
    threadId: "th_1",
    selector: { exact: "lender spreads", prefix: "", suffix: "" },
    threadStatus: "open",
    range: { start: 4, end: 18 },
    orphaned: false,
    ...overrides,
  };
}

describe("commentRows", () => {
  it("calls a conversation anchored only when its anchor resolves", () => {
    const rows = commentRows([threadRow()], [anchor()]);
    expect(rows[0]?.anchorState).toBe("anchored");
  });

  it("calls a detached one orphaned, though its stored quote is still there", () => {
    const row = threadRow({ anchorQuote: "lender spreads" });
    const rows = commentRows([row], [anchor({ orphaned: true, range: null })]);
    // The trap: the quote is present in both states, so a list keyed on it would
    // have said "anchored" here.
    expect(row.anchorQuote).not.toBeNull();
    expect(rows[0]?.anchorState).toBe("orphaned");
  });

  it("calls a conversation with no anchor entry at all unanchored", () => {
    const rows = commentRows([threadRow({ anchorQuote: null })], []);
    expect(rows[0]?.anchorState).toBe("unanchored");
    expect(rows[0]?.anchor).toBeNull();
  });

  it("keeps the projection's order rather than imposing one", () => {
    const rows = commentRows(
      [threadRow({ id: "th_b" }), threadRow({ id: "th_a" })],
      [anchor({ threadId: "th_a" })],
    );
    expect(rows.map((entry) => entry.row.id)).toEqual(["th_b", "th_a"]);
  });
});

describe("the two axes", () => {
  const rows = commentRows(
    [
      threadRow({ id: "th_open_anchored", status: "open" }),
      threadRow({ id: "th_done_anchored", status: "resolved" }),
      threadRow({ id: "th_open_orphan", status: "open", anchorQuote: "gone" }),
      threadRow({ id: "th_open_whole", status: "open", anchorQuote: null }),
    ],
    [
      anchor({ anchorId: "a1", threadId: "th_open_anchored" }),
      anchor({ anchorId: "a2", threadId: "th_done_anchored" }),
      anchor({ anchorId: "a3", threadId: "th_open_orphan", orphaned: true, range: null }),
    ],
  );

  it.each([
    [
      { status: "all", anchor: "all" },
      ["th_open_anchored", "th_done_anchored", "th_open_orphan", "th_open_whole"],
    ],
    [{ status: "open", anchor: "all" }, ["th_open_anchored", "th_open_orphan", "th_open_whole"]],
    [{ status: "resolved", anchor: "all" }, ["th_done_anchored"]],
    [{ status: "all", anchor: "anchored" }, ["th_open_anchored", "th_done_anchored"]],
    [{ status: "all", anchor: "unanchored" }, ["th_open_orphan", "th_open_whole"]],
    // The combination the rider is about: the question the document moved out
    // from under, and nobody has answered.
    [{ status: "open", anchor: "unanchored" }, ["th_open_orphan", "th_open_whole"]],
    [{ status: "resolved", anchor: "unanchored" }, []],
  ] as const)("%j leaves %j", (filters, expected) => {
    expect(filterComments(rows, filters as CommentFilters).map((entry) => entry.row.id)).toEqual(
      expected,
    );
  });

  it("counts every position over the whole list, so the axes stay independent", () => {
    expect(countComments(rows)).toEqual({
      all: 4,
      open: 3,
      resolved: 1,
      anchored: 2,
      unanchored: 2,
    });
  });

  it("treats an archived thread as not resolved, as the status chip does", () => {
    const archived = commentRows([threadRow({ status: "archived" })], []);
    expect(countComments(archived).open).toBe(1);
    expect(countComments(archived).resolved).toBe(0);
  });
});

describe("what an empty list says", () => {
  it("invites the first comment when there are none at all", () => {
    expect(emptyCommentsNotice(countComments([]), ALL_COMMENTS)).toBe(
      "No comments on this document yet. Write the first one below — no text selection needed.",
    );
  });

  it("names the filter and says how many it is hiding", () => {
    const rows = commentRows([threadRow({ id: "th_a" }), threadRow({ id: "th_b" })], []);
    expect(emptyCommentsNotice(countComments(rows), { status: "open", anchor: "anchored" })).toBe(
      "No open, anchored comments. 2 comments are hidden by these filters.",
    );
  });

  it("counts one comment in the singular", () => {
    const rows = commentRows([threadRow()], []);
    expect(emptyCommentsNotice(countComments(rows), { status: "all", anchor: "anchored" })).toBe(
      "No anchored comments. 1 comment is hidden by these filters.",
    );
  });
});

describe("why a row has no anchor", () => {
  it("says what an anchored one is anchored to", () => {
    const entry = only(commentRows([threadRow()], [anchor()]));
    expect(anchorReason(entry)).toBe("anchored to “lender spreads”");
  });

  it("says the document no longer contains a detached one's words", () => {
    const entry = only(commentRows([threadRow()], [anchor({ orphaned: true, range: null })]));
    expect(anchorReason(entry)).toBe("detached — the document no longer contains “lender spreads”");
  });

  it("says a whole-document remark never had one, rather than reporting a loss", () => {
    const entry = only(commentRows([threadRow({ anchorQuote: null })], []));
    expect(anchorReason(entry)).toBe("about the whole document — it never had an anchor");
  });

  it("flattens a quote that spans lines, so the row stays one line", () => {
    const entry = only(
      commentRows(
        [threadRow()],
        [anchor({ selector: { exact: "two\nlines", prefix: "", suffix: "" } })],
      ),
    );
    expect(anchorReason(entry)).toBe("anchored to “two lines”");
  });
});

describe("the popover's own two lines, carried over unchanged", () => {
  it("words the meta line as the prototype does", () => {
    expect(threadMeta(threadRow({ turnCount: 2, lastAuthor: "agent", status: "open" }))).toBe(
      "2 turns · last: agent · open",
    );
    expect(threadMeta(threadRow({ turnCount: 1, lastAuthor: "user", status: "resolved" }))).toBe(
      "1 turn · last: user · resolved",
    );
  });

  it("words the quote line as the prototype does", () => {
    expect(threadQuote(threadRow({ anchorQuote: "lender spreads" }))).toBe("“lender spreads”");
    expect(threadQuote(threadRow({ anchorQuote: null }))).toBe("whole-document thread");
  });

  it("names a row with both, which is what `.cp-item` read out", () => {
    expect(commentRowLabel(threadRow({ anchorQuote: "lender spreads" }))).toBe(
      "“lender spreads” — 2 turns · last: agent · open",
    );
  });
});
