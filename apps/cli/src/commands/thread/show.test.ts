import { afterEach, describe, expect, it } from "vitest";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { threadTopic } from "./index.js";
import { runThreadShow, showCommand } from "./show.js";

/**
 * The three thread shapes are the point (SPEC.md §6): §7's comment skill
 * branches on anchored / whole-document / standalone, so each one is rendered
 * and asserted whole.
 */

const ANCHORED = {
  id: "th_x9y8",
  title: "Is 6.1% right?",
  created: "2026-07-28T10:00:00.000Z",
  updated: "2026-07-28T10:10:00.000Z",
  status: "open",
  tags: ["finance"],
  parent: "doc_a1b2c3",
  anchor: "anc_1",
  agent: "engaged",
  resident: null,
  turns: [
    { author: "user", ts: "2026-07-28T10:00:00.000Z", body: "Is 6.1% right?" },
    { author: "agent", ts: "2026-07-28T10:05:00.000Z", body: "Checked today: it holds.\n" },
    { author: "user", ts: "2026-07-28T10:10:00.000Z", body: "Thanks." },
  ],
};

const ARGS = { id: "th_x9y8" };

afterEach(closeStubServers);

describe("corpus thread show", () => {
  it("reads the thread by id and renders its turns oldest first", async () => {
    const stub = await startStubServer(jsonResponder(200, ANCHORED));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/threads/th_x9y8");
    expect(harness.stdout()).toBe(
      [
        "Is 6.1% right?",
        "th_x9y8 · open · agent engaged",
        "parent doc_a1b2c3 · anchor anc_1 · anchored to a selection",
        "created 2026-07-28T10:00:00.000Z · updated 2026-07-28T10:10:00.000Z",
        "tags finance",
        "",
        "user · 2026-07-28T10:00:00.000Z",
        "Is 6.1% right?",
        "",
        "agent · 2026-07-28T10:05:00.000Z",
        "Checked today: it holds.",
        "",
        "user · 2026-07-28T10:10:00.000Z",
        "Thanks.",
        "",
      ].join("\n"),
    );
  });

  it("names a whole-document thread as such", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...ANCHORED, anchor: null }));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toContain("parent doc_a1b2c3 · anchor — · whole document\n");
  });

  it("names a standalone thread as such, with both nulls rendered honestly", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        ...ANCHORED,
        parent: null,
        anchor: null,
        tags: [],
        agent: "none",
        turns: [ANCHORED.turns[0]],
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toBe(
      [
        "Is 6.1% right?",
        "th_x9y8 · open · agent none",
        "parent — · anchor — · standalone",
        "created 2026-07-28T10:00:00.000Z · updated 2026-07-28T10:10:00.000Z",
        "tags —",
        "",
        "user · 2026-07-28T10:00:00.000Z",
        "Is 6.1% right?",
        "",
      ].join("\n"),
    );
  });

  it("emits the endpoint's payload unreshaped, as exactly one JSON value", async () => {
    const stub = await startStubServer(jsonResponder(200, ANCHORED));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(ANCHORED)}\n`);
    expect(JSON.parse(harness.stdout())).toEqual(ANCHORED);
  });

  it("reports neither read-state nor events, because the endpoint carries neither", async () => {
    const stub = await startStubServer(jsonResponder(200, ANCHORED));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).not.toMatch(/unread|lastSeenTs|events/i);
    // And the mutating read-state endpoint is never called.
    expect(stub.requests.map((request) => request.path)).toEqual(["/api/threads/th_x9y8"]);
  });

  it("names the resident of a designated conversation, and the document defining it", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        ...ANCHORED,
        parent: null,
        anchor: null,
        resident: { name: "researcher", docId: "doc_r1" },
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toContain("\nresident researcher · doc_r1\n");
    // Between the anchoring line and the timestamps: what the thread is, then
    // who lives in it, then when.
    const lines = harness.stdout().split("\n");
    expect(lines[3]).toBe("resident researcher · doc_r1");
    expect(lines[4]?.startsWith("created ")).toBe(true);
  });

  it("prints no resident line at all when there is nobody", async () => {
    // Having nobody resident is the ordinary state of almost every thread, so a
    // `resident —` line on all of them would be noise rather than information.
    const stub = await startStubServer(jsonResponder(200, ANCHORED));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).not.toContain("resident");
  });

  it("reports the designation and never claims anything about presence", async () => {
    // Designation is thread state; presence is an observation about a parked
    // request, read from `GET /api/agents` and free to disagree for a grace
    // window. One read, one fact.
    const stub = await startStubServer(
      jsonResponder(200, { ...ANCHORED, resident: { name: "researcher", docId: "doc_r1" } }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(stub.requests.map((request) => request.path)).toEqual(["/api/threads/th_x9y8"]);
    expect(harness.stdout()).not.toMatch(/\blive\b|lapsed|parked|listening/i);
  });

  it("handles a thread with no turns without pretending it has any", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...ANCHORED, turns: [] }));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout().endsWith("\n\n(no turns)\n")).toBe(true);
  });
});

describe("the thread show command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
  });

  it("is a workspace command taking one required id and no flags of its own", () => {
    expect(showCommand.requiresWorkspace).not.toBe(false);
    expect(showCommand.args).toEqual([
      { name: "id", required: true, description: "The thread's id." },
    ]);
    expect(showCommand.flags).toEqual([]);
  });

  it("carries a plain example and a --json example that inlines its shape", () => {
    expect(showCommand.examples).toHaveLength(2);
    const machine = showCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"turns"');
    expect(machine?.description).toContain('"anchor"');
  });

  it("is reachable as `corpus thread show`", () => {
    expect(threadTopic.commands.map((command) => command.name)).toContain("show");
  });
});
