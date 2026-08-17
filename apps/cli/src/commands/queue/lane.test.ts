import { ORCHESTRATOR_LANE } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors.js";
import { ParsedFlags, type FlagValue } from "../../parse-args.js";
import { LANE_FLAG, resolveLaneScope } from "./lane.js";

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

  it("is one declaration, so the two verbs cannot describe it differently", () => {
    expect(LANE_FLAG.name).toBe("thread");
    expect(LANE_FLAG.type).toBe("string");
    // The prose a skill author reads has to carry the two facts that stop it
    // being misused: omission is the orchestrator's lane, and a scoped call sees
    // only its own.
    expect(LANE_FLAG.description).toContain("Omit it for the orchestrator's");
    expect(LANE_FLAG.description).toContain("only its own lane's events");
  });
});
