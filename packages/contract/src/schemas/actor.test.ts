import { describe, expect, it } from "vitest";
import { ACTOR_HEADER, DEFAULT_ACTOR } from "../actor.js";
import { ActorHeaderSchema, ActorSchema } from "./actor.js";

describe("Actor", () => {
  it.each(["user", "agent"])("round-trips %s", (actor) => {
    expect(ActorSchema.parse(actor)).toBe(actor);
  });

  it("rejects an unknown party", () => {
    expect(ActorSchema.safeParse("server").success).toBe(false);
  });
});

describe("ActorHeader", () => {
  it("defaults to the user when the header is absent", () => {
    expect(ActorHeaderSchema.parse({})).toEqual({ [ACTOR_HEADER]: DEFAULT_ACTOR });
  });

  it("keeps an explicit agent attribution", () => {
    expect(ActorHeaderSchema.parse({ [ACTOR_HEADER]: "agent" })).toEqual({
      [ACTOR_HEADER]: "agent",
    });
  });

  it("rejects an unknown acting party rather than falling back to the default", () => {
    expect(ActorHeaderSchema.safeParse({ [ACTOR_HEADER]: "robot" }).success).toBe(false);
  });
});
