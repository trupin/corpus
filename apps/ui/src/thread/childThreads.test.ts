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
