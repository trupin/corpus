import { describe, expect, it } from "vitest";
import type { Actor, ThreadAgent } from "@corpus/contract";
import { NO_MENTIONS, type ParsedMentions } from "../apps/server/src/threads/mentions.js";
import {
  decideParticipation,
  type ParticipationDecision,
} from "../apps/server/src/threads/participation.js";
import { THREAD_RESOLVED_NOTICE } from "../apps/ui/src/thread/resolveNotice.js";

/**
 * **The confirmation's claim, checked against the write path** (UI-078).
 *
 * The UI tells a person, at the moment they resolve a thread:
 * `Thread resolved — committed. Replying reopens it.` That second sentence is
 * not copy — it is an assertion about `decideParticipation`, the one function
 * that decides what a turn does to a thread's `status` (SPEC.md §8). It was
 * **false** when UI-078 was filed: nothing anywhere set a resolved thread back
 * to `open`, a reply landed in the file and woke nobody, and the sentence had
 * been shipping for weeks because no test in the repo connected the two.
 * SHARED-019 Amendment 1 made it true; this file is what stops it becoming
 * false again in either direction — by weakening the server, or by re-wording
 * the notice into a promise the server does not keep.
 *
 * **Why it lives in `scripts/`.** It is the second cross-workspace invariant
 * after `stub-server-parity.test.ts`, and for the same reason: `apps/ui` and
 * `apps/server` are siblings, not a dependency edge (CLAUDE.md → Repository
 * Structure), so neither may import the other and only repo tooling may look at
 * both at once. The UI side of the import is
 * `apps/ui/src/thread/resolveNotice.ts`, kept deliberately dependency-free so
 * pulling it into this type program drags in no DOM types and no React.
 */

interface ReplyShape {
  readonly name: string;
  /** The §8 tri-state exactly as the wire carries it; `undefined` is *omitted*. */
  readonly requestsAgent: boolean | undefined;
  readonly parsed: ParsedMentions;
}

const mentioning = (overrides: Partial<ParsedMentions>): ParsedMentions => ({
  ...NO_MENTIONS,
  ...overrides,
});

/** A body carrying a bare `@agent` — half of the escape hatch UI-078 found. */
const AT_AGENT = mentioning({ generic: true });

/** The composer's default: its toggle starts on `◉ ask agent`. */
const ASK_AGENT: ReplyShape = {
  name: "◉ ask agent (the composer's default)",
  requestsAgent: true,
  parsed: NO_MENTIONS,
};
const NOTE_ONLY: ReplyShape = {
  name: "○ note only",
  requestsAgent: false,
  parsed: NO_MENTIONS,
};
const MENTIONS_AGENT: ReplyShape = {
  name: "an explicit @agent in the body",
  requestsAgent: undefined,
  parsed: AT_AGENT,
};
const MENTION_MUTED: ReplyShape = {
  name: "@agent overruled by ○ note only",
  requestsAgent: false,
  parsed: AT_AGENT,
};
/**
 * Not reachable from the composer, which always sends the toggle — but reachable
 * over HTTP, and it is the shape §8's *automatic* clause is about.
 */
const PLAIN: ReplyShape = {
  name: "a plain reply, flag omitted",
  requestsAgent: undefined,
  parsed: NO_MENTIONS,
};

const REPLY_SHAPES: readonly ReplyShape[] = [
  ASK_AGENT,
  NOTE_ONLY,
  MENTIONS_AGENT,
  MENTION_MUTED,
  PLAIN,
];

const AGENT_STATES: readonly ThreadAgent[] = ["none", "requested", "engaged"];

/** One turn appended to a **resolved** thread, decided by the server's own function. */
const replyTo = (author: Actor, agent: ThreadAgent, shape: ReplyShape): ParticipationDecision =>
  decideParticipation({
    requestsAgent: shape.requestsAgent,
    author,
    parsed: shape.parsed,
    thread: { agent, status: "resolved" },
  });

interface DecidedReply {
  readonly label: string;
  readonly decision: ParticipationDecision;
}

