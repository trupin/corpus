import { ORCHESTRATOR_LANE } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors.js";
import { ParsedFlags, type FlagValue } from "../../parse-args.js";
import { CLAIM_ALL_LANE_FLAG, IDLE_LANE_FLAG, resolveLaneScope } from "./lane.js";

function flags(values: Record<string, FlagValue> = {}): ParsedFlags {
  return new ParsedFlags(new Map(Object.entries(values)));
}

describe("--thread, the lane a queue verb consumes", () => {
  it("passes a thread id through as the scope", () => {
    expect(resolveLaneScope(flags({ thread: "th_4b8e2c" }))).toBe("th_4b8e2c");
  });

  it("resolves to absence when the flag is not given", () => {
    // Absence has to be `undefined` and not the orchestrator's name: the caller
    // omits the parameter entirely, which is what the server reads as its lane.
    expect(resolveLaneScope(flags())).toBeUndefined();
    expect(resolveLaneScope(flags({ thread: "" }))).toBeUndefined();
  });

  it("refuses the orchestrator's own name, and says to drop the flag instead", () => {
    // The failure this prevents is silent: `--thread orchestrator` written where
    // a thread id was meant parks the resident on the wrong lane, exits 0, and
    // leaves the conversation to be answered by the orchestrator.
    let thrown: unknown;
    try {
      resolveLaneScope(flags({ thread: ORCHESTRATOR_LANE }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UsageError);
    expect((thrown as UsageError).message).toContain(ORCHESTRATOR_LANE);
    expect((thrown as UsageError).hint).toContain("drop the flag");
  });

  it("refuses anything that is not a thread id at all, before any request", () => {
    for (const value of ["doc_a1b2c3", "evt_7c1d", "4b8e2c", "th_", "th_x y"]) {
      expect(() => resolveLaneScope(flags({ thread: value }))).toThrow(UsageError);
    }
  });

  it("points a lost caller at the read that lists the lanes", () => {
    try {
      resolveLaneScope(flags({ thread: "nonsense" }));
      expect.unreachable("a lane that is not a thread id must be refused");
    } catch (error) {
      expect((error as UsageError).hint).toContain("corpus agents");
    }
  });

  it("spells the flag identically on both verbs, whatever the prose says", () => {
    for (const flag of [IDLE_LANE_FLAG, CLAIM_ALL_LANE_FLAG]) {
      expect(flag.name).toBe("thread");
      expect(flag.type).toBe("string");
      expect(flag.valueName).toBe("th_…");
    }
  });

  it("says what the flag is in one shared half, so that half cannot drift apart", () => {
    // The two verbs differ only in what happens to a thread designating nobody.
    // Everything a caller needs to *pick* a value is one string, and the pin is
    // that both descriptions still open with the whole of it — not merely that
    // each mentions the facts that stop the flag being misused (omission is the
    // orchestrator's lane; a scoped call sees only its own).
    const shared = IDLE_LANE_FLAG.description.slice(
      0,
      IDLE_LANE_FLAG.description.indexOf(" **A thread that holds no resident"),
    );
    expect(shared).toContain("Omit it for the orchestrator's");
    expect(shared).toContain("only its own lane's events");
    expect(CLAIM_ALL_LANE_FLAG.description.startsWith(shared)).toBe(true);
  });

  it("states idle's refusal, and every recovery the server's own 422 names", () => {
    // CLI-048: SERVER-118 made a scope naming no lane a `422`, and the shared
    // description went on asserting the opposite. Pinned rather than left for
    // the next reader to re-check — the defect is help drifting from behaviour,
    // which on this branch has now recurred five times.
    expect(IDLE_LANE_FLAG.description).toContain("is refused");
    expect(IDLE_LANE_FLAG.description).toContain("exit 5");
    // `apps/server/src/errors.ts`'s `unknownLaneScope` names three ways on, and
    // help that named fewer would send a caller to a message saying more.
    expect(IDLE_LANE_FLAG.description).toContain("omit the flag");
    expect(IDLE_LANE_FLAG.description).toContain("designate a resident on that thread first");
    expect(IDLE_LANE_FLAG.description).toContain("pick a lane from `corpus agents`");
    // The window SERVER-118 deliberately kept legal: released-while-parked is
    // not the case being refused, and help that skipped it would read as a
    // stricter rule than the server enforces.
    expect(IDLE_LANE_FLAG.description).toContain(
      "never a lane, not one that has stopped being one",
    );
  });

  it("keeps claim-all's tolerance, with the reason it survives idle's refusal", () => {
    // The tolerant sentence is still true here, and SERVER-118 left it true on
    // purpose. Both halves are pinned: the rule, and the reason — a reader who
    // meets two rules for one flag and no explanation assumes one is stale,
    // which is how the sentence this replaced survived.
    expect(CLAIM_ALL_LANE_FLAG.description).toContain("need not still hold a resident");
    expect(CLAIM_ALL_LANE_FLAG.description).toContain("strand them");
    expect(CLAIM_ALL_LANE_FLAG.description).toContain("deliberate difference");
  });

  it("makes each verb name the other, so neither rule reads as the stale one", () => {
    expect(IDLE_LANE_FLAG.description).toContain(
      "`corpus queue claim-all` accepts what this refuses",
    );
    expect(CLAIM_ALL_LANE_FLAG.description).toContain("`corpus queue idle`");
  });

  it("no longer tells idle's caller that an undesignated thread is accepted", () => {
    // The exact claim SERVER-118 falsified. Asserted as an absence too, because
    // the positive pins above would all still pass with the old sentence left
    // sitting beside them — which is the state CLI-048 found.
    expect(IDLE_LANE_FLAG.description).not.toContain("need not already be designated");
    expect(IDLE_LANE_FLAG.description).not.toContain("whatever lane it is given");
    expect(IDLE_LANE_FLAG.description).not.toContain("designated a moment later");
  });
});
