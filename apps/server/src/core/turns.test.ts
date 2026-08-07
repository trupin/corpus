import { describe, expect, it, vi } from "vitest";
import {
  TURN_SEPARATOR,
  appendTurn,
  nextTurnTs,
  deleteTurn,
  duplicateTurnTimestamps,
  parseThreadBody,
  parseTurns,
} from "./turns.js";

const THREE_TURNS = `A preamble paragraph the composer wrote.

## user · 2026-07-19T10:05:00Z
@agent is 6.1% still the right assumption?

## agent · 2026-07-19T10:06:00Z
Checking current averages.

## user · 2026-07-19T10:07:12Z
Thanks.
`;

describe("parseThreadBody", () => {
  it("splits on the §6 heading grammar, keeping the preamble out of the turns", () => {
    const { preamble, turns } = parseThreadBody(THREE_TURNS);
    expect(preamble).toBe("A preamble paragraph the composer wrote.\n\n");
    expect(turns).toEqual([
      {
        author: "user",
        ts: "2026-07-19T10:05:00Z",
        body: "@agent is 6.1% still the right assumption?",
      },
      { author: "agent", ts: "2026-07-19T10:06:00Z", body: "Checking current averages." },
      { author: "user", ts: "2026-07-19T10:07:12Z", body: "Thanks." },
    ]);
  });

  it("treats a body with no headings as pure preamble", () => {
    expect(parseThreadBody("Just prose.\n")).toEqual({ preamble: "Just prose.\n", turns: [] });
  });

  it("keeps a blank turn body as an empty string", () => {
    expect(parseTurns("## user · 2026-07-19T10:05:00Z\n\n")[0]?.body).toBe("");
  });

  it("strips only the single blank line after the heading", () => {
    const body = "## user · 2026-07-19T10:05:00Z\n\n\nIndented start.\n";
    expect(parseTurns(body)[0]?.body).toBe("\nIndented start.");
  });

  it("uses the MIDDLE DOT separator, not a period or a bullet", () => {
    expect(TURN_SEPARATOR).toBe("·");
    expect(parseTurns("## user . 2026-07-19T10:05:00Z\nText\n")).toEqual([]);
    expect(parseTurns("## user • 2026-07-19T10:05:00Z\nText\n")).toEqual([]);
  });

  it("rejects an author that is not `user` or `agent`", () => {
    expect(parseTurns("## robot · 2026-07-19T10:05:00Z\nText\n")).toEqual([]);
  });

  it("rejects a non-canonical timestamp in a heading", () => {
    expect(parseTurns("## user · 2026-07-19T10:05:00.000Z\nText\n")).toEqual([]);
    expect(parseTurns("## user · 2026-07-19T10:05Z\nText\n")).toEqual([]);
  });

  it("tolerates trailing whitespace on a heading line", () => {
    expect(parseTurns("## user · 2026-07-19T10:05:00Z  \nText\n")).toHaveLength(1);
  });

  it("does not split a turn on a heading inside a fenced code block", () => {
    const body = `## user · 2026-07-19T10:05:00Z
The format looks like this:

\`\`\`md
## user · 2026-01-01T00:00:00Z
a turn body
\`\`\`
`;
    const turns = parseTurns(body);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.body).toContain("## user · 2026-01-01T00:00:00Z");
    expect(turns[0]?.body).toContain("```md");
  });

  it("parses turns in a CRLF body", () => {
    expect(parseTurns(THREE_TURNS.replaceAll("\n", "\r\n"))).toHaveLength(3);
  });

  /**
   * SERVER-066's measurement, pinned. The parser is **not** made tolerant of an
   * unclosed fence — the exclusion above is what lets a turn quote the turn
   * format, and a parser that guessed where the code "really" ended would break
   * it. So this asserts the loss rather than a fix: the shape a user actually hit
   * (a closing run sharing a line with the content) yields one turn where the
   * corrected shape yields two, with the reply folded into the turn before it.
   * `core/check.ts`'s `unterminated-fence` finding is what makes that visible;
   * this test is what fails if anyone ever "fixes" it here instead.
   */
  it("loses every later turn to a fence whose closing run shares a line with the content", () => {
    const swallowing = [
      "## agent · 2026-07-19T10:06:00Z",
      "",
      "Here is the snippet:",
      "",
      "```",
      "const x = 1;```",
      "",
      "## user · 2026-07-19T10:07:12Z",
      "",
      "Actually, no.",
      "",
    ].join("\n");
    const corrected = swallowing.replace("const x = 1;```", "const x = 1;\n```");

    expect(parseTurns(swallowing).map((turn) => turn.author)).toEqual(["agent"]);
    expect(parseTurns(corrected).map((turn) => turn.author)).toEqual(["agent", "user"]);
    expect(parseTurns(swallowing)[0]?.body).toContain("Actually, no.");
  });
});

describe("nextTurnTs", () => {
  it("answers the stamp `appendTurn` will use, so attachments can name the directory first", () => {
    for (const requested of [
      "2026-07-19T10:09:00Z",
      "2026-07-19T10:07:12Z",
      "2026-07-19T09:00:00Z",
    ]) {
      const ts = nextTurnTs(THREE_TURNS, requested);
      expect(appendTurn(THREE_TURNS, { author: "agent", text: "x", ts: requested }).turn.ts).toBe(
        ts,
      );
      // Feeding the answer back is a fixed point: the bytes are written under
      // this directory before the body that quotes it exists.
      expect(nextTurnTs(THREE_TURNS, ts)).toBe(ts);
    }
  });

  it("rejects a stamp that is not an instant", () => {
    expect(() => nextTurnTs(THREE_TURNS, "not-a-date")).toThrow(TypeError);
  });
});

