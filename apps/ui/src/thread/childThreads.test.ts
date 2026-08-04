import type { ResolvedAnchor } from "@corpus/contract";
import type { ThreadTurn } from "@corpus/kit";
import { describe, expect, it } from "vitest";
import { threadRowFixture } from "../testing/readerFixture";
import { placeChildThreads, turnAnchorText } from "./childThreads";

const TURNS: readonly ThreadTurn[] = [
  { author: "user", ts: "1", body: "is 6.1% right?" },
  { author: "agent", ts: "2", body: "6.4% is closer.\n\nSee the table." },
];

describe("turnAnchorText", () => {
  it("anchors to the turn's first line of prose", () => {
    expect(turnAnchorText(TURNS[1] as ThreadTurn)).toBe("6.4% is closer.");
  });

  it("skips the attachment references the server appended", () => {
    expect(
      turnAnchorText({
        author: "user",
        ts: "3",
        body: "look at this\n\n![shot.png](attachments/th_a/t/shot.png)",
      }),
    ).toBe("look at this");
  });

  it("falls back to the whole body for an attachment-only turn", () => {
    expect(
      turnAnchorText({ author: "user", ts: "4", body: "![a.png](attachments/th_a/t/a.png)" }),
    ).toBe("");
  });

  it("caps the quote rather than anchoring a whole paragraph", () => {
    const long = "x".repeat(400);
    expect(turnAnchorText({ author: "user", ts: "5", body: long })).toHaveLength(160);
  });
});

describe("placeChildThreads", () => {
  it("hangs each child off the turn its anchor quotes", () => {
    const { byTurn, unanchored } = placeChildThreads(
      [
        threadRowFixture({ id: "th_x", anchorQuote: "6.4% is closer." }),
        threadRowFixture({ id: "th_y", anchorQuote: "is 6.1% right?" }),
      ],
      TURNS,
    );
    expect(byTurn.get("2")?.map((row) => row.id)).toEqual(["th_x"]);
    expect(byTurn.get("1")?.map((row) => row.id)).toEqual(["th_y"]);
    expect(unanchored).toHaveLength(0);
  });

  it("keeps several children under one turn, in order", () => {
    const { byTurn } = placeChildThreads(
      [
        threadRowFixture({ id: "th_a", anchorQuote: "is 6.1% right?" }),
        threadRowFixture({ id: "th_b", anchorQuote: "is 6.1%" }),
      ],
      TURNS,
    );
    expect(byTurn.get("1")?.map((row) => row.id)).toEqual(["th_a", "th_b"]);
  });

  /** A whole-thread comment, or one whose anchor went orphaned, is still shown. */
  it("lists a child with no usable quote rather than dropping it", () => {
    const { byTurn, unanchored } = placeChildThreads(
      [
        threadRowFixture({ id: "th_whole", anchorQuote: null }),
        threadRowFixture({ id: "th_orphan", anchorQuote: "text that is no longer there" }),
      ],
      TURNS,
    );
    expect(byTurn.size).toBe(0);
    expect(unanchored.map((row) => row.id)).toEqual(["th_whole", "th_orphan"]);
  });
});

/**
 * A phrase repeated across turns is the ordinary case once a comment can anchor
 * to a *phrase* rather than to a whole turn (UI-051) — a reply quoting the
 * question, an agent restating an assumption. The quote search puts every one of
 * them under the first turn that contains the words; the server's own resolved
 * range puts each under the turn it actually belongs to.
 */
describe("placeChildThreads, with the thread's own resolved anchors", () => {
  const REPEATED: readonly ThreadTurn[] = [
    { author: "user", ts: "1", body: "the rate is stale" },
    { author: "agent", ts: "2", body: "agreed, the rate is stale" },
  ];
  const BODY = "## user · 1\n\nthe rate is stale\n\n## agent · 2\n\nagreed, the rate is stale\n";
  const SECOND = BODY.indexOf("the rate is stale", BODY.indexOf("the rate is stale") + 1);

  function anchorFor(threadId: string, start: number): ResolvedAnchor {
    return {
      anchorId: "a_1",
      selector: { exact: "the rate is stale", prefix: "", suffix: "" },
      threadId,
      threadStatus: "open",
      range: { start, end: start + "the rate is stale".length },
      orphaned: false,
    };
  }

  it("puts a child under the turn the server resolved its anchor into", () => {
    const rows = [threadRowFixture({ id: "th_second", anchorQuote: "the rate is stale" })];
    const { byTurn } = placeChildThreads(rows, REPEATED, {
      body: BODY,
      anchors: [anchorFor("th_second", SECOND)],
    });
    expect(byTurn.get("2")?.map((row) => row.id)).toEqual(["th_second"]);
    expect(byTurn.has("1")).toBe(false);
  });

  it("is what the quote search would have got wrong", () => {
    const rows = [threadRowFixture({ id: "th_second", anchorQuote: "the rate is stale" })];
    // The same row, placed without the resolved range: the first turn wins.
    const { byTurn } = placeChildThreads(rows, REPEATED);
    expect(byTurn.get("1")?.map((row) => row.id)).toEqual(["th_second"]);
  });

  it("lists a child whose anchor the server declared orphaned", () => {
    const rows = [threadRowFixture({ id: "th_gone", anchorQuote: "the rate is stale" })];
    const { byTurn, unanchored } = placeChildThreads(rows, REPEATED, {
      body: BODY,
      anchors: [{ ...anchorFor("th_gone", 0), range: null, orphaned: true }],
    });
    // The server's verdict stands: falling through to the quote would overrule
    // it and re-attach a thread it declared detached.
    expect(byTurn.size).toBe(0);
    expect(unanchored.map((row) => row.id)).toEqual(["th_gone"]);
  });

  it("still uses the quote for a child the parent's anchors do not mention", () => {
    const rows = [threadRowFixture({ id: "th_other", anchorQuote: "agreed" })];
    const { byTurn } = placeChildThreads(rows, REPEATED, { body: BODY, anchors: [] });
    expect(byTurn.get("2")?.map((row) => row.id)).toEqual(["th_other"]);
  });
});
