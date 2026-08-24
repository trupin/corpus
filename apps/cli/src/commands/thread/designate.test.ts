import {
  DesignateResidentRequestSchema,
  designateResident,
  RESIDENT_WEIGHT_BOUNDARY,
} from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ServerResponseError, UsageError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { designateCommand, runThreadDesignate } from "./designate.js";
import { threadTopic } from "./index.js";

const ARGS = { id: "th_4b8e2c" };

const THREAD = {
  id: "th_4b8e2c",
  title: "Q3 planning",
  status: "open",
  parent: null,
  anchor: null,
  agent: "none",
  resident: { name: "researcher", docId: "doc_r1", weight: null, designationId: null },
  created: "2026-08-16T09:00:00.000Z",
  updated: "2026-08-16T09:05:00.000Z",
  turnCount: 1,
  lastAuthor: "user",
  lastTs: "2026-08-16T09:00:00.000Z",
};

/** A typed refusal, exactly as the server sends one. */
function refusal(status: number, code: string, message: string) {
  return jsonResponder(status, { code, message });
}

afterEach(closeStubServers);

describe("corpus thread designate", () => {
  it("posts the name to the designation route and prints what it resolved to", async () => {
    const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "RESEARCHER" } });
    await runThreadDesignate(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/threads/th_4b8e2c/resident");
    expect(JSON.parse(request?.body ?? "")).toEqual({ name: "RESEARCHER" });
    // The resolution is the point: the caller typed one spelling and the server
    // answered with the agent-def it actually landed on.
    expect(harness.stdout()).toBe("designated researcher (doc_r1) on th_4b8e2c\n");
  });

  it("emits the mutation envelope untouched under --json", async () => {
    const response = { thread: THREAD, warnings: [] };
    const stub = await startStubServer(jsonResponder(200, response));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" }, json: true });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(response)}\n`);
  });

  it("appends a §11 warning to the line rather than hiding it", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        thread: THREAD,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the change" }],
      }),
    );

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toContain("— warning: commit_failed");
  });

  it("never reports a repeat as a no-op, because a repeat is not one", async () => {
    // Designating the resident a thread already has writes no file but still
    // announces — it is how a person asks for a stopped listener to be launched
    // again (SPEC.md §7). Saying "already designated" would report the one thing
    // the caller came to do as not having happened.
    const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated researcher (doc_r1) on th_4b8e2c\n");
    expect(harness.stdout()).not.toContain("already");
    // And nothing is read first: there is no state to compare against.
    expect(stub.requests).toHaveLength(1);
  });

  it("designates a general resident with no --agent, sending no body at all", async () => {
    // SHARED-048: naming no profile is the ordinary case, and the contract
    // spells absence as an absent body — so a bare designation must not invent
    // `{}` , `{name: null}` or any other stand-in for it.
    const general = {
      ...THREAD,
      resident: { name: null, docId: null, weight: null, designationId: null },
    };
    const stub = await startStubServer(jsonResponder(200, { thread: general, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadDesignate(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/threads/th_4b8e2c/resident");
    expect(request?.body).toBe("");
    expect(harness.stdout()).toBe("designated a general resident on th_4b8e2c\n");
  });

  it("reports a general designation differently from a profiled one", async () => {
    // The acceptance criterion in one assertion: a reader of the printed line
    // can tell "this conversation has an agent with no profile" from "this
    // conversation has profile X".
    const general = {
      ...THREAD,
      resident: { name: null, docId: null, weight: null, designationId: null },
    };
    const bare = await startStubServer(jsonResponder(200, { thread: general, warnings: [] }));
    const bareRun = stubContext(bare, { args: ARGS });
    await runThreadDesignate(bareRun.context);

    const named = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));
    const namedRun = stubContext(named, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(namedRun.context);

    expect(bareRun.stdout()).not.toBe(namedRun.stdout());
    expect(bareRun.stdout()).not.toContain("researcher");
    expect(namedRun.stdout()).toContain("researcher (doc_r1)");
  });

  it("reports a designated profile that has since gone, rather than a stale id", async () => {
    // §7: a profile renamed, deleted, or moved out of `.claude/agents/` after
    // designation does not end the designation, and the miss is reported rather
    // than silently substituted. Archiving is not one of those — an archived
    // agent-def still under that root resolves, so it arrives with its id.
    const orphaned = {
      ...THREAD,
      resident: { name: "researcher", docId: null, weight: null, designationId: null },
    };
    const stub = await startStubServer(jsonResponder(200, { thread: orphaned, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated researcher (profile missing) on th_4b8e2c\n");
    expect(harness.stdout()).not.toContain("general");
  });

  it("emits the general resident's shape under --json without restating it", async () => {
    const response = {
      thread: {
        ...THREAD,
        resident: { name: null, docId: null, weight: null, designationId: null },
      },
      warnings: [],
    };
    const stub = await startStubServer(jsonResponder(200, response));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runThreadDesignate(harness.context);

    // The envelope verbatim: the two nulls the contract publishes, not a word
    // this CLI chose for them.
    expect(harness.stdout()).toBe(`${JSON.stringify(response)}\n`);
    expect(JSON.parse(harness.stdout())).toMatchObject({
      thread: { resident: { name: null, docId: null, weight: null, designationId: null } },
    });
  });

  it("sends --weight in the body and prints the level the server echoed", async () => {
    // CLI-053 / SPEC.md §7's rider: the designation is the one place a
    // resident's weight is chosen, so this flag has to reach the wire.
    const heavy = {
      ...THREAD,
      resident: { name: "researcher", docId: "doc_r1", weight: "heavy", designationId: null },
    };
    const stub = await startStubServer(jsonResponder(200, { thread: heavy, warnings: [] }));

    const harness = stubContext(stub, {
      args: ARGS,
      flags: { agent: "researcher", weight: "heavy" },
    });
    await runThreadDesignate(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      name: "researcher",
      weight: "heavy",
    });
    expect(harness.stdout()).toBe("designated researcher (doc_r1) at heavy on th_4b8e2c\n");
  });

  it("sends a weight with no profile, since the two fields are independent", async () => {
    const general = {
      ...THREAD,
      resident: { name: null, docId: null, weight: "heavy", designationId: null },
    };
    const stub = await startStubServer(jsonResponder(200, { thread: general, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { weight: "heavy" } });
    await runThreadDesignate(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({ weight: "heavy" });
    expect(harness.stdout()).toBe("designated a general resident at heavy on th_4b8e2c\n");
  });

  it("sends the workspace's own level key verbatim, checking it against no table", async () => {
    // §7 keeps the tier table in the orchestrate skill, so a key this CLI has
    // never heard of must reach the server unaltered — and a level the launcher
    // cannot meet is the launcher's report, not a refusal here.
    const odd = {
      ...THREAD,
      resident: { name: null, docId: null, weight: "tier-2", designationId: null },
    };
    const stub = await startStubServer(jsonResponder(200, { thread: odd, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { weight: "tier-2" } });
    await runThreadDesignate(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({ weight: "tier-2" });
    expect(harness.stdout()).toContain("at tier-2");
  });

  it("is byte-identical to today when --weight is left out", async () => {
    // The acceptance criterion. Omitting the flag must send what a designation
    // sent before the flag existed — no `weight` key, and with `--agent` also
    // absent, no body at all.
    const general = {
      ...THREAD,
      resident: { name: null, docId: null, weight: null, designationId: null },
    };
    const bare = await startStubServer(jsonResponder(200, { thread: general, warnings: [] }));
    const bareRun = stubContext(bare, { args: ARGS });
    await runThreadDesignate(bareRun.context);

    expect(bare.requests[0]?.body).toBe("");
    expect(bareRun.stdout()).toBe("designated a general resident on th_4b8e2c\n");

    const named = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));
    const namedRun = stubContext(named, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(namedRun.context);

    expect(JSON.parse(named.requests[0]?.body ?? "")).toEqual({ name: "researcher" });
    expect(namedRun.stdout()).toBe("designated researcher (doc_r1) on th_4b8e2c\n");
  });

  it("names the requested weight even if a 200 somehow carries no resident", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { thread: { ...THREAD, resident: null }, warnings: [] });
    });

    const harness = stubContext(stub, {
      args: ARGS,
      flags: { agent: "researcher", weight: "heavy" },
    });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated researcher at heavy on th_4b8e2c\n");
  });

  it("refuses a blank --weight rather than reading it as choosing nothing", async () => {
    // Same rule as `--agent`: a variable that expanded to nothing is a mistake,
    // and asking the launcher to decide is a decision. The server refuses a
    // blank too, so this is that refusal one round trip earlier.
    for (const blank of ["", "   "]) {
      const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

      const harness = stubContext(stub, { args: ARGS, flags: { weight: blank } });
      await expect(runThreadDesignate(harness.context)).rejects.toBeInstanceOf(UsageError);

      expect(stub.requests).toEqual([]);
    }
  });

  it("refuses a blank --weight even beside a good --agent, sending nothing", async () => {
    const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher", weight: "" } });
    await expect(runThreadDesignate(harness.context)).rejects.toBeInstanceOf(UsageError);

    expect(stub.requests).toEqual([]);
  });

  it("refuses a blank --agent rather than reading it as naming nobody", async () => {
    // A dropped name is a mistake; asking for no profile is a decision. Reading
    // the first as the second would designate something nobody asked for and
    // report success.
    for (const blank of ["", "   "]) {
      const stub = await startStubServer(jsonResponder(200, { thread: THREAD, warnings: [] }));

      const harness = stubContext(stub, { args: ARGS, flags: { agent: blank } });
      await expect(runThreadDesignate(harness.context)).rejects.toBeInstanceOf(UsageError);

      expect(stub.requests).toEqual([]);
    }
  });

  it("renders the server's 403 verbatim instead of pre-refusing the agent", async () => {
    // The server owns actors. A client-side check here would be a second source
    // of truth about who may designate (the reason `doc detach` has none).
    const stub = await startStubServer(
      refusal(
        403,
        "forbidden",
        "designating a resident is user-only; a resident claims a conversation",
      ),
    );

    const harness = stubContext(stub, {
      args: ARGS,
      flags: { agent: "researcher" },
      actor: "agent",
    });
    const thrown = await runThreadDesignate(harness.context).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServerResponseError);
    expect((thrown as ServerResponseError).message).toContain(
      "designating a resident is user-only",
    );
    // The request was actually sent, with the agent's header on it.
    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
  });

  it("renders the server's 409 for a thread that may not have a resident", async () => {
    const stub = await startStubServer(
      refusal(409, "conflict", "only a standalone thread may have a resident"),
    );

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    const thrown = await runThreadDesignate(harness.context).catch((error: unknown) => error);

    expect((thrown as ServerResponseError).message).toBe(
      "409 conflict: only a standalone thread may have a resident",
    );
  });

  it("renders the server's 404 for a name that resolves to no agent-def", async () => {
    const stub = await startStubServer(
      refusal(404, "not_found", "no agent named nobody in this workspace"),
    );

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "nobody" } });
    const thrown = await runThreadDesignate(harness.context).catch((error: unknown) => error);

    expect((thrown as ServerResponseError).message).toContain("no agent named nobody");
  });

  it("falls back to the caller's spelling if a 200 somehow carries no resident", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { thread: { ...THREAD, resident: null }, warnings: [] });
    });

    const harness = stubContext(stub, { args: ARGS, flags: { agent: "researcher" } });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated researcher on th_4b8e2c\n");
  });

  it("falls back to what was asked for when nothing was named either", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { thread: { ...THREAD, resident: null }, warnings: [] });
    });

    const harness = stubContext(stub, { args: ARGS });
    await runThreadDesignate(harness.context);

    expect(harness.stdout()).toBe("designated a general resident on th_4b8e2c\n");
  });
});

