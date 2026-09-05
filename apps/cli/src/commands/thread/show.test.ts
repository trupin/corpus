import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { DIGEST_ORIENTS_HELP } from "./digest.js";
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
  unread: false,
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
        "th_x9y8 · open · agent engaged · read",
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
        "th_x9y8 · open · agent none · read",
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

  it("reports the server's read-state, and never calls the mutation that clears it", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...ANCHORED, unread: true }));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    // The flag is the server's answer against its own seen mark (CONTRACT-036),
    // not this session's guess — which is why it can say "unread" at all.
    expect(harness.stdout()).toMatch(/th_x9y8 · open · agent engaged · unread/);
    // Reading must clear nothing: POST /seen is the only read-state mutation.
    expect(stub.requests.map((request) => request.path)).toEqual(["/api/threads/th_x9y8"]);
  });

  it("says read when the server says the mark is current", async () => {
    const stub = await startStubServer(jsonResponder(200, ANCHORED));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toMatch(/th_x9y8 · open · agent engaged · read/);
  });

  it("still reports no events, because the endpoint carries none", async () => {
    const stub = await startStubServer(jsonResponder(200, ANCHORED));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).not.toMatch(/lastSeenTs|events/i);
  });

  it("names the resident of a designated conversation, and the document defining it", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        ...ANCHORED,
        parent: null,
        anchor: null,
        resident: { name: "researcher", docId: "doc_r1", weight: null, designationId: null },
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toContain("\nresident researcher (doc_r1)\n");
    // Between the anchoring line and the timestamps: what the thread is, then
    // who lives in it, then when.
    const lines = harness.stdout().split("\n");
    expect(lines[3]).toBe("resident researcher (doc_r1)");
    expect(lines[4]?.startsWith("created ")).toBe(true);
  });

  it("says a resident designated with no profile is one, rather than printing its nulls", async () => {
    // SHARED-048: `{name: null, docId: null}` is a general resident — somebody,
    // with no persona document. Interpolating the fields raw printed
    // `resident null · null`, which reads as a bug in the thread rather than as
    // the ordinary designation it is.
    const stub = await startStubServer(
      jsonResponder(200, {
        ...ANCHORED,
        resident: { name: null, docId: null, weight: null, designationId: null },
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toContain("\nresident a general resident\n");
    expect(harness.stdout()).not.toContain("null");
  });

  it("reports a profile that has gone, rather than a stale id or a general resident", async () => {
    // §7: a profile renamed, deleted, or moved out of `.claude/agents/` after
    // designation does not end the designation — the miss is reported, and
    // archiving is not one of the ways in, since an archived agent-def still
    // under that root resolves. The two nulls a reader could confuse
    // are one level apart, so this must not read like the case above.
    const stub = await startStubServer(
      jsonResponder(200, {
        ...ANCHORED,
        resident: { name: "researcher", docId: null, weight: null, designationId: null },
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runThreadShow(harness.context);

    expect(harness.stdout()).toContain("\nresident researcher (profile missing)\n");
    expect(harness.stdout()).not.toContain("general resident");
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
      jsonResponder(200, {
        ...ANCHORED,
        resident: { name: "researcher", docId: "doc_r1", weight: null, designationId: null },
      }),
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

/**
 * CLI-076 — reading part of a conversation. The fixture is nineteen turns
 * because that is the thread the issue measured, and the whole feature is a
 * claim about what nineteen turns cost.
 */

/** A body with trailing whitespace and an internal blank line: the byte-exactness case. */
const RAGGED_BODY = "First line.\n\nSecond paragraph, with a trailing space. \n\n";

const LONG_TURNS = Array.from({ length: 19 }, (_, position) => ({
  author: position % 2 === 0 ? "user" : "agent",
  ts: `2026-07-28T10:${String(position).padStart(2, "0")}:00.000Z`,
  body: position === 16 ? RAGGED_BODY : `Turn ${String(position + 1)} says something.\n`,
  model: null,
}));

const LONG = { ...ANCHORED, turns: LONG_TURNS };

/** Runs the verb and returns the harness, for the many one-assertion cases below. */
async function show(
  body: unknown,
  flags: Record<string, boolean | string | number>,
): Promise<{ stdout: string; requests: number }> {
  const stub = await startStubServer(jsonResponder(200, body));
  const harness = stubContext(stub, { args: ARGS, flags });
  await runThreadShow(harness.context);
  return { stdout: harness.stdout(), requests: stub.requests.length };
}

async function refusal(
  body: unknown,
  flags: Record<string, boolean | string | number>,
): Promise<{ error: unknown; stdout: string }> {
  const stub = await startStubServer(jsonResponder(200, body));
  const harness = stubContext(stub, { args: ARGS, flags });
  try {
    await runThreadShow(harness.context);
  } catch (error) {
    return { error, stdout: harness.stdout() };
  }
  throw new Error("the command was expected to refuse and did not");
}

describe("corpus thread show --index", () => {
  it("prints a header and one row per turn, and nothing else", async () => {
    const { stdout } = await show(LONG, { index: true });
    const lines = stdout.split("\n").filter((line) => line !== "");

    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe("Is 6.1% right? · th_x9y8 · open · 19 turns · 479 bytes");
    expect(lines[1]).toBe("1   user   2026-07-28T10:00:00.000Z  23 B  Turn 1 says something.");
    expect(lines[17]).toBe("17  user   2026-07-28T10:16:00.000Z  56 B  First line.…");
    expect(lines[19]).toBe("19  user   2026-07-28T10:18:00.000Z  24 B  Turn 19 says something.");
  });

  it("states a total that is exactly the sum of the rows", async () => {
    const { stdout } = await show(LONG, { index: true });
    const rows = stdout.split("\n").slice(1);
    const summed = rows.reduce((sum, row) => {
      const bytes = /\s(\d+) B\s/.exec(row)?.[1];
      return bytes === undefined ? sum : sum + Number(bytes);
    }, 0);

    expect(stdout.split("\n")[0]).toContain(`${String(summed)} bytes`);
  });

  it("costs a fraction of the whole read on a conversation of real size", async () => {
    const bulky = {
      ...ANCHORED,
      turns: LONG_TURNS.map((turn) => ({
        ...turn,
        body: `${turn.body}${"detail ".repeat(100)}\n`,
      })),
    };
    const whole = await show(bulky, {});
    const index = await show(bulky, { index: true });

    expect(index.stdout.length).toBeLessThan(whole.stdout.length / 4);
  });

  it("marks an excerpt that leaves anything out, and does not mark one that does not", async () => {
    const { stdout } = await show(
      {
        ...ANCHORED,
        turns: [
          { author: "user", ts: "2026-07-28T10:00:00.000Z", body: "Short.", model: null },
          { author: "agent", ts: "2026-07-28T10:01:00.000Z", body: "One.\nTwo.\n", model: null },
          {
            author: "user",
            ts: "2026-07-28T10:02:00.000Z",
            body: `${"x".repeat(80)}\n`,
            model: null,
          },
        ],
      },
      { index: true },
    );
    const lines = stdout.split("\n");

    expect(lines[1]?.endsWith("Short.")).toBe(true);
    expect(lines[2]?.endsWith("One.…")).toBe(true);
    expect(lines[3]?.endsWith(`${"x".repeat(60)}…`)).toBe(true);
  });

  it("gives an empty turn a row with a zero count rather than dropping it", async () => {
    const { stdout } = await show(
      {
        ...ANCHORED,
        turns: [{ author: "user", ts: "2026-07-28T10:00:00.000Z", body: "", model: null }],
      },
      { index: true },
    );

    expect(stdout).toContain("· 1 turn · 0 bytes");
    expect(stdout.split("\n")[1]).toBe("1  user  2026-07-28T10:00:00.000Z  0 B");
  });

  it("prints its header and the (no turns) line for a thread with none", async () => {
    const { stdout } = await show({ ...ANCHORED, turns: [] }, { index: true });

    expect(stdout).toBe("Is 6.1% right? · th_x9y8 · open · 0 turns · 0 bytes\n(no turns)\n");
  });

  it("emits derived rows under --json and no body anywhere", async () => {
    const stub = await startStubServer(jsonResponder(200, LONG));
    const harness = stubContext(stub, { args: ARGS, flags: { index: true }, json: true });
    await runThreadShow(harness.context);

    const payload = JSON.parse(harness.stdout()) as Record<string, unknown>;
    expect(harness.stdout()).not.toContain('"body"');
    expect(payload["turnCount"]).toBe(19);
    expect(payload["bytes"]).toBe(479);
    expect((payload["index"] as unknown[])[0]).toEqual({
      turn: 1,
      author: "user",
      ts: "2026-07-28T10:00:00.000Z",
      bytes: 23,
      excerpt: "Turn 1 says something.",
      truncated: false,
    });
  });

  it("makes exactly one request, because the saving is context and not wire", async () => {
    const { requests } = await show(LONG, { index: true });

    expect(requests).toBe(1);
  });

  /**
   * CLI-077 — the digest block, above the header. Three distinct renderings —
   * with a digest, without one, and with a stale one — each asserted for the
   * marker's presence and absence.
   */
  describe("the digest block (CLI-077)", () => {
    const DIGEST = {
      body: "Decided: 30-year fixed (turn 7).\nOpen: escrow (turn 16).",
      watermark: "2026-07-28T10:18:00.000Z",
      stale: false,
    };

    it("prints the digest above the header, with its watermark, when the thread carries one", async () => {
      const { stdout } = await show({ ...LONG, digest: DIGEST }, { index: true });
      const lines = stdout.split("\n");

      expect(lines[0]).toBe("digest · covers turns through 2026-07-28T10:18:00.000Z");
      expect(lines[1]).toBe("Decided: 30-year fixed (turn 7).");
      expect(lines[2]).toBe("Open: escrow (turn 16).");
      expect(lines[3]).toBe("");
      expect(lines[4]).toBe("Is 6.1% right? · th_x9y8 · open · 19 turns · 479 bytes");
      expect(stdout).not.toContain("STALE");
    });

    it("marks a stale digest STALE and still prints its body — never hidden, never replaced", async () => {
      const { stdout } = await show(
        { ...LONG, digest: { ...DIGEST, stale: true } },
        { index: true },
      );
      const lines = stdout.split("\n");

      expect(lines[0]).toContain("digest · STALE");
      expect(lines[0]).toContain("2026-07-28T10:18:00.000Z");
      expect(lines[0]).toContain("deleted or revised");
      expect(stdout).toContain("Decided: 30-year fixed (turn 7).");
      expect(stdout).toContain("Is 6.1% right? · th_x9y8 · open · 19 turns");
    });

    it("prints no digest block at all for a thread without one — absence is the ordinary state", async () => {
      const explicit = await show({ ...LONG, digest: null }, { index: true });
      const absent = await show(LONG, { index: true });

      for (const { stdout } of [explicit, absent]) {
        expect(stdout).not.toContain("digest");
        expect(stdout.split("\n")[0]).toBe(
          "Is 6.1% right? · th_x9y8 · open · 19 turns · 479 bytes",
        );
      }
    });

    it("carries the digest, stale flag included, under --json", async () => {
      const stub = await startStubServer(
        jsonResponder(200, { ...LONG, digest: { ...DIGEST, stale: true } }),
      );
      const harness = stubContext(stub, { args: ARGS, flags: { index: true }, json: true });
      await runThreadShow(harness.context);

      const payload = JSON.parse(harness.stdout()) as Record<string, unknown>;
      expect(payload["digest"]).toEqual({ ...DIGEST, stale: true });
    });

    it("emits digest null, not an absent key, when the thread has none", async () => {
      const stub = await startStubServer(jsonResponder(200, { ...LONG, digest: null }));
      const harness = stubContext(stub, { args: ARGS, flags: { index: true }, json: true });
      await runThreadShow(harness.context);

      const payload = JSON.parse(harness.stdout()) as Record<string, unknown>;
      expect("digest" in payload).toBe(true);
      expect(payload["digest"]).toBeNull();
    });
  });
});

describe("corpus thread show, addressed", () => {
  it("prints only the newest three turns and no other body", async () => {
    const { stdout } = await show(LONG, { last: 3 });

    expect(stdout).toBe(
      [
        "user · 2026-07-28T10:16:00.000Z\n",
        RAGGED_BODY,
        "\n",
        "agent · 2026-07-28T10:17:00.000Z\n",
        "Turn 18 says something.\n",
        "\n",
        "user · 2026-07-28T10:18:00.000Z\n",
        "Turn 19 says something.\n",
      ].join(""),
    );
    expect(stdout).not.toContain("Turn 16 says");
  });

  it("prints a ragged body byte for byte, trailing whitespace and blank line intact", async () => {
    const { stdout } = await show(LONG, { turn: "17" });

    expect(stdout).toBe(`user · 2026-07-28T10:16:00.000Z\n${RAGGED_BODY}`);
    expect(stdout.endsWith(RAGGED_BODY)).toBe(true);
  });

  it("appends no newline to a body that carries none", async () => {
    const { stdout } = await show(
      {
        ...ANCHORED,
        turns: [
          { author: "user", ts: "2026-07-28T10:00:00.000Z", body: "no newline", model: null },
        ],
      },
      { turn: "1" },
    );

    expect(stdout).toBe("user · 2026-07-28T10:00:00.000Z\nno newline");
  });

  it("addresses a turn by its timestamp, which is the address a deletion cannot move", async () => {
    const { stdout } = await show(LONG, { turn: "2026-07-28T10:16:00Z" });

    expect(stdout).toBe(`user · 2026-07-28T10:16:00.000Z\n${RAGGED_BODY}`);
  });

  it("takes a list of ordinals and ranges, oldest first, with repeats printed once", async () => {
    const { stdout } = await show(LONG, { turns: "3,1,1-2" });

    expect(stdout).toContain("Turn 1 says something.");
    expect(stdout).toContain("Turn 2 says something.");
    expect(stdout).toContain("Turn 3 says something.");
    expect(stdout).not.toContain("Turn 4 says something.");
    expect(stdout.indexOf("Turn 1 ")).toBeLessThan(stdout.indexOf("Turn 2 "));
    expect(stdout.split("Turn 1 says something.")).toHaveLength(2);
  });

  it("returns the turns after an instant, exclusive of the turn at it", async () => {
    const { stdout } = await show(LONG, { since: "2026-07-28T10:17:00.000Z" });

    expect(stdout).toBe("user · 2026-07-28T10:18:00.000Z\nTurn 19 says something.\n");
  });

  it("says nothing is new rather than failing, and never prints the thread", async () => {
    const { stdout } = await show(LONG, { since: "2026-07-28T23:00:00.000Z" });

    expect(stdout).toBe("(no turns after 2026-07-28T23:00:00.000Z)\n");
    expect(stdout).not.toContain("Turn 1 says");
  });

  it("prints every turn when --last exceeds the count, and exits normally", async () => {
    const { stdout } = await show(LONG, { last: 50 });

    expect(stdout).toContain("Turn 1 says something.");
    expect(stdout).toContain("Turn 19 says something.");
  });

  it("emits the addressed turns under --json with their bytes and ordinals", async () => {
    const stub = await startStubServer(jsonResponder(200, LONG));
    const harness = stubContext(stub, { args: ARGS, flags: { last: 1 }, json: true });
    await runThreadShow(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({
      id: "th_x9y8",
      turnCount: 19,
      turns: [
        {
          turn: 19,
          author: "user",
          ts: "2026-07-28T10:18:00.000Z",
          body: "Turn 19 says something.\n",
          model: null,
          bytes: 24,
        },
      ],
    });
  });

  it("makes exactly one request", async () => {
    const { requests } = await show(LONG, { last: 3 });

    expect(requests).toBe(1);
  });
});

describe("an address that names nothing", () => {
  const cases: readonly (readonly [string, Record<string, boolean | string | number>])[] = [
    ["--turn 0", { turn: "0" }],
    ["--turn 99", { turn: "99" }],
    ["--turn on a timestamp no turn carries", { turn: "2020-01-01T00:00:00Z" }],
    ["--turn on something that is not an address", { turn: "banana" }],
    ["--turns 5-3", { turns: "5-3" }],
    ["--turns 25", { turns: "25" }],
    ["--turns with a timestamp", { turns: "2026-07-28T10:00:00Z" }],
    ["--last 0", { last: 0 }],
    ["--since garbage", { since: "not-a-time" }],
    ["--index with an address", { index: true, last: 3 }],
    ["two address flags", { last: 3, turn: "1" }],
  ];

  it.each(cases)("refuses %s without printing a turn", async (_name, flags) => {
    const { error, stdout } = await refusal(LONG, flags);

    expect(error).toBeInstanceOf(UsageError);
    expect(stdout).toBe("");
    expect(stdout).not.toContain("says something");
  });

  it("refuses to address a turn of a thread that has none", async () => {
    const { error, stdout } = await refusal({ ...ANCHORED, turns: [] }, { turn: "1" });

    expect(error).toBeInstanceOf(UsageError);
    expect(stdout).toBe("");
  });

  it("says the addressed thread has no turns rather than dumping it", async () => {
    const { stdout } = await show({ ...ANCHORED, turns: [] }, { last: 3 });

    expect(stdout).toBe("(no turns)\n");
  });

  it("refuses a malformed address before the request is made", async () => {
    const stub = await startStubServer(jsonResponder(200, LONG));
    const harness = stubContext(stub, { args: ARGS, flags: { last: 0 } });

    await expect(runThreadShow(harness.context)).rejects.toBeInstanceOf(UsageError);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("the thread show command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
  });

  it("is a workspace command taking one required id and the five reading flags", () => {
    expect(showCommand.requiresWorkspace).not.toBe(false);
    expect(showCommand.args).toEqual([
      { name: "id", required: true, description: "The thread's id." },
    ]);
    expect(showCommand.flags.map((flag) => flag.name)).toEqual([
      "index",
      "turn",
      "turns",
      "last",
      "since",
    ]);
  });

  it("carries a plain example and a --json example that inlines its shape", () => {
    const machine = showCommand.examples.find(
      (example) => example.command.includes("--json") && !example.command.includes("--index"),
    );
    expect(machine?.description).toContain('"turns"');
    expect(machine?.description).toContain('"anchor"');
  });

  it("says in its help that the saving is context rather than wire", () => {
    expect(showCommand.description).toContain("not what crosses the wire");
  });

  it("says which address survives a deleted turn, and which does not", () => {
    const turn = showCommand.flags.find((flag) => flag.name === "turn");
    expect(turn?.description).toContain("identity");
    expect(turn?.description).toContain("ordinal");
  });

  it("says --since is exclusive, because one invocation cannot tell you", () => {
    const since = showCommand.flags.find((flag) => flag.name === "since");
    expect(since?.description).toContain("exclusive");
  });

  it("says the whole read trims and an addressed read does not", () => {
    expect(showCommand.description).toContain("byte-exact");
    expect(showCommand.description).toContain("trimmed");
  });

  it("is reachable as `corpus thread show`", () => {
    expect(threadTopic.commands.map((command) => command.name)).toContain("show");
  });

  /**
   * CLI-077's wording assertion: the invariant is present in the one shared
   * spelling. Presence, never truth — the AGENT issue's rehearsal is what tests
   * whether an agent reading it acts on it.
   */
  it("states that summaries orient and never act, and marks the digest stale in its help", () => {
    expect(showCommand.description).toContain(DIGEST_ORIENTS_HELP);
    expect(showCommand.description).toContain("never hidden and never silently replaced");
    expect(showCommand.description).toContain("watermark");
  });
});