describe("appendTurn", () => {
  it("appends a turn with a heading and a strictly greater timestamp", () => {
    const { body, turn } = appendTurn(THREE_TURNS, {
      author: "agent",
      text: "Updated.",
      ts: "2026-07-19T10:09:00Z",
    });
    expect(turn).toEqual({ author: "agent", ts: "2026-07-19T10:09:00Z", body: "Updated." });
    expect(body.endsWith("## agent · 2026-07-19T10:09:00Z\nUpdated.\n")).toBe(true);
    expect(parseTurns(body)).toHaveLength(4);
  });

  it.each([
    ["equal to the last turn", "2026-07-19T10:07:12Z"],
    ["earlier than the last turn", "2026-07-19T09:00:00Z"],
  ])("bumps a timestamp %s", (_name, ts) => {
    const { body, turn } = appendTurn(THREE_TURNS, { author: "agent", text: "Reply.", ts });
    expect(turn.ts).toBe("2026-07-19T10:07:13Z");
    const timestamps = parseTurns(body).map((entry) => entry.ts);
    expect(new Set(timestamps).size).toBe(timestamps.length);
    expect([...timestamps].sort()).toEqual(timestamps);
  });

  it("bumps against the greatest timestamp, not the last one written", () => {
    const outOfOrder = `## user · 2026-07-19T11:00:00Z\nLater.\n\n## agent · 2026-07-19T10:00:00Z\nEarlier.\n`;
    expect(
      appendTurn(outOfOrder, { author: "user", text: "Next.", ts: "2026-07-19T10:30:00Z" }).turn.ts,
    ).toBe("2026-07-19T11:00:01Z");
  });

  it("defaults the timestamp to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.500Z"));
    expect(appendTurn(THREE_TURNS, { author: "user", text: "Now." }).turn.ts).toBe(
      "2026-07-19T12:00:00Z",
    );
    vi.useRealTimers();
  });

  it("normalizes a non-canonical timestamp before writing it", () => {
    expect(
      appendTurn("", { author: "user", text: "First.", ts: "2026-07-19T12:00:00.999+00:00" }).turn
        .ts,
    ).toBe("2026-07-19T12:00:00Z");
  });

  it("writes the first turn without a leading blank line", () => {
    expect(
      appendTurn("", { author: "user", text: "First.", ts: "2026-07-19T10:00:00Z" }).body,
    ).toBe("## user · 2026-07-19T10:00:00Z\nFirst.\n");
  });

  it("preserves a preamble", () => {
    const { body } = appendTurn("Preamble.\n", {
      author: "user",
      text: "First.",
      ts: "2026-07-19T10:00:00Z",
    });
    expect(body).toBe("Preamble.\n\n## user · 2026-07-19T10:00:00Z\nFirst.\n");
  });

  it("keeps an attachment-only turn's empty body renderable", () => {
    const { body } = appendTurn("", { author: "user", text: "  ", ts: "2026-07-19T10:00:00Z" });
    expect(body).toBe("## user · 2026-07-19T10:00:00Z\n");
    expect(parseTurns(body)[0]?.body).toBe("");
  });

  it("throws on a timestamp that is not an instant", () => {
    expect(() => appendTurn("", { author: "user", text: "x", ts: "yesterday" })).toThrow(TypeError);
  });
});

describe("deleteTurn", () => {
  it("removes exactly the named turn, leaving the others unchanged", () => {
    const { body, deleted } = deleteTurn(THREE_TURNS, "2026-07-19T10:06:00Z");
    expect(deleted).toEqual({
      author: "agent",
      ts: "2026-07-19T10:06:00Z",
      body: "Checking current averages.",
    });
    expect(parseTurns(body)).toEqual([
      {
        author: "user",
        ts: "2026-07-19T10:05:00Z",
        body: "@agent is 6.1% still the right assumption?",
      },
      { author: "user", ts: "2026-07-19T10:07:12Z", body: "Thanks." },
    ]);
    expect(body).toContain("A preamble paragraph the composer wrote.");
  });

  it("leaves the body byte-identical when the timestamp is absent", () => {
    const { body, deleted } = deleteTurn(THREE_TURNS, "2026-01-01T00:00:00Z");
    expect(deleted).toBeNull();
    expect(body).toBe(THREE_TURNS);
  });

  it("accepts a non-canonical timestamp for the same turn", () => {
    expect(deleteTurn(THREE_TURNS, "2026-07-19T10:06:00.000Z").deleted?.ts).toBe(
      "2026-07-19T10:06:00Z",
    );
  });

  it("leaves the body unchanged for an unparseable timestamp", () => {
    expect(deleteTurn(THREE_TURNS, "nope")).toEqual({ body: THREE_TURNS, deleted: null });
  });

  it("removes the only turn, leaving the preamble", () => {
    const body = "Preamble.\n\n## user · 2026-07-19T10:00:00Z\nOnly.\n";
    expect(deleteTurn(body, "2026-07-19T10:00:00Z").body).toBe("Preamble.\n\n");
  });
});

describe("duplicateTurnTimestamps", () => {
  it("reports a timestamp used by more than one turn", () => {
    const body = `## user · 2026-07-19T10:05:00Z\nOne.\n\n## agent · 2026-07-19T10:05:00Z\nTwo.\n`;
    expect(duplicateTurnTimestamps(body)).toEqual(["2026-07-19T10:05:00Z"]);
  });

  it("reports nothing for a well-formed thread", () => {
    expect(duplicateTurnTimestamps(THREE_TURNS)).toEqual([]);
  });
});