describe("the designate command spec", () => {
  it("keeps the thread topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
  });

  it("takes one required thread id and two optional refinements", () => {
    expect(designateCommand.args).toEqual([
      { name: "id", required: true, description: "The standalone thread's id." },
    ]);
    expect(designateCommand.flags.map((flag) => flag.name)).toEqual(["agent", "weight"]);
  });

  it("says the weight is the workspace's own word and never a model name", () => {
    // The acceptance criterion, and the boundary is the contract's own
    // sentence rather than a fourth restatement of it (CONTRACT-064's lesson).
    const weightFlag = designateCommand.flags.find((flag) => flag.name === "weight");
    expect(weightFlag?.description).toContain("never a model name");
    expect(weightFlag?.description).toContain("this workspace's own agent guidance");
    expect(weightFlag?.description).toContain(RESIDENT_WEIGHT_BOUNDARY);
    expect(designateCommand.description).toContain(RESIDENT_WEIGHT_BOUNDARY);
    expect(DesignateResidentRequestSchema.shape.weight.description).toContain(
      RESIDENT_WEIGHT_BOUNDARY,
    );
    // And it says omitting it is a real choice rather than an oversight.
    expect(weightFlag?.description).toContain("**Optional**");
  });

  it("says in one line when you would want each, and shows both", () => {
    expect(designateCommand.flags[0]?.description).toContain("**Optional**");
    expect(designateCommand.description).toContain(
      "leave it out when the workspace's ordinary agent should own the conversation",
    );
    // Both forms are reachable from the examples, so the bare one is not a
    // feature a reader has to deduce from the flag being optional.
    expect(designateCommand.examples.map((example) => example.command)).toContain(
      "corpus thread designate th_4b8e2c",
    );
  });

  it("describes scope as a walk rather than as a guarantee about artifacts", () => {
    // SHARED-044: §7's "an artifact belongs to at most one scope" is not
    // delivered by its own clauses, so this surface describes how membership is
    // computed and never promises exclusivity.
    expect(designateCommand.description).toContain("a walk, not a label");
    expect(designateCommand.description).not.toContain("at most one scope");
  });

  it("says a repeat is not a no-op, which is what makes it a relaunch", () => {
    expect(designateCommand.description).toContain("a repeat is not a no-op");
  });

  it("is reachable as `corpus thread designate`", () => {
    expect(threadTopic.commands.map((command) => command.name)).toContain("designate");
  });

  it("says why an off-root agent-def misses in the contract's exact words", () => {
    // Three surfaces tell a caller the same thing about an `agent-def` filed
    // outside `.claude/agents/`, and the sentence was already identical bar one
    // pair of asterisks. Holding it as one literal is what stops the next edit
    // to any of them from becoming a fourth phrasing of the same rule.
    const clause =
      "off-root `agent-def` is titled the name given, that `404` names its path, because moving " +
      "the file into `.claude/agents/` is what makes it designatable";
    expect(designateCommand.description).toContain(clause);
    expect(designateResident.description).toContain(clause);
    expect(DesignateResidentRequestSchema.shape.name.unwrap().description).toContain(clause);
  });
});
