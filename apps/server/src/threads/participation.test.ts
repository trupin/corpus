import { describe, expect, it } from "vitest";
import type { Actor, ThreadAgent, ThreadStatus } from "@corpus/contract";
import { decideParticipation, type ParticipationInput } from "./participation.js";
import { NO_MENTIONS, type ParsedMentions } from "./mentions.js";

const mentioning = (overrides: Partial<ParsedMentions>): ParsedMentions => ({
  ...NO_MENTIONS,
  ...overrides,
});

const decide = (input: Partial<ParticipationInput>): ReturnType<typeof decideParticipation> =>
  decideParticipation({
    requestsAgent: undefined,
    author: "user",
    parsed: NO_MENTIONS,
    thread: null,
    ...input,
  });

const thread = (
  agent: ThreadAgent,
  status: ThreadStatus = "open",
): { agent: ThreadAgent; status: ThreadStatus } => ({
  agent,
  status,
});

describe("decideParticipation — the §8 enqueue matrix", () => {
  it("a plain comment on a fresh thread enqueues nothing", () => {
    expect(decide({})).toEqual({ enqueue: false, agent: "none" });
  });

  it("an explicit true always enqueues, whatever the body says", () => {
    expect(decide({ requestsAgent: true })).toEqual({ enqueue: true, agent: "requested" });
  });

  it('an explicit false is "note only" and outranks an @agent in the body', () => {
    expect(decide({ requestsAgent: false, parsed: mentioning({ generic: true }) })).toEqual({
      enqueue: false,
      agent: "none",
    });
  });

  it("an explicit false suppresses an engaged thread's re-trigger", () => {
    expect(decide({ requestsAgent: false, thread: thread("engaged") })).toEqual({
      enqueue: false,
      agent: "engaged",
    });
  });

  it("a generic @agent requests the agent", () => {
    expect(decide({ parsed: mentioning({ generic: true }) })).toEqual({
      enqueue: true,
      agent: "requested",
    });
  });

  it.each([
    ["a resolved subagent", { mentions: [{ name: "researcher", docId: "doc_a", status: "open" }] }],
    ["a resolved skill", { skills: [{ name: "comment", docId: "doc_b", status: "archived" }] }],
  ])("%s requests the agent", (_label, parsed) => {
    expect(decide({ parsed: mentioning(parsed) }).enqueue).toBe(true);
  });

  it("unresolved tokens alone never wake the agent", () => {
    expect(decide({ parsed: mentioning({ unresolved: ["@nobody", "/nothing"] }) })).toEqual({
      enqueue: false,
      agent: "none",
    });
  });

  it("an engaged, open thread re-triggers on a plain user turn", () => {
    expect(decide({ thread: thread("engaged") })).toEqual({ enqueue: true, agent: "engaged" });
  });

  it("a resolved thread stops the automatic re-trigger", () => {
    expect(decide({ thread: thread("engaged", "resolved") })).toEqual({
      enqueue: false,
      agent: "engaged",
    });
  });

  // Sprint-006 Adjudication 5: resolving suppresses the *automatic* re-trigger;
  // it is not a mute button on someone deliberately typing `@agent`.
  it("an explicit request beats resolved", () => {
    expect(decide({ requestsAgent: true, thread: thread("engaged", "resolved") }).enqueue).toBe(
      true,
    );
  });

  it("a requested-but-not-engaged thread does not re-trigger on a plain turn", () => {
    expect(decide({ thread: thread("requested") })).toEqual({ enqueue: false, agent: "requested" });
  });

  it("does not hand the agent its own reply to answer", () => {
    expect(decide({ author: "agent", thread: thread("engaged") })).toEqual({
      enqueue: false,
      agent: "engaged",
    });
  });

  it("lets an agent wake the agent back when it says so explicitly", () => {
    expect(
      decide({ author: "agent", requestsAgent: true, thread: thread("engaged") }).enqueue,
    ).toBe(true);
  });
});

describe("decideParticipation — the `agent` field's transitions", () => {
  // Sprint-006 Adjudication 4: the server closes §7's loop mechanically, so a
  // skill that forgets cannot leave a thread unable to re-trigger for its life.
  it("flips requested → engaged on the agent's first turn", () => {
    expect(decide({ author: "agent", thread: thread("requested") }).agent).toBe("engaged");
  });

  it("does not engage a thread nobody asked the agent into", () => {
    expect(decide({ author: "agent", thread: thread("none") }).agent).toBe("none");
  });

  it("engaged is terminal — resolving does not unwind it", () => {
    expect(decide({ author: "user", thread: thread("engaged", "resolved") }).agent).toBe("engaged");
  });

  it.each<[Actor, ThreadAgent]>([
    ["user", "requested"],
    ["agent", "requested"],
  ])("a %s turn that asks moves none → %s", (author, expected) => {
    expect(decide({ author, requestsAgent: true, thread: thread("none") }).agent).toBe(expected);
  });
});
