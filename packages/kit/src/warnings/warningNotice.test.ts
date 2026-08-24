import { WARNING_CODES, type Warning, type WarningCode } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { WARNING_PRESENTATION, warningNotice, warningNotices } from "./warningNotice.js";

/**
 * UI-106. The claim under test is not "these two codes are blue": it is that
 * **the channel's tone is decided per code, once, from the code alone** — and
 * that a code nobody has decided about cannot slip through as red.
 */

const warning = (code: WarningCode, detail = "some specifics"): Warning => ({ code, detail });

describe("a carried effect", () => {
  /*
   * SPEC.md's rider signed 2026-08-10: "A response's warnings also carry effects
   * on documents the request never named. A warning is not only a failure."
   * §7 makes a skill's location its enablement, so a folder move that carries a
   * nested `SKILL.md` is the spec working, not a fault.
   */
  it.each(["carried_skill", "carried_reconciliation"] as const)(
    "renders %s as information, not as an error",
    (code) => {
      expect(warningNotice(warning(code)).tone).toBe("info");
    },
  );

  /**
   * The fifth acceptance criterion: a person reading one of these is being told
   * about a document they did not act on, so the notice says so before it says
   * anything else. The server's `detail` carries the id and the path and is
   * shown verbatim behind the lead-in — never re-derived, never parsed.
   */
  it("says the effect landed somewhere the request did not name", () => {
    const notice = warningNotice(
      warning("carried_skill", "doc_nested at .claude/skills/a/SKILL.md — disabled"),
    );
    expect(notice.message).toBe(
      "Also changed — doc_nested at .claude/skills/a/SKILL.md — disabled",
    );
  });
});

describe("a warning that reports something wrong", () => {
  it.each([
    "commit_failed",
    "commit_skipped",
    "orphaned_anchor",
    "unresolved_ref",
    "validation_error",
  ] as const)("keeps the error tone %s has today", (code) => {
    const notice = warningNotice(warning(code));
    expect(notice.tone).toBe("error");
    // And the wording every failure site already used: the code, then the
    // server's own prose.
    expect(notice.message).toBe(`${code} — some specifics`);
  });
});

/**
 * `stage_status` is §5's coupling rule reporting itself, and it already had
 * `info` at the one surface that showed it (`FrontmatterForm`, which renders the
 * server's sentence bare because that sentence already names the board that
 * decided). It keeps both. `default_open_cleared` reached no surface at all, so
 * it had no tone to keep — this is a first decision, not a re-theming.
 */
describe("a specified effect on the document the request did name", () => {
  it("shows the server's sentence bare for stage_status, in the tone it had", () => {
    const notice = warningNotice(
      warning("stage_status", 'stage "doing" → status open, per "Work"'),
    );
    expect(notice.tone).toBe("info");
    expect(notice.message).toBe('stage "doing" → status open, per "Work"');
  });

  it("treats default_open_cleared as an effect rather than a fault", () => {
    expect(warningNotice(warning("default_open_cleared")).tone).toBe("info");
  });
});

describe("the mapping itself", () => {
  /*
   * The type already forces this — `Record<WarningCode, …>` will not compile
   * with a member missing — but the type cannot see a member *removed* from the
   * contract, and it cannot be read by anyone reviewing the enum. This can.
   */
  it("places every code the contract publishes, and no others", () => {
    expect(Object.keys(WARNING_PRESENTATION).sort()).toEqual([...WARNING_CODES].sort());
  });

  /**
   * The tone is a function of `code` and of nothing else. A tone chosen by
   * matching words in `detail` would be a parse of a field the contract says is
   * "rendered verbatim… never parsed", and it would change the first time the
   * server reworded a sentence.
   */
  it("does not read the detail to choose a tone", () => {
    const alarming = "FATAL: the commit failed and everything is on fire";
    expect(warningNotice(warning("carried_skill", alarming)).tone).toBe("info");
    expect(warningNotice(warning("commit_failed", "all fine, nothing to see")).tone).toBe("error");
  });

  /**
   * A client is routinely older than the server it talks to, so a code outside
   * the enum reaches this in the field however closed the enum is on paper.
   * Dropping it silently is the one outcome §11's channel exists to prevent: an
   * unrecognised report is not evidence that nothing is wrong.
   */
  it("shows a code it has never seen rather than swallowing it", () => {
    const future = {
      code: "quota_exceeded",
      detail: "the workspace is full",
    } as unknown as Warning;
    const notice = warningNotice(future);
    expect(notice.tone).toBe("error");
    // The shape every warning had before this map existed, code included, so the
    // reader can look up a category this build cannot name.
    expect(notice.message).toBe("quota_exceeded — the workspace is full");
  });

  it("keeps the server's order when a response carries several", () => {
    expect(
      warningNotices([warning("carried_skill", "one"), warning("commit_failed", "two")]).map(
        (notice) => notice.tone,
      ),
    ).toEqual(["info", "error"]);
  });
});