/** The whole matrix: every reply shape against every agent state. */
const everyReply = (author: Actor): readonly DecidedReply[] =>
  AGENT_STATES.flatMap((agent) =>
    REPLY_SHAPES.map((shape) => ({
      label: `${shape.name}, on an agent: ${agent} thread`,
      decision: replyTo(author, agent, shape),
    })),
  );

const cases = (author: Actor): readonly (readonly [string, ParticipationDecision])[] =>
  everyReply(author).map((entry) => [entry.label, entry.decision] as const);

describe("the resolve confirmation's promise", () => {
  it("is still the promise this file checks", () => {
    // The guard against a vacuous pass: reword the notice and this fails, which
    // forces whoever rewords it to come back here and re-read the matrix below.
    expect(THREAD_RESOLVED_NOTICE).toContain("Replying reopens it");
  });

  it.each(cases("user"))("is kept — %s reopens the thread", (_label, decision) => {
    expect(decision.status).toBe("open");
  });

  it("is kept without exception — no reply by a person leaves a thread resolved", () => {
    expect(everyReply("user").filter((entry) => entry.decision.status !== "open")).toEqual([]);
    // …and the matrix is not empty, so a suite that generated no cases could not
    // pass this describe by checking nothing.
    expect(everyReply("user")).toHaveLength(AGENT_STATES.length * REPLY_SHAPES.length);
  });
});

describe("the escape hatch UI-078 found", () => {
  /*
   * Before SHARED-019 Amendment 1, `requestsAgent: true` — an `@agent` mention
   * or the composer's ask-agent toggle — short-circuited the resolved check
   * while a plain reply reached nobody, and nothing on screen distinguished the
   * two. The short-circuit still exists and still wins, but only over the
   * *enqueue*: the status question is answered by the author, above it. So the
   * two classes of reply no longer differ in whether they are heard at all —
   * they differ in whether they wake the agent, which is what the composer's own
   * toggle says out loud, beside the field, at the moment of the choice.
   */
  it("no longer decides whether the reply is heard: reopening does not depend on it", () => {
    expect(new Set(everyReply("user").map((entry) => entry.decision.status))).toEqual(
      new Set(["open"]),
    );
  });

  it("still wins the enqueue where §8's automatic clause would have stayed silent", () => {
    // A thread the agent was never engaged in: the automatic clause says
    // nothing, so only an explicit request wakes anybody.
    expect(replyTo("user", "none", ASK_AGENT)).toEqual({
      enqueue: true,
      agent: "requested",
      status: "open",
    });
    expect(replyTo("user", "none", MENTIONS_AGENT)).toEqual({
      enqueue: true,
      agent: "requested",
      status: "open",
    });
    // Reopened all the same — the plain reply is not silent, it wakes nobody.
    expect(replyTo("user", "none", PLAIN)).toEqual({
      enqueue: false,
      agent: "none",
      status: "open",
    });
  });

  it("does not overrule ○ note only, which reopens without waking anybody", () => {
    expect(replyTo("user", "engaged", MENTION_MUTED)).toEqual({
      enqueue: false,
      agent: "engaged",
      status: "open",
    });
    expect(replyTo("user", "engaged", NOTE_ONLY)).toEqual({
      enqueue: false,
      agent: "engaged",
      status: "open",
    });
  });

  it("reaches the agent on a thread it is engaged in, which is §8's ordinary rule", () => {
    expect(replyTo("user", "engaged", PLAIN)).toEqual({
      enqueue: true,
      agent: "engaged",
      status: "open",
    });
  });
});

describe("the door the agent closes", () => {
  it.each(cases("agent"))(
    "stays closed — %s written by the agent leaves it resolved",
    (_label, decision) => {
      expect(decision.status).toBe("resolved");
    },
  );

  it("is why the notice speaks of *replying*, not of any turn", () => {
    // The confirmation is shown to a person, about what *they* can do. An agent
    // turn reopening would make agent-side resolution undo itself immediately
    // (SPEC.md §8), so the promise is the person's alone — and "Replying" is the
    // person's word for their own act, not a claim about every turn.
    expect(everyReply("agent").filter((entry) => entry.decision.status !== "resolved")).toEqual([]);
  });
});
