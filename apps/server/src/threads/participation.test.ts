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
    expect(decide({})).toEqual({ enqueue: false, agent: "none", status: "open" });
  });

  it("an explicit true always enqueues, whatever the body says", () => {
    expect(decide({ requestsAgent: true })).toEqual({
      enqueue: true,
      agent: "requested",
      status: "open",
    });
  });

  it('an explicit false is "note only" and outranks an @agent in the body', () => {
    expect(decide({ requestsAgent: false, parsed: mentioning({ generic: true }) })).toEqual({
      enqueue: false,
      agent: "none",
      status: "open",
    });
  });

  it("an explicit false suppresses an engaged thread's re-trigger", () => {
    expect(decide({ requestsAgent: false, thread: thread("engaged") })).toEqual({
      enqueue: false,
      agent: "engaged",
      status: "open",
    });
  });

  it("a generic @agent requests the agent", () => {
    expect(decide({ parsed: mentioning({ generic: true }) })).toEqual({
      enqueue: true,
      agent: "requested",
      status: "open",
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
      status: "open",
    });
  });

  it("an engaged, open thread re-triggers on a plain user turn", () => {
    expect(decide({ thread: thread("engaged") })).toEqual({
      enqueue: true,
      agent: "engaged",
      status: "open",
    });
  });

  // Corrected by SERVER-062. Before SHARED-019 Amendment 1 this case read "a
  // resolved thread stops the automatic re-trigger" and asserted `enqueue:
  // false` — the silence UI-078 filed. §8 now says the person's reply reopens
  // the thread first, and the automatic clause then applies to an *open*,
  // engaged thread, so it re-triggers.
  it("a person's reply reopens a resolved thread, and §8 then re-triggers", () => {
    expect(decide({ thread: thread("engaged", "resolved") })).toEqual({
      enqueue: true,
      agent: "engaged",
      status: "open",
    });
  });

  // Sprint-006 Adjudication 5: resolving suppresses the *automatic* re-trigger;
  // it is not a mute button on someone deliberately typing `@agent`. Since the
  // amendment that short-circuit is no longer the only way through — but it
  // still wins on its own terms, and it composes rather than duplicating: the
  // reopen comes from the author, the enqueue from the explicit request.
  it("an explicit request beats resolved, and reopens beside it", () => {
    expect(decide({ requestsAgent: true, thread: thread("engaged", "resolved") })).toEqual({
      enqueue: true,
      agent: "engaged",
      status: "open",
    });
  });

  it("a requested-but-not-engaged thread does not re-trigger on a plain turn", () => {
    expect(decide({ thread: thread("requested") })).toEqual({
      enqueue: false,
      agent: "requested",
      status: "open",
    });
  });

  it("does not hand the agent its own reply to answer", () => {
    expect(decide({ author: "agent", thread: thread("engaged") })).toEqual({
      enqueue: false,
      agent: "engaged",
      status: "open",
    });
  });

  it("lets an agent wake the agent back when it says so explicitly", () => {
    expect(
      decide({ author: "agent", requestsAgent: true, thread: thread("engaged") }).enqueue,
    ).toBe(true);
  });
});

// SPEC.md §8 (SHARED-019 Amendment 1): "Resolved is a closed door, not a locked
// one: a person's reply reopens it… A turn written by the **agent** never
// reopens a thread, so a conversation the agent closes stays closed."
describe("decideParticipation — §8's reopen", () => {
  it.each<[string, Partial<ParticipationInput>, boolean]>([
    ["a plain reply", {}, true],
    ["a note-only reply", { requestsAgent: false }, false],
    ["an explicit @agent request", { requestsAgent: true }, true],
    ["a parsed @agent mention", { parsed: mentioning({ generic: true }) }, true],
  ])("%s by a person reopens the thread", (_label, input, enqueue) => {
    const decision = decide({ ...input, thread: thread("engaged", "resolved") });
    expect(decision.status).toBe("open");
    // The reopen is not an enqueue: "note only" reopens the conversation
    // without waking anybody, which is §8's sentence verbatim.
    expect(decision.enqueue).toBe(enqueue);
  });

  it.each<ThreadAgent>(["none", "requested", "engaged"])(
    "reopens whatever the thread's agent state is (%s)",
    (agent) => {
      expect(decide({ thread: thread(agent, "resolved") }).status).toBe("open");
    },
  );

  it.each<[string, Partial<ParticipationInput>]>([
    ["a plain turn", {}],
    ["a turn that asks for the agent back", { requestsAgent: true }],
  ])("never reopens on %s written by the agent", (_label, input) => {
    expect(
      decide({ ...input, author: "agent", thread: thread("engaged", "resolved") }).status,
    ).toBe("resolved");
  });

  it("leaves an open thread open, whoever writes", () => {
    expect(decide({ thread: thread("engaged") }).status).toBe("open");
    expect(decide({ author: "agent", thread: thread("engaged") }).status).toBe("open");
  });

  it("opens a thread being created", () => {
    expect(decide({ thread: null }).status).toBe("open");
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
