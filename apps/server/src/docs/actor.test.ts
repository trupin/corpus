import { ACTOR_HEADER } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { actorOf } from "./actor.js";

describe("actorOf", () => {
  it("reads the shipped header", () => {
    expect(actorOf({ [ACTOR_HEADER]: "agent" })).toBe("agent");
    expect(actorOf({ [ACTOR_HEADER]: "user" })).toBe("user");
  });

  it("defaults to user for an absent header, and for one this API does not declare", () => {
    expect(actorOf({})).toBe("user");
    // `X-Corpus-Actor` is not a header of this API. A request carrying it is a
    // request with no actor header — never a rejected one.
    expect(actorOf({ "x-corpus-actor": "agent" })).toBe("user");
    expect(actorOf({ [ACTOR_HEADER]: undefined })).toBe("user");
  });
});
