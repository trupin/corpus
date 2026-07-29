/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { splitTurnAttachments } from "./attachmentRefs";
import { splitTrace } from "./Turn";

/**
 * The trace grammar, exactly (SPEC.md §6, PR #10 finding 11).
 *
 * The arrow is stripped here and re-supplied by CSS `::before`, so a false
 * positive costs a real line of the conversation: it disappears from the body
 * and reappears as a grey action report the agent never wrote.
 */
describe("splitTrace", () => {
  it("takes the final line of an agent turn when it opens with the arrow and a space", () => {
    expect(splitTrace("6.4% is closer.\n↳ edited the model doc — 3 lines", "agent")).toEqual({
      body: "6.4% is closer.",
      trace: "edited the model doc — 3 lines",
    });
  });

  it("leaves a user turn alone, whatever it ends with", () => {
    const body = "please do it\n↳ not a trace";
    expect(splitTrace(body, "user")).toEqual({ body, trace: null });
  });

  it("requires the space after the arrow", () => {
    for (const body of ["done\n↳edited the doc", "done\n↳"]) {
      expect(splitTrace(body, "agent")).toEqual({ body, trace: null });
    }
  });

  it("does not read an indented line as a trace", () => {
    for (const line of ["  ↳ inside a list item", "\t↳ inside a fence", "> ↳ quoted"]) {
      const body = `done\n${line}`;
      expect(splitTrace(body, "agent")).toEqual({ body, trace: null });
    }
  });

  it("ignores an arrow line that is not the last one", () => {
    const body = "↳ looks like a trace\nbut the turn continues";
    expect(splitTrace(body, "agent")).toEqual({ body, trace: null });
  });

  it("treats an arrow with nothing after it as content, not as an empty trace", () => {
    const body = "done\n↳   ";
    expect(splitTrace(body, "agent")).toEqual({ body, trace: null });
  });

  /**
   * The ordering rule. `Turn` reads the trace off the raw body *before*
   * `splitTurnAttachments` removes the reference block — otherwise a turn whose
   * true last line is an attachment reference would have an earlier line
   * promoted into final position and read as a trace.
   */
  describe("against the attachment reference block", () => {
    const body = "here it is\n↳ this line is not last\n[report.pdf](attachments/th_1/t/report.pdf)";

    it("finds no trace, because the turn does not close with one", () => {
      expect(splitTrace(body, "agent").trace).toBeNull();
    });

    it("is what the reversed order would have got wrong", () => {
      // Splitting first promotes the `↳` line to last; asserted so the ordering
      // in `Turn` is a decision with evidence rather than an accident.
      const promoted = splitTurnAttachments(body).prose;
      expect(splitTrace(promoted, "agent").trace).toBe("this line is not last");
    });

    it("still finds a trace that really is the last line, above its attachments", () => {
      const withTrace = "here it is\n[report.pdf](attachments/th_1/t/report.pdf)\n↳ attached it";
      const split = splitTrace(withTrace, "agent");
      expect(split.trace).toBe("attached it");
      expect(splitTurnAttachments(split.body).attachments).toHaveLength(1);
    });
  });
});
