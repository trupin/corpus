import { describe, expect, it } from "vitest";
import { MAX_NOTICES } from "../shell/Toasts";
import { droppedNoticesLine, noticeTimeLabel, noticeToneLabel } from "./noticesModel";

/**
 * The words the Notices tab says (UI-139). Pure, so the two claims that are easy
 * to get quietly wrong — the count sentence and the fixed-width clock — are
 * facts a test reaches without a render or a timer.
 */

describe("droppedNoticesLine", () => {
  it.each([
    [1, "1 earlier notice dropped"],
    [2, "2 earlier notices dropped"],
    [147, "147 earlier notices dropped"],
  ])("agrees with itself about the number (%i)", (dropped, lead) => {
    expect(droppedNoticesLine(dropped, MAX_NOTICES)).toContain(lead);
  });

  /**
   * §11 forbids a listing that ends quietly, so the line has to name the bound
   * as well as the loss — and name the bound the store actually enforces. A
   * literal here rather than `MAX_NOTICES` is the v0.15.0 defect (a reserve
   * written as a magic value) at a different grain.
   */
  it("names the cap it was given, so the sentence cannot drift from the store", () => {
    expect(droppedNoticesLine(3, MAX_NOTICES)).toBe(
      `3 earlier notices dropped — this list keeps the newest ${String(MAX_NOTICES)}.`,
    );
  });
});

describe("noticeTimeLabel", () => {
  it("is eight characters whatever the hour, so the column is a measurement", () => {
    const early = noticeTimeLabel(new Date(2026, 7, 21, 9, 5, 3).getTime());
    const late = noticeTimeLabel(new Date(2026, 7, 21, 14, 32, 47).getTime());
    expect(early).toBe("09:05:03");
    expect(late).toBe("14:32:47");
    expect(early).toHaveLength(late.length);
  });

  it("reads midnight as 00, never as 24 or 12", () => {
    expect(noticeTimeLabel(new Date(2026, 7, 21, 0, 0, 0).getTime())).toBe("00:00:00");
  });
});

describe("noticeToneLabel", () => {
  it("says the toast's own word and invents none", () => {
    expect(noticeToneLabel("error")).toBe("error");
    expect(noticeToneLabel("info")).toBe("info");
  });
});
