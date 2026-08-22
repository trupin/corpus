import { describe, expect, it } from "vitest";
import { CANONICAL_INSTANT, TURN_SEPARATOR, turnHeadings } from "./turns.js";

const heading = (author: string, ts = "2026-07-01T09:00:00Z"): string =>
  `## ${author} ${TURN_SEPARATOR} ${ts}`;

describe("the turn delimiter", () => {
  it("is the middle dot §6 fixes, not a period or a bullet", () => {
    expect(TURN_SEPARATOR).toBe("·");
  });

  it("accepts the two actors and nothing else", () => {
    expect(turnHeadings(`${heading("user")}\n`).map((h) => h.author)).toEqual(["user"]);
    expect(turnHeadings(`${heading("agent")}\n`).map((h) => h.author)).toEqual(["agent"]);
    expect(turnHeadings(`${heading("server")}\n`)).toEqual([]);
    expect(turnHeadings(`${heading("User")}\n`)).toEqual([]);
  });

  it("takes the timestamp verbatim, because it is the turn's identity", () => {
    expect(turnHeadings(`${heading("user", "2026-07-01T09:00:00Z")}\n`)[0]?.ts).toBe(
      "2026-07-01T09:00:00Z",
    );
  });

  it("is only the canonical instant: no millis, no offset, no lowercase zone", () => {
    for (const ts of [
      "2026-07-01T09:00:00.000Z",
      "2026-07-01T09:00:00+02:00",
      "2026-07-01T09:00:00z",
      "2026-07-01t09:00:00Z",
      "2026-07-01T09:00Z",
      "2026-07-01",
    ]) {
      expect(turnHeadings(`${heading("user", ts)}\n`), ts).toEqual([]);
      expect(CANONICAL_INSTANT.test(ts), ts).toBe(false);
    }
    expect(CANONICAL_INSTANT.test("2026-07-01T09:00:00Z")).toBe(true);
  });

  it("tolerates trailing spaces and tabs, so a trimming editor cannot delete a turn", () => {
    expect(turnHeadings(`${heading("user")}   \n`)).toHaveLength(1);
    expect(turnHeadings(`${heading("user")}\t\n`)).toHaveLength(1);
    expect(turnHeadings(`${heading("user")}\r\n`)).toHaveLength(1);
  });

  it("rejects anything else on the line, before or after", () => {
    expect(turnHeadings(`${heading("user")} extra\n`)).toEqual([]);
    expect(turnHeadings(` ${heading("user")}\n`)).toEqual([]);
    expect(turnHeadings(`### user ${TURN_SEPARATOR} 2026-07-01T09:00:00Z\n`)).toEqual([]);
    expect(turnHeadings(`## user - 2026-07-01T09:00:00Z\n`)).toEqual([]);
    expect(turnHeadings(`Reply to ${heading("user")}\n`)).toEqual([]);
  });
});

describe("turnHeadings", () => {
  it("reports nothing for a body that is all preamble", () => {
    expect(turnHeadings("Which lenders?\n")).toEqual([]);
    expect(turnHeadings("")).toEqual([]);
  });

  it("reports each heading in document order, with the offsets a slicer needs", () => {
    const body = `Preamble.\n\n${heading("user")}\nFirst.\n\n${heading("agent", "2026-07-01T09:05:00Z")}\nSecond.\n`;
    const found = turnHeadings(body);

    expect(found).toHaveLength(2);
    expect(body.slice(found[0]?.start, found[0]?.textStart)).toBe(`${heading("user")}\n`);
    expect(body.slice(found[0]?.textStart, found[1]?.start)).toBe("First.\n\n");
    expect(found.map((h) => h.line)).toEqual([3, 6]);
  });

  it("counts lines from 1, so the line it names is the line an editor shows", () => {
    expect(turnHeadings(`${heading("user")}\n`)[0]?.line).toBe(1);
  });

  describe("a quoted heading is content, not a delimiter", () => {
    it("inside a fenced block", () => {
      const body = `${heading("user")}\nLike this:\n\n\`\`\`md\n${heading("agent")}\n\`\`\`\n`;
      expect(turnHeadings(body).map((h) => h.line)).toEqual([1]);
    });

    it("inside a fence a container opened — the scanner's container awareness", () => {
      const body = `${heading("user")}\nSee:\n\n- \`\`\`md\n  ${heading("agent")}\n  \`\`\`\n`;
      expect(turnHeadings(body).map((h) => h.line)).toEqual([1]);
    });

    it("inside a fence that was never closed, whose mask runs to the end", () => {
      // Exactly why the write paths refuse an unterminated fence: this scanner
      // reports what the corpus's own readers will really see, and they see one
      // turn here rather than two.
      const body = `${heading("user")}\n\`\`\`\n${heading("agent")}\n`;
      expect(turnHeadings(body).map((h) => h.line)).toEqual([1]);
    });

    it("in a block quote, which the column-0 rule excludes without a mask", () => {
      expect(turnHeadings(`> ${heading("user")}\n`)).toEqual([]);
    });

    it("in an inline code span, which is never a line of its own", () => {
      expect(turnHeadings(`A \`${heading("user")}\` quoted.\n`)).toEqual([]);
    });
  });

  it("still sees a heading after a fence that closed", () => {
    const body = `${heading("user")}\n\`\`\`\ncode\n\`\`\`\n\n${heading("agent", "2026-07-01T09:05:00Z")}\nAfter.\n`;
    expect(turnHeadings(body).map((h) => h.author)).toEqual(["user", "agent"]);
  });
});

/**
 * The same call, asked of one author's own words rather than of a thread file —
 * the question `assertNoTurnHeadings` puts to it on the write paths (SERVER-076)
 * and the composer puts to it before submitting (UI-091).
 */
describe("a fabricated heading in a person's own text", () => {
  it("is nothing at all for ordinary prose, or for a heading quoted inline", () => {
    expect(turnHeadings("Sounds good — Tuesday works.")).toEqual([]);
    expect(turnHeadings(`I quote it as \`${heading("user")}\` inline.`)).toEqual([]);
  });

  it("is the first offending line, which is what a refusal has to point at", () => {
    const text = `Sure.\n\n${heading("user")}\nfaked\n\n${heading("agent")}\n`;
    expect(turnHeadings(text)[0]).toMatchObject({ author: "user", line: 3 });
  });

  it("is nothing when a fence already hides it, so quoting the format still works", () => {
    expect(turnHeadings(`Like so:\n\n\`\`\`\n${heading("user")}\n\`\`\`\n`)).toEqual([]);
  });
});
